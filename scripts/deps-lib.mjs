import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';

const npmCmd = process.platform === 'win32' ? 'npm.cmd' : 'npm';

export const MINOR_UPGRADE_PACKAGES = [
  '@electron/packager',
  '@eslint/js',
  '@types/node',
  'eslint',
  'typescript-eslint'
];

export function severityRank(severity) {
  switch (severity) {
    case 'critical':
      return 4;
    case 'high':
      return 3;
    case 'moderate':
      return 2;
    case 'low':
      return 1;
    default:
      return 0;
  }
}

export async function readPackageJson() {
  return JSON.parse(await fs.readFile('package.json', 'utf8'));
}

export function getTopLevelPackageNames(pkg) {
  return new Set([
    ...Object.keys(pkg.dependencies ?? {}),
    ...Object.keys(pkg.devDependencies ?? {})
  ]);
}

export function formatVersionChange(name, before, after) {
  return `${name}: ${before ?? '(missing)'} -> ${after ?? '(missing)'}`;
}

export async function runCommand(command, args, options = {}) {
  const stdio = options.stdio ?? 'pipe';
  return await new Promise((resolve, reject) => {
    const child = spawn(command, args, {
      cwd: options.cwd ?? process.cwd(),
      env: options.env ?? process.env,
      stdio
    });

    let stdout = '';
    let stderr = '';

    if (stdio === 'pipe') {
      child.stdout?.on('data', (chunk) => {
        stdout += String(chunk);
      });
      child.stderr?.on('data', (chunk) => {
        stderr += String(chunk);
      });
    }

    child.on('error', reject);
    child.on('close', (code) => {
      resolve({
        code: typeof code === 'number' ? code : 1,
        stdout,
        stderr
      });
    });
  });
}

export async function runNpm(args, options = {}) {
  return await runCommand(npmCmd, args, options);
}

export async function runNpmJson(args) {
  const result = await runNpm(args);
  const trimmed = result.stdout.trim();
  if (!trimmed) {
    return { ...result, data: {} };
  }

  try {
    return {
      ...result,
      data: JSON.parse(trimmed)
    };
  } catch (error) {
    const stderr = result.stderr.trim();
    throw new Error(
      `failed to parse JSON from npm ${args.join(' ')}: ${error instanceof Error ? error.message : 'Unknown error'}${stderr ? `\n${stderr}` : ''}`
    );
  }
}

export async function installDevDependencies(specs) {
  if (specs.length === 0) return { code: 0, stdout: '', stderr: '' };
  return await runNpm(['install', '--save-dev', ...specs], { stdio: 'inherit' });
}

export function getAuditEntries(audit, isDirect) {
  return Object.entries(audit.vulnerabilities ?? {})
    .filter(([, detail]) => Boolean(detail?.isDirect) === isDirect)
    .sort((a, b) => severityRank(b[1]?.severity) - severityRank(a[1]?.severity) || a[0].localeCompare(b[0]));
}

export function hasHighOrCriticalVulnerabilities(audit) {
  const metadata = audit.metadata?.vulnerabilities ?? {};
  return Number(metadata.high ?? 0) > 0 || Number(metadata.critical ?? 0) > 0;
}

export function printSection(title, lines) {
  console.log(`\n${title}`);
  if (lines.length === 0) {
    console.log('  - none');
    return;
  }
  for (const line of lines) {
    console.log(`  - ${line}`);
  }
}
