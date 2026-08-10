import { readFile } from 'node:fs/promises';
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

if (!connectionString) throw new Error('No Neon/Postgres connection URL is configured.');

const ACTIVE_EVENT_TYPES = [
  'diagnosisAnswered',
  'retrievalAttempted',
  'explanationSubmitted',
  'practiceSubmitted',
  'whiteboardNoteAdded',
  'discussionParticipated',
  'evidenceSubmitted',
  'evidenceEvaluated',
  'transferTaskCompleted',
  'reviewCompleted',
];

const pool = new Pool({ connectionString });
const client = await pool.connect();

try {
  const owners = await client.query('SELECT id FROM learning_owners ORDER BY created_at');
  if (owners.rows.length === 0) throw new Error('No learning owner exists.');

  for (const { id: ownerId } of owners.rows) {
    const classrooms = await client.query(
      `
        SELECT s.classroom_id,
               (s.source_bundle_id IS NOT NULL) AS has_obsidian,
               (s.research_run_id IS NOT NULL) AS has_external,
               COALESCE((
                 SELECT COUNT(*)::integer
                 FROM learning_events e
                 WHERE e.owner_id = s.owner_id
                   AND e.sprint_id = s.id
                   AND e.event_type = ANY($2::text[])
               ), 0) AS active_event_count,
               EXISTS (
                 SELECT 1
                 FROM writeback_drafts d
                 JOIN writeback_commands c ON c.draft_id = d.id
                 JOIN writeback_receipts r ON r.command_id = c.id AND r.outcome = 'applied'
                 WHERE d.owner_id = s.owner_id AND d.sprint_id = s.id
               ) AS learning_writeback_applied,
               COALESCE((
                 SELECT COUNT(*)::integer
                 FROM research_sources rs
                 WHERE rs.owner_id = s.owner_id
                   AND rs.run_id = s.research_run_id
                   AND rs.authority IN ('primary', 'authoritative')
               ), 0) AS authoritative_source_count
        FROM learning_sprints s
        WHERE s.owner_id = $1
        ORDER BY s.created_at
      `,
      [ownerId, ACTIVE_EVENT_TYPES],
    );
    const syntheses = await client.query(
      `
        SELECT sr.id, sr.classroom_count,
               EXISTS (
                 SELECT 1
                 FROM writeback_drafts d
                 JOIN writeback_commands c ON c.draft_id = d.id
                 JOIN writeback_receipts r ON r.command_id = c.id AND r.outcome = 'applied'
                 WHERE d.owner_id = sr.owner_id AND d.synthesis_run_id = sr.id
               ) AS synthesis_writeback_applied
        FROM synthesis_runs sr
        WHERE sr.owner_id = $1
        ORDER BY sr.created_at DESC
      `,
      [ownerId],
    );

    const externalFlow = classrooms.rows.some(
      (row) =>
        row.has_external &&
        Number(row.authoritative_source_count) > 0 &&
        Number(row.active_event_count) > 0 &&
        row.learning_writeback_applied,
    );
    const obsidianFlow = classrooms.rows.some(
      (row) =>
        row.has_obsidian && Number(row.active_event_count) > 0 && row.learning_writeback_applied,
    );
    const synthesisFlow = syntheses.rows.some(
      (row) => Number(row.classroom_count) >= 2 && row.synthesis_writeback_applied,
    );
    const multiClassroom = classrooms.rows.length >= 3;
    const gates = [
      ['至少 3 个持久课堂', multiClassroom],
      ['外部权威检索 → 主动学习 → Obsidian 回写', externalFlow],
      ['Obsidian 来源 → 主动学习 → 进度回写', obsidianFlow],
      ['至少 2 个课堂归纳 → 三维图 → Obsidian 归纳回写', synthesisFlow],
    ];

    process.stdout.write(`\n学习目标验收（owner ${String(ownerId).slice(0, 12)}…）\n`);
    for (const [label, passed] of gates) {
      process.stdout.write(`${passed ? 'PASS' : 'WAIT'} ${label}\n`);
    }
    process.stdout.write(
      `数据：课堂 ${classrooms.rows.length}，归纳 ${syntheses.rows.length}，主动事件 ${classrooms.rows.reduce((sum, row) => sum + Number(row.active_event_count), 0)}\n`,
    );

    if (!gates.every(([, passed]) => passed) && !process.argv.includes('--report-only')) {
      process.exitCode = 2;
    }
  }
} finally {
  client.release();
  await pool.end();
}
