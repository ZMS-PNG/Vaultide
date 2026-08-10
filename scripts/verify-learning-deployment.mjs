import { createHash, randomBytes } from 'node:crypto';
import { existsSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { spawnSync } from 'node:child_process';
import { Pool } from '@neondatabase/serverless';
import {
  canonicalSourceManifest,
  LEARNING_PROTOCOL_VERSION,
  stampSourceArchive,
  stampSourceBundle,
} from '@openmaic/learning-protocol';
import { del } from '@vercel/blob';
import { upload } from '@vercel/blob/client';

const deploymentUrl = process.argv.slice(2).find((argument) => argument !== '--');
if (!deploymentUrl || !/^https:\/\/[a-z0-9-]+\.vercel\.app$/i.test(deploymentUrl)) {
  throw new Error('Pass the exact HTTPS Vercel deployment URL as the first argument.');
}

function loadLocalEnv() {
  const values = new Map();
  const envFile = process.env.OPENMAIC_ENV_FILE ?? resolve('.env.local');
  for (const line of readFileSync(envFile, 'utf8').split(/\r?\n/)) {
    const match = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (!match) continue;
    let value = match[2];
    if (
      value.length >= 2 &&
      ((value.startsWith('"') && value.endsWith('"')) ||
        (value.startsWith("'") && value.endsWith("'")))
    ) {
      value = value.slice(1, -1);
    }
    values.set(match[1], value);
  }
  return values;
}

const localEnv = loadLocalEnv();
const accessCode = localEnv.get('ACCESS_CODE');
if (!accessCode || accessCode.length > 256) {
  throw new Error('A valid ACCESS_CODE was not found in the selected environment file.');
}
const cronSecret = localEnv.get('CRON_SECRET');
if (!cronSecret || cronSecret.length < 32) {
  throw new Error('A valid CRON_SECRET was not found in .env.local.');
}

const appData = process.env.APPDATA;
const vercelCli = appData ? resolve(appData, 'npm/node_modules/vercel/dist/index.js') : undefined;
if (!vercelCli || !existsSync(vercelCli)) {
  throw new Error('The authenticated Vercel CLI installation was not found.');
}

const linkedProject = JSON.parse(readFileSync(resolve('.vercel/project.json'), 'utf8'));
const projectResult = spawnSync(
  process.execPath,
  [
    vercelCli,
    'api',
    `/v9/projects/${encodeURIComponent(linkedProject.projectId)}?teamId=${encodeURIComponent(linkedProject.orgId)}`,
    '--raw',
  ],
  { cwd: process.cwd(), encoding: 'utf8', maxBuffer: 10 * 1024 * 1024 },
);
if (projectResult.status !== 0) {
  throw new Error('Unable to read Vercel deployment protection settings.');
}
let projectDetails;
try {
  projectDetails = JSON.parse(projectResult.stdout);
} catch {
  throw new Error('Vercel returned invalid project protection metadata.');
}
const protectionBypass = Object.entries(projectDetails.protectionBypass ?? {}).find(
  ([, value]) => value?.scope === 'automation-bypass',
)?.[0];
if (!protectionBypass) {
  throw new Error('No Vercel automation protection bypass is configured for deployment QA.');
}

const tempRoot = mkdtempSync(join(tmpdir(), 'openmaic-learning-smoke-'));
const cookieJar = join(tempRoot, 'cookies.txt');
let requestNumber = 0;
const DEPLOYMENT_REQUEST_TIMEOUT_MS = 45_000;

function request(
  path,
  { method = 'GET', body, headers = {}, useCookies = false, captureCookies = false } = {},
) {
  requestNumber += 1;
  const marker = `__OPENMAIC_STATUS_${requestNumber}__:`;
  const headerPath = join(tempRoot, `headers-${requestNumber}.txt`);
  const responseHeaderPath = join(tempRoot, `response-headers-${requestNumber}.txt`);
  // Do not supply a project-metadata key as a protection header here.  `vercel
  // curl` obtains the active deployment's real short-lived bypass token itself;
  // an additional header can override that token and cause an SSO redirect.
  const headerLines = Object.entries(headers).map(([name, value]) => `${name}: ${value}`);
  if (body !== undefined) headerLines.push('Content-Type: application/json');
  if (headerLines.length > 0) {
    writeFileSync(headerPath, `${headerLines.join('\n')}\n`, { encoding: 'utf8', mode: 0o600 });
  }

  const curlArgs = [
    '--silent',
    '--show-error',
    '--connect-timeout',
    '10',
    '--max-time',
    '40',
    '--dump-header',
    responseHeaderPath,
    '--write-out',
    `\n${marker}%{http_code}`,
    '--request',
    method,
  ];
  if (headerLines.length > 0) curlArgs.push('--header', `@${headerPath}`);
  if (useCookies) curlArgs.push('--cookie', cookieJar);
  if (captureCookies) curlArgs.push('--cookie-jar', cookieJar);
  if (body !== undefined) curlArgs.push('--data-binary', '@-');

  // The official Vercel CLI injects a valid bypass token for the target
  // deployment.  Its beta Windows transport can occasionally fail before any
  // request leaves the machine, so retry the *same* protected request once.  A
  // native curl fallback is deliberately not used: the project metadata exposes
  // an identifier, not the current per-deployment bypass secret.
  let result;
  let transportError;
  for (let attempt = 1; attempt <= 2; attempt += 1) {
    result = spawnSync(
      process.execPath,
      [vercelCli, 'curl', path, '--deployment', deploymentUrl, '--', ...curlArgs],
      {
        cwd: process.cwd(),
        encoding: 'utf8',
        input: body === undefined ? undefined : JSON.stringify(body),
        maxBuffer: 10 * 1024 * 1024,
        timeout: DEPLOYMENT_REQUEST_TIMEOUT_MS,
      },
    );
    if (result.status === 0 || result.error?.code === 'ETIMEDOUT') break;
    transportError = result.stderr?.trim() || result.error?.message;
  }
  if (result.error?.code === 'ETIMEDOUT') {
    throw new Error(
      `Deployment request timed out after ${DEPLOYMENT_REQUEST_TIMEOUT_MS / 1_000}s for ${path}. ` +
        'Keep the release gate closed and inspect the deployment/runtime before retrying.',
    );
  }
  if (result.status !== 0) {
    const detail = result.stderr?.trim() || result.error?.message;
    throw new Error(
      `Vercel CLI could not reach ${path} after two protected attempts${detail || transportError ? `: ${detail || transportError}` : '.'}`,
    );
  }
  const markerAt = result.stdout.lastIndexOf(marker);
  if (markerAt < 0) {
    throw new Error(`Vercel curl did not return an HTTP status for ${path}.`);
  }
  const status = Number(result.stdout.slice(markerAt + marker.length).trim());
  const responseText = result.stdout.slice(0, markerAt).trim();
  let json;
  try {
    json = responseText ? JSON.parse(responseText) : null;
  } catch {
    const responseKind = responseText.trimStart().startsWith('<') ? 'HTML' : 'non-JSON';
    const redirect = existsSync(responseHeaderPath)
      ? readFileSync(responseHeaderPath, 'utf8')
          .split(/\r?\n/)
          .find((line) => /^location:/i.test(line))
          ?.replace(/x-vercel-protection-bypass=[^&\s]+/gi, 'x-vercel-protection-bypass=[redacted]')
      : undefined;
    throw new Error(
      `Deployment returned ${responseKind} content (HTTP ${status}) for ${path}; ` +
        `the deployment protection or proxy boundary did not reach the JSON API${redirect ? ` (${redirect})` : ''}.`,
    );
  }
  return { status, json };
}

function expectStatus(label, response, expected) {
  if (response.status !== expected) {
    const code = response.json?.error?.code;
    const message = response.json?.error?.message;
    throw new Error(
      `${label} returned HTTP ${response.status}${code ? ` (${code})` : ''}${message ? `: ${message}` : ''}.`,
    );
  }
  process.stdout.write(`pass ${label}: HTTP ${expected}\n`);
}

const sha256 = (value) => createHash('sha256').update(value, 'utf8').digest('hex');

function sourceArchive(ownerId, vaultBindingId) {
  const now = new Date();
  const content = [
    '# Deployment validation policy',
    '',
    'Deployment smoke tests must use synthetic data only.',
    'A smoke test must not read, modify, or write any personal Obsidian Vault note.',
    'Before a source is used for learning, the source archive integrity round trip must pass.',
    'A successful validation records a controlled, device-bound writeback only after verified learning evidence passes.',
    '',
  ].join('\n');
  const snapshot = {
    id: `snp_${randomBytes(16).toString('hex')}`,
    origin: 'obsidian',
    title: 'Deployment upload smoke',
    contentHash: sha256(content),
    mimeType: 'text/markdown',
    byteSize: Buffer.byteLength(content),
    headings: undefined,
    tags: undefined,
    outboundLinks: undefined,
    locator: {
      kind: 'obsidian',
      vaultBindingId,
      relativePath: 'Smoke/Deployment.md',
      noteId: undefined,
      sourceMtime: now.toISOString(),
    },
  };
  const provisional = stampSourceBundle({
    id: `src_${randomBytes(16).toString('hex')}`,
    ownerId,
    revision: 1,
    manifestHash: '0'.repeat(64),
    byteSize: snapshot.byteSize,
    itemCount: 1,
    selectionReason: 'Synthetic deployment validation',
    sourcePolicy: { externalSearch: 'disabled' },
    snapshots: [snapshot],
    retentionUntil: new Date(now.getTime() + 24 * 60 * 60 * 1000).toISOString(),
    createdAt: now.toISOString(),
  });
  const bundle = { ...provisional, manifestHash: sha256(canonicalSourceManifest(provisional)) };
  return stampSourceArchive({
    bundle,
    contents: [{ snapshotId: snapshot.id, utf8Content: content }],
  });
}

const protocolHeaders = { 'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION };

let smokeClassroomId;
let smokeSourceBundleId;
let smokeDeviceId;
let smokeVaultBindingId;
let smokeOwnerId;
let smokeSynthesisId;
let smokeSessionId;
let smokeContextPackId;

async function createSyntheticLearningSession({ ownerId, classroomId, sourceBundleId, sourceText }) {
  const connectionString =
    localEnv.get('DATABASE_URL_UNPOOLED') ??
    localEnv.get('POSTGRES_URL_NON_POOLING') ??
    localEnv.get('DATABASE_URL') ??
    localEnv.get('POSTGRES_URL');
  if (!connectionString) throw new Error('Smoke session setup could not find a database connection.');
  const now = new Date();
  smokeSessionId = `lsn_${randomBytes(16).toString('hex')}`;
  smokeContextPackId = `ctx_${randomBytes(16).toString('hex')}`;
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    await client.query('BEGIN');
    await client.query(
      `
        INSERT INTO learning_sessions
          (id, owner_id, goal, source_mode, status, source_bundle_id, metadata, created_at, updated_at)
        VALUES ($1, $2, $3, 'obsidian', 'learning', $4, $5::jsonb, $6, $6)
      `,
      [
        smokeSessionId,
        ownerId,
        'Verify durable learning evidence and controlled Obsidian writeback.',
        sourceBundleId,
        JSON.stringify({ classroomId, syntheticDeploymentSmoke: true }),
        now,
      ],
    );
    await client.query(
      `
        INSERT INTO learning_context_packs
          (id, owner_id, session_id, status, source_manifest, source_text, source_sha256,
           selected_episodes, exclusions, unresolved_items, created_at, frozen_at)
        VALUES ($1, $2, $3, 'frozen', $4::jsonb, $5, $6, '[]'::jsonb, '[]'::jsonb, '[]'::jsonb, $7, $7)
      `,
      [
        smokeContextPackId,
        ownerId,
        smokeSessionId,
        JSON.stringify({ sourceBundleId, syntheticDeploymentSmoke: true }),
        sourceText,
        sha256(sourceText),
        now,
      ],
    );
    await client.query(
      'UPDATE learning_sessions SET current_context_pack_id = $3, updated_at = $4 WHERE owner_id = $1 AND id = $2',
      [ownerId, smokeSessionId, smokeContextPackId, now],
    );
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
}

async function inspectSyntheticEvidence(sprintId) {
  const connectionString =
    localEnv.get('DATABASE_URL_UNPOOLED') ??
    localEnv.get('POSTGRES_URL_NON_POOLING') ??
    localEnv.get('DATABASE_URL') ??
    localEnv.get('POSTGRES_URL');
  if (!connectionString || !smokeOwnerId) return { accepted: 0, snapshots: 0, verdicts: [] };
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  try {
    const rows = await client.query(
      `
        SELECT payload ->> 'verdict' AS verdict, payload ->> 'score' AS score
        FROM learning_events
        WHERE owner_id = $1 AND sprint_id = $2 AND event_type = 'evidenceEvaluated'
        ORDER BY server_seq
      `,
      [smokeOwnerId, sprintId],
    );
    const snapshots = smokeSessionId
      ? await client.query(
          'SELECT count(*)::int AS count FROM learning_knowledge_snapshots WHERE owner_id = $1 AND session_id = $2',
          [smokeOwnerId, smokeSessionId],
        )
      : { rows: [{ count: 0 }] };
    const verdicts = rows.rows.map((row) => ({ verdict: row.verdict, score: row.score }));
    const snapshotCount = Number(snapshots.rows[0]?.count ?? 0);
    process.stdout.write(`evidence verdicts: ${JSON.stringify(verdicts)}; snapshots=${snapshotCount}\n`);
    return {
      accepted: verdicts.filter((row) => row.verdict === 'passed').length,
      snapshots: snapshotCount,
      verdicts,
    };
  } finally {
    client.release();
    await pool.end();
  }
}

function wait(milliseconds) {
  return new Promise((resolve) => setTimeout(resolve, milliseconds));
}

async function waitForVerifiedEvidence(sprintId) {
  const deadline = Date.now() + 75_000;
  let latest = await inspectSyntheticEvidence(sprintId);
  while (Date.now() < deadline) {
    if (latest.accepted >= 3 && latest.snapshots >= 1) return latest;
    await wait(1_500);
    latest = await inspectSyntheticEvidence(sprintId);
  }
  throw new Error(
    `Deferred evidence evaluation did not reach its durable verified state within 75 seconds: ` +
      `pass=${latest.accepted}, snapshots=${latest.snapshots}.`,
  );
}

async function cleanupWritebackSmoke() {
  if (!smokeClassroomId && !smokeSourceBundleId && !smokeDeviceId && !smokeSynthesisId && !smokeSessionId) return;
  const connectionString =
    localEnv.get('DATABASE_URL_UNPOOLED') ??
    localEnv.get('POSTGRES_URL_NON_POOLING') ??
    localEnv.get('DATABASE_URL') ??
    localEnv.get('POSTGRES_URL');
  if (!connectionString) throw new Error('Smoke cleanup could not find a database connection.');
  const pool = new Pool({ connectionString });
  const client = await pool.connect();
  const blobUrls = [];
  try {
    await client.query('BEGIN');
    if (smokeSynthesisId && smokeOwnerId) {
      await client.query(
        `
          DELETE FROM writeback_receipts
          WHERE command_id IN (
            SELECT c.id FROM writeback_commands c
            JOIN writeback_drafts d ON d.id = c.draft_id
            WHERE d.owner_id = $1 AND d.synthesis_run_id = $2
          )
        `,
        [smokeOwnerId, smokeSynthesisId],
      );
      await client.query(
        `
          DELETE FROM writeback_commands
          WHERE draft_id IN (
            SELECT id FROM writeback_drafts WHERE owner_id = $1 AND synthesis_run_id = $2
          )
        `,
        [smokeOwnerId, smokeSynthesisId],
      );
      await client.query(
        'DELETE FROM writeback_drafts WHERE owner_id = $1 AND synthesis_run_id = $2',
        [smokeOwnerId, smokeSynthesisId],
      );
      await client.query(
        'DELETE FROM knowledge_graph_refresh_requests WHERE owner_id = $1 AND synthesis_id = $2',
        [smokeOwnerId, smokeSynthesisId],
      );
      await client.query(
        'DELETE FROM knowledge_graph_projections WHERE owner_id = $1 AND synthesis_id = $2',
        [smokeOwnerId, smokeSynthesisId],
      );
      await client.query('DELETE FROM synthesis_runs WHERE owner_id = $1 AND id = $2', [
        smokeOwnerId,
        smokeSynthesisId,
      ]);
    }
    if (smokeClassroomId && smokeOwnerId) {
      await client.query(
        'DELETE FROM knowledge_graph_refresh_requests WHERE owner_id = $1 AND classroom_id = $2',
        [smokeOwnerId, smokeClassroomId],
      );
      const classroom = await client.query(
        'SELECT snapshot_blob_url FROM learning_classrooms WHERE owner_id = $1 AND classroom_id = $2',
        [smokeOwnerId, smokeClassroomId],
      );
      if (classroom.rows[0]?.snapshot_blob_url) blobUrls.push(classroom.rows[0].snapshot_blob_url);
      await client.query(
        `
          DELETE FROM writeback_receipts
          WHERE command_id IN (
            SELECT c.id FROM writeback_commands c
            JOIN writeback_drafts d ON d.id = c.draft_id
            JOIN learning_sprints s ON s.id = d.sprint_id
            WHERE s.owner_id = $1 AND s.classroom_id = $2
          )
        `,
        [smokeOwnerId, smokeClassroomId],
      );
      await client.query(
        `
          DELETE FROM writeback_commands
          WHERE draft_id IN (
            SELECT d.id FROM writeback_drafts d
            JOIN learning_sprints s ON s.id = d.sprint_id
            WHERE s.owner_id = $1 AND s.classroom_id = $2
          )
        `,
        [smokeOwnerId, smokeClassroomId],
      );
      await client.query(
        `
          DELETE FROM writeback_drafts
          WHERE sprint_id IN (
            SELECT id FROM learning_sprints WHERE owner_id = $1 AND classroom_id = $2
          )
        `,
        [smokeOwnerId, smokeClassroomId],
      );
      await client.query(
        `
          DELETE FROM learning_events
          WHERE sprint_id IN (
            SELECT id FROM learning_sprints WHERE owner_id = $1 AND classroom_id = $2
          )
        `,
        [smokeOwnerId, smokeClassroomId],
      );
      await client.query(
        `
          DELETE FROM deposition_runs
          WHERE owner_id = $1
            AND sprint_id IN (
              SELECT id FROM learning_sprints WHERE owner_id = $1 AND classroom_id = $2
            )
        `,
        [smokeOwnerId, smokeClassroomId],
      );
      await client.query('DELETE FROM learning_sprints WHERE owner_id = $1 AND classroom_id = $2', [
        smokeOwnerId,
        smokeClassroomId,
      ]);
      await client.query(
        'DELETE FROM learning_classrooms WHERE owner_id = $1 AND classroom_id = $2',
        [smokeOwnerId, smokeClassroomId],
      );
    }
    if (smokeSessionId && smokeOwnerId) {
      await client.query(
        `
          UPDATE learning_sessions
          SET current_knowledge_snapshot_id = NULL, current_context_pack_id = NULL
          WHERE owner_id = $1 AND id = $2
        `,
        [smokeOwnerId, smokeSessionId],
      );
      await client.query(
        'DELETE FROM learning_knowledge_snapshots WHERE owner_id = $1 AND session_id = $2',
        [smokeOwnerId, smokeSessionId],
      );
      if (smokeContextPackId) {
        await client.query(
          'DELETE FROM learning_context_packs WHERE owner_id = $1 AND id = $2',
          [smokeOwnerId, smokeContextPackId],
        );
      }
      await client.query('DELETE FROM learning_sessions WHERE owner_id = $1 AND id = $2', [
        smokeOwnerId,
        smokeSessionId,
      ]);
    }
    if (smokeSourceBundleId) {
      const source = await client.query('SELECT blob_url FROM source_uploads WHERE id = $1', [
        smokeSourceBundleId,
      ]);
      if (source.rows[0]?.blob_url) blobUrls.push(source.rows[0].blob_url);
      await client.query('DELETE FROM source_uploads WHERE id = $1', [smokeSourceBundleId]);
    }
    if (smokeOwnerId && smokeDeviceId) {
      await client.query(
        'DELETE FROM learning_audit_events WHERE owner_id = $1 AND device_id = $2',
        [smokeOwnerId, smokeDeviceId],
      );
      await client.query(
        'DELETE FROM pairing_sessions WHERE owner_id = $1 AND consumed_by_device_id = $2',
        [smokeOwnerId, smokeDeviceId],
      );
      await client.query('DELETE FROM integration_tokens WHERE owner_id = $1 AND device_id = $2', [
        smokeOwnerId,
        smokeDeviceId,
      ]);
      if (smokeVaultBindingId) {
        await client.query(
          'DELETE FROM vault_bindings WHERE owner_id = $1 AND vault_binding_id = $2',
          [smokeOwnerId, smokeVaultBindingId],
        );
      }
      await client.query('DELETE FROM integration_devices WHERE owner_id = $1 AND device_id = $2', [
        smokeOwnerId,
        smokeDeviceId,
      ]);
    }
    await client.query('COMMIT');
  } catch (error) {
    await client.query('ROLLBACK');
    throw error;
  } finally {
    client.release();
    await pool.end();
  }
  const blobToken = localEnv.get('BLOB_READ_WRITE_TOKEN');
  if (blobUrls.length > 0 && blobToken) await del(blobUrls, { token: blobToken });
}

try {
  const unauthorizedMaintenance = request('/api/v1/maintenance/source-retention');
  expectStatus('retention maintenance authentication boundary', unauthorizedMaintenance, 401);

  const maintenance = request('/api/v1/maintenance/source-retention', {
    headers: { Authorization: `Bearer ${cronSecret}` },
  });
  expectStatus('authorized retention maintenance', maintenance, 200);
  if (maintenance.json?.ok !== true || maintenance.json?.failed !== 0) {
    throw new Error('Retention maintenance did not complete without failures.');
  }
  process.stdout.write(
    `pass retention maintenance result: deleted=${maintenance.json.deleted}, failed=0\n`,
  );

  const unauthorized = request('/api/v1/pairing-sessions', {
    method: 'POST',
    headers: protocolHeaders,
  });
  expectStatus('admin boundary before login', unauthorized, 401);

  const login = request('/api/access-code/verify', {
    method: 'POST',
    body: { code: accessCode },
    captureCookies: true,
  });
  expectStatus('site access code', login, 200);

  const capabilities = request('/api/v1/integration-capabilities', {
    headers: protocolHeaders,
  });
  expectStatus('capabilities', capabilities, 200);
  if (
    !capabilities.json?.features?.pairing ||
    !capabilities.json?.features?.sourceUpload ||
    !capabilities.json?.features?.researchCitations ||
    !capabilities.json?.features?.synthesis ||
    !capabilities.json?.features?.learningEvents ||
    !capabilities.json?.features?.writeback
  ) {
    throw new Error(
      'Deployment did not advertise pairing, sourceUpload, researchCitations, synthesis, learningEvents, and writeback as enabled.',
    );
  }
  process.stdout.write(
    'pass configured features: pairing=true, sourceUpload=true, researchCitations=true, synthesis=true, learningEvents=true, writeback=true\n',
  );

  const pairing = request('/api/v1/pairing-sessions', {
    method: 'POST',
    headers: protocolHeaders,
    useCookies: true,
  });
  expectStatus('pairing session creation', pairing, 201);
  if (!/^\d{6}$/.test(pairing.json?.code ?? '')) {
    throw new Error('Pairing session did not return a six-digit code.');
  }

  const identity = {
    deviceId: `dev_${randomBytes(16).toString('hex')}`,
    vaultBindingId: `vlt_${randomBytes(16).toString('hex')}`,
  };
  smokeDeviceId = identity.deviceId;
  smokeVaultBindingId = identity.vaultBindingId;
  const exchangeBody = {
    code: pairing.json.code,
    ...identity,
    vaultName: 'OpenMAIC Deployment Smoke',
    pluginVersion: '0.1.0-smoke',
  };
  const exchange = request('/api/v1/pairing-sessions/exchange', {
    method: 'POST',
    headers: protocolHeaders,
    body: exchangeBody,
  });
  expectStatus('pairing exchange', exchange, 200);
  if (!exchange.json?.accessToken || !exchange.json?.refreshToken) {
    throw new Error('Pairing exchange did not return both device credentials.');
  }

  const replay = request('/api/v1/pairing-sessions/exchange', {
    method: 'POST',
    headers: protocolHeaders,
    body: exchangeBody,
  });
  expectStatus('single-use pairing replay rejection', replay, 401);

  const refreshed = request('/api/v1/device-tokens/refresh', {
    method: 'POST',
    headers: {
      ...protocolHeaders,
      Authorization: `Bearer ${exchange.json.refreshToken}`,
    },
  });
  expectStatus('refresh rotation', refreshed, 200);
  if (!refreshed.json?.refreshToken || refreshed.json.refreshToken === exchange.json.refreshToken) {
    throw new Error('Refresh rotation did not issue a distinct refresh token.');
  }

  const archive = sourceArchive(refreshed.json.ownerId, identity.vaultBindingId);
  smokeOwnerId = refreshed.json.ownerId;
  smokeSourceBundleId = archive.bundle.id;
  const pathname = `learning-sources/${archive.bundle.ownerId}/${identity.vaultBindingId}/${archive.bundle.id}.json`;
  const handleUploadUrl = new URL('/api/v1/source-uploads', deploymentUrl);
  handleUploadUrl.searchParams.set('x-vercel-protection-bypass', protectionBypass);
  try {
    await upload(pathname, JSON.stringify(archive), {
      access: 'private',
      handleUploadUrl: handleUploadUrl.toString(),
      headers: {
        Authorization: `Bearer ${refreshed.json.accessToken}`,
        'X-MAIC-Protocol-Version': LEARNING_PROTOCOL_VERSION,
        'x-vercel-protection-bypass': protectionBypass,
      },
      clientPayload: JSON.stringify({
        bundleId: archive.bundle.id,
        manifestHash: archive.bundle.manifestHash,
        sourceByteSize: archive.bundle.byteSize,
        itemCount: archive.bundle.itemCount,
        retentionUntil: archive.bundle.retentionUntil,
      }),
      contentType: 'application/vnd.openmaic.source-archive+json',
      multipart: false,
    });
  } catch {
    throw new Error('Private Blob client upload failed on the protected deployment.');
  }
  process.stdout.write('pass private Blob client upload\n');

  let archivedSource;
  for (let attempt = 0; attempt < 5; attempt += 1) {
    archivedSource = request(`/api/v1/source-bundles/${archive.bundle.id}`, {
      headers: protocolHeaders,
      useCookies: true,
    });
    if (archivedSource.status !== 404) break;
    await new Promise((resolveDelay) => setTimeout(resolveDelay, 1_000));
  }
  expectStatus('validated private source read', archivedSource, 200);
  if (
    archivedSource.json?.bundle?.manifestHash !== archive.bundle.manifestHash ||
    archivedSource.json?.contents?.[0]?.utf8Content !== archive.contents[0].utf8Content
  ) {
    throw new Error('Private source read did not preserve the validated archive.');
  }
  process.stdout.write('pass private source integrity round trip\n');

  smokeClassroomId = `wbsmoke_${randomBytes(8).toString('hex')}`;
  const sceneId = `scene_${randomBytes(8).toString('hex')}`;
  const syntheticClassroom = request('/api/classroom', {
    method: 'POST',
    useCookies: true,
    body: {
      stage: {
        id: smokeClassroomId,
        name: 'OpenMAIC writeback deployment smoke',
        description: 'Synthetic classroom used only for deployment verification.',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        learningContext: {
          sourceBundleId: archive.bundle.id,
          goal: 'Verify durable learning progress and controlled Obsidian writeback.',
          webSearchEnabled: true,
          researchSources: [
            { title: 'TypeScript Handbook', url: 'https://www.typescriptlang.org/docs/' },
          ],
        },
      },
      scenes: [
        {
          id: sceneId,
          stageId: smokeClassroomId,
          title: 'Synthetic retrieval practice',
          order: 1,
          type: 'quiz',
          content: { type: 'quiz', questions: [] },
          actions: [],
        },
      ],
    },
  });
  expectStatus('synthetic classroom persistence', syntheticClassroom, 201);
  if (syntheticClassroom.json?.id !== smokeClassroomId) {
    throw new Error('Synthetic classroom response did not preserve its id.');
  }
  await createSyntheticLearningSession({
    ownerId: smokeOwnerId,
    classroomId: smokeClassroomId,
    sourceBundleId: archive.bundle.id,
    sourceText: archive.contents[0].utf8Content,
  });

  const retrievalEventId = `smoke-retrieval:${randomBytes(16).toString('hex')}`;
  const learningEvent = request(`/api/v1/classrooms/${smokeClassroomId}/learning-events`, {
    method: 'POST',
    headers: protocolHeaders,
    useCookies: true,
    body: {
      events: [
        {
          eventType: 'sceneViewed',
          clientEventId: `smoke-scene:${randomBytes(12).toString('hex')}`,
          occurredAt: new Date().toISOString(),
          payload: { sceneId, title: 'Synthetic retrieval practice', sceneOrder: 0 },
        },
        {
          eventType: 'retrievalAttempted',
          clientEventId: retrievalEventId,
          occurredAt: new Date().toISOString(),
          payload: {
            promptId: `smoke-recall:${sceneId}`,
            sceneId,
            response:
              'Closed-book recall: (1) deployment smoke tests must use synthetic data only; (2) they must not read, modify, or write any personal Obsidian Vault note; (3) the source archive integrity round trip must pass before that source is used for learning. One honest boundary is that the source does not specify how long synthetic smoke-test artifacts should be retained.',
          },
        },
        {
          eventType: 'explanationSubmitted',
          clientEventId: `smoke-explanation:${randomBytes(16).toString('hex')}`,
          occurredAt: new Date().toISOString(),
          payload: {
            promptId: `smoke-explanation:${sceneId}`,
            sceneId,
            response:
              'The problem is that a deployment check could trust corrupted source material or damage a real personal Vault. The named mechanism is an integrity-round-trip plus verified-evidence, device-bound writeback gate. First create synthetic source data; second upload and read the private archive back; third verify its integrity before learning use; fourth collect server-verified learning evidence; finally allow only a controlled writeback bound to the paired device. The source-grounded example is this smoke test itself: it must use synthetic data and must never read, modify, or write a personal Obsidian note. Its boundary is that passing this mechanism proves the controlled integration path, not the semantic quality of arbitrary real notes or the reliability of an external search provider.',
          },
        },
        {
          eventType: 'transferTaskCompleted',
          clientEventId: `smoke-transfer:${randomBytes(16).toString('hex')}`,
          occurredAt: new Date().toISOString(),
          payload: {
            taskId: `smoke-transfer:${sceneId}`,
            sceneId,
            outcome:
              'New situation: verify the same product in a second deployment region. My explicit learner artifact is a JSON release checklist with sourceKind="synthetic", personalVaultReads=0, archiveIntegrity="pass", evidenceGate="pass", and writebackDeviceId equal to the paired test device. I transfer the integrity-round-trip plus verified-evidence, device-bound writeback gate by creating a new synthetic archive, comparing its SHA-256 before upload and after private readback, recording that no personal Vault path was accessed, obtaining three passed server evaluations including this transfer, and approving only the command addressed to the paired device. The observable result is PASS only when every checklist field matches; otherwise release is blocked. Remaining corrections are to add network-interruption, expired-command, and replay tests before claiming regional resilience.',
          },
        },
        {
          eventType: 'practiceSubmitted',
          clientEventId: `smoke-practice:${randomBytes(16).toString('hex')}`,
          occurredAt: new Date().toISOString(),
          payload: {
            taskId: `smoke-practice:${sceneId}`,
            sceneId,
            response: JSON.stringify({
              answered: 2,
              total: 2,
              earned: 2,
              possible: 2,
              reflection:
                'Both answers are grounded in the source: deployment smoke tests use synthetic data only and never touch a personal Obsidian Vault; the source archive integrity round trip must pass before learning, and controlled device-bound writeback waits for verified learning evidence.',
            }),
          },
        },
      ],
    },
  });
  expectStatus('web learning event append', learningEvent, 202);
  if ((learningEvent.json?.accepted ?? 0) < 4 || !learningEvent.json?.sprintId) {
    throw new Error('Learning event append did not create accepted, server-evaluated sprint evidence.');
  }
  process.stdout.write(
    `evidence summary: accepted=${learningEvent.json.accepted}, deduplicated=${learningEvent.json.deduplicated}, ` +
      `mastery=${JSON.stringify(learningEvent.json.mastery ?? null)}\n`,
  );
  await waitForVerifiedEvidence(learningEvent.json.sprintId);

  const activityEvents = request(`/api/v1/classrooms/${smokeClassroomId}/learning-events`, {
    method: 'POST',
    headers: protocolHeaders,
    useCookies: true,
    body: {
      events: [
        {
          eventType: 'whiteboardNoteAdded',
          clientEventId: `smoke-whiteboard:${randomBytes(12).toString('hex')}`,
          occurredAt: new Date().toISOString(),
          payload: { sceneId, noteKind: 'question', characterCount: 24 },
        },
        {
          eventType: 'discussionParticipated',
          clientEventId: `smoke-discussion:${randomBytes(12).toString('hex')}`,
          occurredAt: new Date().toISOString(),
          payload: {
            sceneId,
            sessionId: `session_${randomBytes(8).toString('hex')}`,
            sessionType: 'qa',
            messageLength: 18,
          },
        },
      ],
    },
  });
  expectStatus('classroom activity event append', activityEvents, 202);
  if (activityEvents.json?.accepted !== 2) {
    throw new Error('Classroom activity event append did not accept both non-evidence event types.');
  }

  const duplicateLearningEvent = request(`/api/v1/classrooms/${smokeClassroomId}/learning-events`, {
    method: 'POST',
    headers: protocolHeaders,
    useCookies: true,
    body: {
      events: [
        {
          eventType: 'retrievalAttempted',
          clientEventId: retrievalEventId,
          occurredAt: new Date().toISOString(),
          payload: {
            promptId: `smoke-recall:${sceneId}`,
            sceneId,
            response:
              'The validation policy requires synthetic data only and prohibits reading, modifying, or writing any personal Obsidian Vault note.',
          },
        },
      ],
    },
  });
  expectStatus('learning event idempotent retry', duplicateLearningEvent, 202);
  if (
    duplicateLearningEvent.json?.accepted !== 0 ||
    (duplicateLearningEvent.json?.deduplicated ?? 0) < 1
  ) {
    throw new Error('Learning event retry was not deduplicated.');
  }

  const draft = request(`/api/v1/classrooms/${smokeClassroomId}/writeback-drafts`, {
    method: 'POST',
    headers: protocolHeaders,
    useCookies: true,
    body: {
      progress: {
        currentSceneId: sceneId,
        quizSummaries: [
          {
            sceneId,
            title: 'Synthetic retrieval practice',
            answered: 2,
            total: 2,
            earned: 1,
            possible: 2,
          },
        ],
      },
    },
  });
  expectStatus('writeback draft generation', draft, 201);
  console.log(
    `writeback draft metadata: ${JSON.stringify({
      relativePath: draft.json?.draft?.relativePath,
      targetVaultName: draft.json?.draft?.targetVaultName,
      hasVerifiedSnapshot: /## 已验证知识快照/u.test(draft.json?.draft?.content ?? ''),
      hasMastery: /## 掌握度与复习/u.test(draft.json?.draft?.content ?? ''),
      hasTransferRecord: /迁移任务/u.test(draft.json?.draft?.content ?? ''),
    })}`,
  );
  if (
    !/^wbd_[a-f0-9]{32}$/.test(draft.json?.draft?.id ?? '') ||
    !/^Vaultide\/.+\.md$/u.test(draft.json?.draft?.relativePath ?? '') ||
    draft.json?.draft?.relativePath?.includes('..') ||
    !/## 已验证知识快照/u.test(draft.json?.draft?.content ?? '') ||
    !/## 掌握度与复习/u.test(draft.json?.draft?.content ?? '') ||
    !/迁移任务/u.test(draft.json?.draft?.content ?? '') ||
    !(draft.json?.draft?.content ?? '').includes(archive.bundle.id) ||
    draft.json?.draft?.targetVaultName !== 'OpenMAIC Deployment Smoke'
  ) {
    throw new Error(
      'Writeback draft did not preserve its safe target, traceable source, verified snapshot, mastery, and transfer summary.',
    );
  }

  const approval = request(`/api/v1/writeback-drafts/${draft.json.draft.id}/approve`, {
    method: 'POST',
    headers: protocolHeaders,
    useCookies: true,
    body: { draftRevision: draft.json.draft.revision },
  });
  expectStatus('writeback draft approval', approval, 202);
  const command = approval.json?.command;
  if (
    !/^wbc_[a-f0-9]{32}$/.test(command?.id ?? '') ||
    command?.deviceId !== identity.deviceId ||
    command?.vaultBindingId !== identity.vaultBindingId ||
    command?.operation !== 'createManagedNote' ||
    command?.arguments?.expectedAbsent !== true
  ) {
    throw new Error('Approved command was not safely bound to the paired smoke Vault.');
  }

  const deviceHeaders = {
    ...protocolHeaders,
    Authorization: `Bearer ${refreshed.json.accessToken}`,
  };
  const pending = request('/api/v1/writeback-commands/pending?limit=10', {
    headers: deviceHeaders,
  });
  expectStatus('device writeback lease', pending, 200);
  if (pending.json?.commands?.length !== 1 || pending.json.commands[0]?.id !== command.id) {
    throw new Error('Paired device did not lease its approved command.');
  }

  const retryLease = request('/api/v1/writeback-commands/pending?limit=10', {
    headers: deviceHeaders,
  });
  expectStatus('device writeback lease retry', retryLease, 200);
  if (retryLease.json?.commands?.length !== 1 || retryLease.json.commands[0]?.id !== command.id) {
    throw new Error('Leased command was not replay-safe for the same device.');
  }

  const receipt = {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    id: `wbr_${randomBytes(16).toString('hex')}`,
    commandId: command.id,
    deviceId: identity.deviceId,
    outcome: 'applied',
    resultingContentHash: 'a'.repeat(64),
    resultingPath: command.arguments.relativePath,
    appliedAt: new Date().toISOString(),
    reportedAt: new Date().toISOString(),
  };
  const receiptWrite = request('/api/v1/writeback-receipts', {
    method: 'POST',
    headers: deviceHeaders,
    body: { receipt },
  });
  expectStatus('writeback receipt', receiptWrite, 201);
  if (receiptWrite.json?.accepted !== true || receiptWrite.json?.duplicate !== false) {
    throw new Error('First writeback receipt was not accepted as new.');
  }

  const receiptReplay = request('/api/v1/writeback-receipts', {
    method: 'POST',
    headers: deviceHeaders,
    body: { receipt },
  });
  expectStatus('writeback receipt replay', receiptReplay, 200);
  if (receiptReplay.json?.accepted !== true || receiptReplay.json?.duplicate !== true) {
    throw new Error('Writeback receipt replay was not idempotent.');
  }

  const emptyQueue = request('/api/v1/writeback-commands/pending?limit=10', {
    headers: deviceHeaders,
  });
  expectStatus('writeback queue after receipt', emptyQueue, 200);
  if (emptyQueue.json?.commands?.length !== 0) {
    throw new Error('Applied writeback command remained in the pending queue.');
  }
  process.stdout.write('pass learning event and controlled writeback round trip\n');

  const synthesisResponse = request('/api/v1/syntheses', {
    method: 'POST',
    headers: protocolHeaders,
    useCookies: true,
    body: { mode: 'combined', classroomIds: [smokeClassroomId] },
  });
  expectStatus('knowledge synthesis generation', synthesisResponse, 201);
  const synthesis = synthesisResponse.json?.synthesis;
  smokeSynthesisId = synthesis?.id;
  const classroomNode = synthesis?.graph?.nodes?.find((node) => node.type === 'classroom');
  console.log(
    `synthesis metadata: ${JSON.stringify({
      classroomCount: synthesis?.classroomCount,
      dimensions: synthesis?.graph?.dimensions,
      classroomNode: classroomNode
        ? { classroomId: classroomNode.classroomId, mastery: classroomNode.mastery }
        : null,
      nodeTypes: [...new Set((synthesis?.graph?.nodes ?? []).map((node) => node.type))],
      hasNextLearningSection: (synthesis?.summaryMarkdown ?? '').includes('## 下一轮主动学习'),
    })}`,
  );
  if (
    !/^syn_[a-f0-9]{32}$/.test(smokeSynthesisId ?? '') ||
    synthesis?.classroomCount !== 1 ||
    synthesis?.graph?.dimensions?.x !== 'semantic-component-1' ||
    synthesis?.graph?.dimensions?.y !== 'semantic-component-2' ||
    synthesis?.graph?.dimensions?.z !== 'semantic-component-3' ||
    synthesis?.graph?.coordinateModel?.usesIdentifiersAsCoordinates !== false ||
    synthesis?.graph?.coordinateModel?.components?.length !== 3 ||
    (synthesis?.graph?.facets?.timeline?.length ?? 0) < 1 ||
    (synthesis?.graph?.facets?.domains?.length ?? 0) < 1 ||
    !synthesis?.graph?.nodes?.some((node) => node.type === 'concept') ||
    !synthesis?.graph?.nodes?.some((node) => node.type === 'claim') ||
    !synthesis?.graph?.nodes?.some((node) => node.type === 'artifact') ||
    (synthesis?.graph?.statistics?.evidenceCount ?? 0) < 1 ||
    !synthesis?.summaryMarkdown?.includes('## 下一轮主动学习')
  ) {
    throw new Error('Knowledge synthesis did not preserve graph dimensions and learning evidence.');
  }

  const synthesisRead = request(`/api/v1/syntheses/${smokeSynthesisId}`, {
    headers: protocolHeaders,
    useCookies: true,
  });
  expectStatus('persisted knowledge synthesis read', synthesisRead, 200);
  if (synthesisRead.json?.synthesis?.graphHash !== synthesis.graphHash) {
    throw new Error('Persisted synthesis graph hash changed after storage.');
  }

  const synthesisList = request('/api/v1/syntheses?limit=30', {
    headers: protocolHeaders,
    useCookies: true,
  });
  expectStatus('knowledge synthesis history', synthesisList, 200);
  if (!synthesisList.json?.syntheses?.some((item) => item.id === smokeSynthesisId)) {
    throw new Error('Generated synthesis did not appear in history.');
  }
  const smokeFilter = synthesisList.json?.filters?.classrooms?.find(
    (item) => item.classroomId === smokeClassroomId,
  );
  if (smokeFilter?.sourceType !== 'obsidian' || !smokeFilter?.domain) {
    throw new Error(
      'Synthesis filter options did not expose classroom source and domain metadata.',
    );
  }

  const synthesisDraft = request(`/api/v1/syntheses/${smokeSynthesisId}/writeback-drafts`, {
    method: 'POST',
    headers: protocolHeaders,
    useCookies: true,
  });
  expectStatus('synthesis writeback draft generation', synthesisDraft, 201);
  console.log(
    `synthesis draft metadata: ${JSON.stringify({
      synthesisRunId: synthesisDraft.json?.draft?.synthesisRunId,
      relativePath: synthesisDraft.json?.draft?.relativePath,
      targetVaultName: synthesisDraft.json?.draft?.targetVaultName,
    })}`,
  );
  if (
    synthesisDraft.json?.draft?.synthesisRunId !== smokeSynthesisId ||
    !/^Vaultide\/.+\.md$/u.test(synthesisDraft.json?.draft?.relativePath ?? '') ||
    synthesisDraft.json?.draft?.relativePath?.includes('..') ||
    typeof synthesisDraft.json?.draft?.targetVaultName !== 'string' ||
    synthesisDraft.json.draft.targetVaultName.length === 0
  ) {
    throw new Error('Synthesis draft escaped its managed Obsidian归纳 target.');
  }

  if (synthesisDraft.json.draft.targetVaultName !== 'OpenMAIC Deployment Smoke') {
    process.stdout.write(
      'pass synthesis draft safely bound to an existing paired Vault; dispatch skipped to avoid a user-device side effect\n',
    );
  } else {
  const synthesisApproval = request(
    `/api/v1/writeback-drafts/${synthesisDraft.json.draft.id}/approve`,
    {
      method: 'POST',
      headers: protocolHeaders,
      useCookies: true,
      body: { draftRevision: synthesisDraft.json.draft.revision },
    },
  );
  expectStatus('synthesis writeback draft approval', synthesisApproval, 202);
  const synthesisCommand = synthesisApproval.json?.command;
  if (
    synthesisCommand?.deviceId !== identity.deviceId ||
    synthesisCommand?.vaultBindingId !== identity.vaultBindingId ||
    !synthesisCommand?.arguments?.relativePath?.startsWith('Vaultide/归纳/') ||
    synthesisCommand?.arguments?.expectedAbsent !== true
  ) {
    throw new Error('Synthesis writeback command was not safely bound to the smoke Vault.');
  }

  const synthesisPending = request('/api/v1/writeback-commands/pending?limit=10', {
    headers: deviceHeaders,
  });
  expectStatus('device synthesis writeback lease', synthesisPending, 200);
  if (
    synthesisPending.json?.commands?.length !== 1 ||
    synthesisPending.json.commands[0]?.id !== synthesisCommand.id
  ) {
    throw new Error('Paired device did not lease the approved synthesis command.');
  }

  const synthesisReceipt = {
    protocolVersion: LEARNING_PROTOCOL_VERSION,
    id: `wbr_${randomBytes(16).toString('hex')}`,
    commandId: synthesisCommand.id,
    deviceId: identity.deviceId,
    outcome: 'applied',
    resultingContentHash: 'b'.repeat(64),
    resultingPath: synthesisCommand.arguments.relativePath,
    appliedAt: new Date().toISOString(),
    reportedAt: new Date().toISOString(),
  };
  const synthesisReceiptWrite = request('/api/v1/writeback-receipts', {
    method: 'POST',
    headers: deviceHeaders,
    body: { receipt: synthesisReceipt },
  });
  expectStatus('synthesis writeback receipt', synthesisReceiptWrite, 201);
  const synthesisEmptyQueue = request('/api/v1/writeback-commands/pending?limit=10', {
    headers: deviceHeaders,
  });
  expectStatus('synthesis writeback queue after receipt', synthesisEmptyQueue, 200);
  if (synthesisEmptyQueue.json?.commands?.length !== 0) {
    throw new Error('Applied synthesis command remained in the pending queue.');
  }
  process.stdout.write('pass deterministic synthesis and controlled Obsidian归纳 round trip\n');
  }

  const deletedSource = request(`/api/v1/source-bundles/${archive.bundle.id}`, {
    method: 'DELETE',
    headers: {
      ...protocolHeaders,
      Authorization: `Bearer ${refreshed.json.accessToken}`,
    },
  });
  expectStatus('device source deletion', deletedSource, 200);

  const deletedRead = request(`/api/v1/source-bundles/${archive.bundle.id}`, {
    headers: protocolHeaders,
    useCookies: true,
  });
  expectStatus('deleted source rejection', deletedRead, 404);

  const oldRefreshReplay = request('/api/v1/device-tokens/refresh', {
    method: 'POST',
    headers: {
      ...protocolHeaders,
      Authorization: `Bearer ${exchange.json.refreshToken}`,
    },
  });
  expectStatus('old refresh rejection', oldRefreshReplay, 401);

  const revoke = request('/api/v1/device-tokens/revoke', {
    method: 'POST',
    headers: {
      ...protocolHeaders,
      Authorization: `Bearer ${refreshed.json.refreshToken}`,
    },
  });
  expectStatus('device revoke', revoke, 200);

  const revokedRefresh = request('/api/v1/device-tokens/refresh', {
    method: 'POST',
    headers: {
      ...protocolHeaders,
      Authorization: `Bearer ${refreshed.json.refreshToken}`,
    },
  });
  expectStatus('revoked refresh rejection', revokedRefresh, 401);
} finally {
  try {
    await cleanupWritebackSmoke();
  } finally {
    rmSync(tempRoot, { recursive: true, force: true });
  }
}

process.stdout.write(
  'Learning deployment credential smoke test completed without printing secrets.\n',
);
