import { createHash } from 'node:crypto';
import { readdir, readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { Pool } from '@neondatabase/serverless';

async function loadEnvFile(path) {
  try {
    const content = await readFile(path, 'utf8');
    for (const rawLine of content.split(/\r?\n/)) {
      const line = rawLine.trim();
      if (!line || line.startsWith('#')) continue;
      const equals = line.indexOf('=');
      if (equals < 1) continue;
      const key = line.slice(0, equals).trim();
      let value = line.slice(equals + 1).trim();
      if (
        value.length >= 2 &&
        ((value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'")))
      ) {
        value = value.slice(1, -1);
      }
      if (!process.env[key]) process.env[key] = value;
    }
  } catch (error) {
    if (error?.code !== 'ENOENT') throw error;
  }
}

await loadEnvFile(resolve('.env.local'));
await loadEnvFile(resolve('.env.development.local'));

const connectionString =
  process.env.DATABASE_URL_UNPOOLED ??
  process.env.POSTGRES_URL_NON_POOLING ??
  process.env.DATABASE_URL ??
  process.env.POSTGRES_URL;

if (!connectionString) {
  throw new Error('No Neon/Postgres connection URL is configured. Pull Vercel env first.');
}

const migrationsDirectory = resolve('db/migrations/learning');
const files = (await readdir(migrationsDirectory))
  .filter((file) => /^\d+_[a-z0-9_-]+\.sql$/.test(file))
  .sort();

const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  await client.query('BEGIN');
  await client.query("SELECT pg_advisory_xact_lock(hashtext('openmaic-learning-migrations'))");
  await client.query(`
    CREATE TABLE IF NOT EXISTS learning_schema_migrations (
      name text PRIMARY KEY,
      sha256 text NOT NULL CHECK (sha256 ~ '^[a-f0-9]{64}$'),
      applied_at timestamptz NOT NULL DEFAULT now()
    )
  `);

  for (const file of files) {
    const sql = await readFile(resolve(migrationsDirectory, file), 'utf8');
    // Git may check SQL files out with CRLF on Windows. Migration identity is
    // based on canonical LF text so the same migration does not look modified
    // merely because it is executed from a different operating system.
    const canonicalSql = sql.replace(/\r\n?/g, '\n');
    const digest = createHash('sha256').update(canonicalSql, 'utf8').digest('hex');
    const rawDigest = createHash('sha256').update(sql, 'utf8').digest('hex');
    const applied = await client.query(
      'SELECT sha256 FROM learning_schema_migrations WHERE name = $1',
      [file],
    );
    if (applied.rows[0]) {
      if (applied.rows[0].sha256 !== digest && applied.rows[0].sha256 !== rawDigest) {
        throw new Error(`Applied migration ${file} has changed; create a new migration instead.`);
      }
      process.stdout.write(`skip ${file}\n`);
      continue;
    }
    await client.query(sql);
    await client.query(
      'INSERT INTO learning_schema_migrations (name, sha256) VALUES ($1, $2)',
      [file, digest],
    );
    process.stdout.write(`apply ${file}\n`);
  }

  await client.query('COMMIT');
} catch (error) {
  await client.query('ROLLBACK');
  throw error;
} finally {
  client.release();
  await pool.end();
}
