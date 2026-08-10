import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { spawnSync } from 'node:child_process';

if (!process.argv.includes('--apply')) {
  throw new Error('Pass --apply to generate and upsert the learning deployment variables.');
}
const rotateAccessCodeOnly = process.argv.includes('--rotate-access-code');

const project = JSON.parse(readFileSync(resolve('.vercel/project.json'), 'utf8'));
if (!project.projectId || !project.orgId) {
  throw new Error('The local workspace is not linked to a Vercel project.');
}

const appData = process.env.APPDATA;
const vercelCli = appData ? resolve(appData, 'npm/node_modules/vercel/dist/index.js') : undefined;
if (!vercelCli || !existsSync(vercelCli)) {
  throw new Error('The authenticated Vercel CLI installation was not found.');
}

const base64url = (size) => randomBytes(size).toString('base64url');
const ownerId = `own_${randomBytes(16).toString('hex')}`;
const targets = ['production', 'preview', 'development'];
const allVariables = [
  { key: 'LEARNING_OWNER_ID', value: ownerId, type: 'encrypted', target: targets },
  {
    key: 'PAIRING_HMAC_SECRET',
    value: base64url(48),
    type: 'encrypted',
    target: targets,
  },
  { key: 'CRON_SECRET', value: base64url(48), type: 'encrypted', target: targets },
  {
    key: 'ACCESS_CODE',
    value: `maic_${base64url(24)}`,
    type: 'sensitive',
    target: ['production'],
  },
  {
    key: 'LEARNING_OWNER_DISPLAY_NAME',
    value: 'Personal Learning Owner',
    type: 'plain',
    target: targets,
  },
];
const variables = rotateAccessCodeOnly
  ? allVariables.filter(({ key }) => key === 'ACCESS_CODE')
  : allVariables;

function runVercel(args, options = {}) {
  const result = spawnSync(process.execPath, [vercelCli, ...args], {
    cwd: process.cwd(),
    encoding: 'utf8',
    input: options.input,
    maxBuffer: 10 * 1024 * 1024,
  });
  if (result.status !== 0) {
    const message = (result.stderr || result.stdout || 'Unknown Vercel CLI error').trim();
    throw new Error(message);
  }
  return result;
}

function upsertLocalEnvironmentValue(filePath, key, value) {
  const current = existsSync(filePath) ? readFileSync(filePath, 'utf8') : '';
  const escaped = JSON.stringify(value);
  const expression = new RegExp(`^${key}=.*$`, 'm');
  const next = expression.test(current)
    ? current.replace(expression, `${key}=${escaped}`)
    : `${current.replace(/\s*$/, '')}${current.trim() ? '\n' : ''}${key}=${escaped}\n`;
  writeFileSync(filePath, next, { encoding: 'utf8', mode: 0o600 });
}

const teamQuery = `teamId=${encodeURIComponent(project.orgId)}`;
const endpoint = `/v10/projects/${encodeURIComponent(project.projectId)}/env?upsert=true&${teamQuery}`;

function replaceAccessCode(variable) {
  const listed = JSON.parse(
    runVercel([
      'api',
      `/v9/projects/${encodeURIComponent(project.projectId)}/env?${teamQuery}`,
      '--raw',
    ]).stdout,
  );
  const current = (listed.envs ?? listed).filter(({ key }) => key === variable.key);
  for (const existing of current) {
    runVercel([
      'api',
      `/v10/projects/${encodeURIComponent(project.projectId)}/env/${encodeURIComponent(existing.id)}?${teamQuery}`,
      '-X',
      'DELETE',
      '--silent',
      '--dangerously-skip-permissions',
    ]);
  }
  runVercel(
    [
      'api',
      `/v10/projects/${encodeURIComponent(project.projectId)}/env?${teamQuery}`,
      '-X',
      'POST',
      '--input',
      '-',
      '--silent',
    ],
    { input: JSON.stringify(variable) },
  );
}

for (const variable of variables) {
  if (variable.key === 'ACCESS_CODE') {
    replaceAccessCode(variable);
  } else {
    runVercel(['api', endpoint, '-X', 'POST', '--input', '-', '--silent'], {
      input: JSON.stringify(variable),
    });
  }
}
runVercel(['env', 'pull', '.env.local', '--yes']);
runVercel([
  'env',
  'pull',
  '.env.production.local',
  '--environment',
  'production',
  '--yes',
]);

// Vercel intentionally does not return the plaintext of encrypted variables
// from `env pull`. Preserve values generated in this process locally so
// deployment QA and the product owner can recover the stable access code.
for (const variable of variables) {
  upsertLocalEnvironmentValue(resolve('.env.local'), variable.key, variable.value);
  upsertLocalEnvironmentValue(resolve('.env.production.local'), variable.key, variable.value);
}

process.stdout.write(
  `Configured ${variables.map(({ key }) => key).join(', ')} for Production, Preview, and Development.\n`,
);
process.stdout.write(
  'Secret values were not printed; local Development and Production env files were refreshed.\n',
);
