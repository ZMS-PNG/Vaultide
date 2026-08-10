import { randomBytes } from 'node:crypto';
import { spawnSync } from 'node:child_process';
import { readFile, readdir, mkdir, writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from 'pg';

for (const file of ['.env.production.local', '.env.local', '.env.development.local']) {
  try {
    const raw = await readFile(resolve(file), 'utf8');
    for (const line of raw.split(/\r?\n/)) {
      const match = line.match(/^\s*([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.*)\s*$/);
      if (!match || process.env[match[1]]) continue;
      let value = match[2];
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      process.env[match[1]] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

const sourceConnectionString =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL;
if (!sourceConnectionString) throw new Error('No database connection is configured.');

const providedName = process.argv[2];
const generatedName = `openmaic_v3_canary_${new Date().toISOString().slice(0, 10).replaceAll('-', '')}_${randomBytes(4).toString('hex')}`;
const databaseName = providedName ?? generatedName;
if (!/^openmaic_v3_canary_\d{8}_[a-f0-9]{8}$/.test(databaseName)) {
  throw new Error('Canary database name must use openmaic_v3_canary_YYYYMMDD_<8 lowercase hex>.');
}

const targetUrl = new URL(sourceConnectionString);
targetUrl.pathname = `/${databaseName}`;
const targetConnectionString = targetUrl.toString();
const migrationDirectory = resolve('db/migrations/learning');
const expectedMigrationCount = (await readdir(migrationDirectory)).filter((file) => file.endsWith('.sql')).length;
if (expectedMigrationCount === 0) throw new Error('No learning migrations were found for the canary database.');
const sourcePool = new Pool({ connectionString: sourceConnectionString });
const source = await sourcePool.connect();
let created = false;

try {
  const { rows: [privilege] } = await source.query(
    `SELECT (SELECT rolcreatedb FROM pg_roles WHERE rolname = current_user) AS can_create_database`,
  );
  if (!privilege?.can_create_database) throw new Error('Database role cannot create the V3 canary database.');
  const { rows: [existing] } = await source.query(
    'SELECT EXISTS (SELECT 1 FROM pg_database WHERE datname = $1) AS exists',
    [databaseName],
  );
  if (existing.exists) throw new Error(`Refusing to reuse existing canary database: ${databaseName}`);
  await source.query(`CREATE DATABASE "${databaseName}"`);
  created = true;
  const migration = spawnSync(process.execPath, ['scripts/run-learning-migrations.mjs'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      DATABASE_URL_UNPOOLED: targetConnectionString,
      DATABASE_URL: targetConnectionString,
      POSTGRES_URL_NON_POOLING: targetConnectionString,
      POSTGRES_URL: targetConnectionString,
    },
    encoding: 'utf8',
  });
  if (migration.status !== 0) {
    throw new Error(`Canary migrations failed: ${(migration.stderr || migration.stdout || 'unknown failure').trim()}`);
  }
  const targetPool = new Pool({ connectionString: targetConnectionString });
  const target = await targetPool.connect();
  try {
    const { rows: [migrationCount] } = await target.query('SELECT COUNT(*)::int AS count FROM learning_schema_migrations');
    if (Number(migrationCount.count) !== expectedMigrationCount) {
      throw new Error('Canary migration ledger is incomplete.');
    }
  } finally {
    target.release();
    await targetPool.end();
  }

  const reportDirectory = resolve('reports/content-engine-v3/g0-20260802-baseline');
  await mkdir(reportDirectory, { recursive: true });
  await writeFile(
    resolve(reportDirectory, 'v3-canary-database.json'),
    `${JSON.stringify({
      version: 1,
      createdAt: new Date().toISOString(),
      databaseName,
      migrationCount: expectedMigrationCount,
      sourceDatabaseValuesPersisted: false,
      canaryConnectionValuesPersisted: false,
    }, null, 2)}\n`,
    'utf8',
  );
  console.log(JSON.stringify({ status: 'passed', databaseName, migrationCount: expectedMigrationCount }));
} catch (error) {
  if (created) await source.query(`DROP DATABASE IF EXISTS "${databaseName}"`).catch(() => undefined);
  throw error;
} finally {
  source.release();
  await sourcePool.end();
}
