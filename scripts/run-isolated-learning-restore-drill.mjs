import { createHash, randomBytes } from 'node:crypto';
import { readdir, readFile, writeFile, mkdir } from 'node:fs/promises';
import { resolve } from 'node:path';
// Use PostgreSQL TCP rather than the serverless WebSocket driver: a restore
// drill transfers many rows and must remain stable across a long-lived session.
import { Pool } from 'pg';

const reportDirectory = resolve('reports/content-engine-v3/g0-20260802-baseline');
const reportPath = resolve(reportDirectory, 'isolated-learning-restore-drill.json');
const migrationsDirectory = resolve('db/migrations/learning');

async function loadEnvFile(path) {
  try {
    const content = await readFile(path, 'utf8');
    for (const line of content.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2];
      if (
        (value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'"))
      ) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

function quoteIdentifier(value) {
  if (!/^[a-z][a-z0-9_]*$/.test(value)) {
    throw new Error(`Unsafe database identifier: ${value}`);
  }
  return `"${value}"`;
}

function quoteConstraintIdentifier(value) {
  if (!value || /[\u0000]/.test(value)) {
    throw new Error('Unsafe database constraint identifier.');
  }
  return `"${value.replaceAll('"', '""')}"`;
}

function canonicalDigest(value) {
  return createHash('sha256').update(value.replace(/\r\n/g, '\n'), 'utf8').digest('hex');
}

function targetConnectionString(sourceConnectionString, databaseName) {
  const url = new URL(sourceConnectionString);
  url.pathname = `/${databaseName}`;
  return url.toString();
}

function topologicalOrder(tableNames, foreignKeys) {
  const all = new Set(tableNames);
  const incoming = new Map(tableNames.map((table) => [table, 0]));
  const successors = new Map(tableNames.map((table) => [table, new Set()]));

  for (const { parent, child } of foreignKeys) {
    if (!all.has(parent) || !all.has(child) || parent === child) continue;
    if (!successors.get(parent).has(child)) {
      successors.get(parent).add(child);
      incoming.set(child, incoming.get(child) + 1);
    }
  }

  const ready = [...tableNames].filter((table) => incoming.get(table) === 0).sort();
  const ordered = [];
  while (ready.length) {
    const table = ready.shift();
    ordered.push(table);
    for (const child of [...successors.get(table)].sort()) {
      incoming.set(child, incoming.get(child) - 1);
      if (incoming.get(child) === 0) ready.push(child);
    }
    ready.sort();
  }

  const cyclic = tableNames.filter((table) => !ordered.includes(table)).sort();
  if (cyclic.length) {
    throw new Error(`Cannot safely restore cyclic learning tables: ${cyclic.join(', ')}`);
  }
  return ordered;
}

async function applyMigrations(client) {
  const files = (await readdir(migrationsDirectory))
    .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file))
    .sort();

  await client.query('BEGIN');
  try {
    await client.query("SELECT pg_advisory_xact_lock(hashtext('openmaic-learning-restore-drill'))");
    await client.query(`
      CREATE TABLE IF NOT EXISTS learning_schema_migrations (
        name text PRIMARY KEY,
        sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
        applied_at timestamptz NOT NULL DEFAULT now()
      )
    `);
    for (const file of files) {
      const sql = await readFile(resolve(migrationsDirectory, file), 'utf8');
      const digest = canonicalDigest(sql);
      await client.query(sql);
      await client.query(
        `INSERT INTO learning_schema_migrations (name, sha256)
         VALUES ($1, $2)
         ON CONFLICT (name) DO UPDATE SET sha256 = EXCLUDED.sha256`,
        [file, digest],
      );
    }
    await client.query('COMMIT');
    return files;
  } catch (error) {
    await client.query('ROLLBACK').catch(() => undefined);
    throw error;
  }
}

async function tableColumns(client, table) {
  const { rows } = await client.query(
    `SELECT
       attribute.attname AS column_name,
       pg_catalog.format_type(attribute.atttypid, attribute.atttypmod) AS sql_type
     FROM pg_catalog.pg_attribute AS attribute
     JOIN pg_catalog.pg_class AS relation ON relation.oid = attribute.attrelid
     JOIN pg_catalog.pg_namespace AS namespace ON namespace.oid = relation.relnamespace
     WHERE namespace.nspname = 'public'
       AND relation.relname = $1
       AND attribute.attnum > 0
       AND NOT attribute.attisdropped
       AND attribute.attgenerated = ''
       AND attribute.attidentity <> 'a'
     ORDER BY attribute.attnum`,
    [table],
  );
  return rows.map((row) => ({
    name: row.column_name,
    sqlType: row.sql_type,
  }));
}

async function copyTable({ sourceConnectionString, target, table }) {
  const columns = await tableColumns(target, table);
  if (!columns.length) return { rowCount: 0, columns: 0 };
  const quotedTable = quoteIdentifier(table);
  const quotedColumns = columns.map((column) => quoteIdentifier(column.name)).join(', ');
  const remoteColumns = columns
    .map((column) => `${quoteIdentifier(column.name)} ${column.sqlType}`)
    .join(', ');
  try {
    const result = await target.query(
      `INSERT INTO ${quotedTable} (${quotedColumns})
       SELECT ${quotedColumns}
       FROM dblink($1, $2) AS remote_source(${remoteColumns})`,
      [sourceConnectionString, `SELECT ${quotedColumns} FROM public.${quotedTable}`],
    );
    return { rowCount: result.rowCount ?? 0, columns: columns.length };
  } catch (error) {
    throw new Error(`Restore copy failed for ${table}: ${error instanceof Error ? error.message : String(error)}`);
  }
}

async function main() {
  for (const path of ['.env.production.local', '.env.local', '.env.development.local']) {
    await loadEnvFile(resolve(path));
  }
  const sourceConnectionString =
    process.env.DATABASE_URL_UNPOOLED ??
    process.env.POSTGRES_URL_NON_POOLING ??
    process.env.DATABASE_URL ??
    process.env.POSTGRES_URL;
  if (!sourceConnectionString) throw new Error('No database connection is configured.');

  const drillId = `vaultide_restore_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}_${randomBytes(5).toString('hex')}`;
  const sourcePool = new Pool({ connectionString: sourceConnectionString });
  const source = await sourcePool.connect();
  let targetPool;
  let target;
  let created = false;
  const report = {
    version: 1,
    kind: 'isolated-learning-schema-and-data-restore-drill',
    startedAt: new Date().toISOString(),
    drillId,
    sourceContentsPersisted: false,
    temporaryDatabaseDestroyed: false,
    status: 'started',
  };

  try {
    const { rows: [privilege] } = await source.query(
      `SELECT (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS can_create_database`,
    );
    if (!privilege?.can_create_database) throw new Error('Database role cannot create an isolated restore database.');

    const migrationFiles = (await readdir(migrationsDirectory))
      .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file))
      .sort();
    const tableNames = [];
    for (const file of migrationFiles) {
      const sql = await readFile(resolve(migrationsDirectory, file), 'utf8');
      for (const match of sql.matchAll(/CREATE TABLE IF NOT EXISTS ([a-z][a-z0-9_]*)/g)) {
        tableNames.push(match[1]);
      }
    }
    const uniqueTables = [...new Set(tableNames)].sort();
    const { rows: foreignKeys } = await source.query(
      `SELECT DISTINCT table_name AS child, constraint_name
       FROM information_schema.table_constraints
       WHERE constraint_type = 'FOREIGN KEY'
         AND table_schema = 'public'`,
    );
    // The learning schema deliberately contains nullable back-references
    // (for example, a session may point at its latest context pack while the
    // context pack records the session that produced it).  In the isolated
    // target only, make FK checks deferred and verify them at transaction end.
    // This copies a consistent snapshot without disabling constraints or
    // weakening production integrity.
    const orderedTables = uniqueTables;

    await source.query(`CREATE DATABASE ${quoteIdentifier(drillId)}`);
    created = true;
    targetPool = new Pool({ connectionString: targetConnectionString(sourceConnectionString, drillId) });
    target = await targetPool.connect();
    const appliedMigrations = await applyMigrations(target);
    await target.query('CREATE EXTENSION IF NOT EXISTS dblink');

    const copied = {};
    await target.query('BEGIN');
    try {
      for (const foreignKey of foreignKeys) {
        if (!orderedTables.includes(foreignKey.child)) continue;
        await target.query(
          `ALTER TABLE ${quoteIdentifier(foreignKey.child)}
           ALTER CONSTRAINT ${quoteConstraintIdentifier(foreignKey.constraint_name)}
           DEFERRABLE INITIALLY DEFERRED`,
        );
      }
      await target.query('SET CONSTRAINTS ALL DEFERRED');
      for (const table of orderedTables) {
        copied[table] = await copyTable({ sourceConnectionString, target, table });
      }
      // This is the integrity checkpoint: PostgreSQL must accept every
      // deferred relationship before the isolated copy is committed.
      await target.query('SET CONSTRAINTS ALL IMMEDIATE');
      await target.query('COMMIT');
    } catch (error) {
      await target.query('ROLLBACK').catch(() => undefined);
      throw error;
    }

    const reconciliation = {};
    for (const table of orderedTables) {
      const identifier = quoteIdentifier(table);
      const [sourceCount, targetCount] = await Promise.all([
        source.query(`SELECT COUNT(*)::int AS count FROM ${identifier}`),
        target.query(`SELECT COUNT(*)::int AS count FROM ${identifier}`),
      ]);
      const expected = Number(sourceCount.rows[0].count);
      const restored = Number(targetCount.rows[0].count);
      if (expected !== restored) throw new Error(`Restore row-count mismatch for ${table}: ${expected} != ${restored}`);
      reconciliation[table] = expected;
    }

    const essentialTables = ['learning_classrooms', 'course_generation_jobs', 'writeback_commands'];
    for (const table of essentialTables) {
      if (!orderedTables.includes(table)) throw new Error(`Required restore table is missing: ${table}`);
      await target.query(`SELECT 1 FROM ${quoteIdentifier(table)} LIMIT 1`);
    }

    report.status = 'passed';
    report.migrationCount = appliedMigrations.length;
    report.learningTableCount = orderedTables.length;
    report.totalRestoredRows = Object.values(reconciliation).reduce((total, count) => total + count, 0);
    report.tableCountsSha256 = createHash('sha256')
      .update(JSON.stringify(reconciliation), 'utf8')
      .digest('hex');
    report.copiedTableSchemaSha256 = createHash('sha256')
      .update(JSON.stringify(copied), 'utf8')
      .digest('hex');
  } catch (error) {
    report.status = 'failed';
    report.error = error instanceof Error ? error.message : String(error);
    throw error;
  } finally {
    if (target) target.release();
    if (targetPool) await targetPool.end();
    if (created) {
      await source.query(`DROP DATABASE IF EXISTS ${quoteIdentifier(drillId)}`);
      report.temporaryDatabaseDestroyed = true;
    }
    report.finishedAt = new Date().toISOString();
    await mkdir(reportDirectory, { recursive: true });
    await writeFile(reportPath, `${JSON.stringify(report, null, 2)}\n`, 'utf8');
    source.release();
    await sourcePool.end();
  }

  console.log(JSON.stringify({
    status: report.status,
    migrationCount: report.migrationCount,
    learningTableCount: report.learningTableCount,
    totalRestoredRows: report.totalRestoredRows,
    temporaryDatabaseDestroyed: report.temporaryDatabaseDestroyed,
    reportPath: 'reports/content-engine-v3/g0-20260802-baseline/isolated-learning-restore-drill.json',
  }));
}

await main();
