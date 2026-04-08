import { spawn } from 'node:child_process';
import fs from 'node:fs/promises';
import path from 'node:path';
import { formatTimestamp, makeUniqueOutDir, pathExists } from './lib.mjs';

async function getAppVersion() {
  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
    const pkg = JSON.parse(raw);
    const version = typeof pkg?.version === 'string' ? pkg.version.trim() : '';
    return version || null;
  } catch {
    return null;
  }
}

async function hasReleaseBuildArtifacts() {
  const requiredDistFiles = ['dist/main.js', 'dist/preload.js', 'dist/overlay-preload.js', 'dist/package.json', 'dist/buildInfo.json'];
  for (const relativePath of requiredDistFiles) {
    if (!(await pathExists(relativePath))) return false;
  }

  try {
    const raw = await fs.readFile(path.join(process.cwd(), 'dist', 'buildInfo.json'), 'utf8');
    const buildInfo = JSON.parse(raw);
    return buildInfo && typeof buildInfo === 'object' && buildInfo.release === true;
  } catch {
    return false;
  }
}

async function run(cmd, args) {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, { stdio: 'inherit' });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve();
      else reject(new Error(`${cmd} ${args.join(' ')} failed (code=${code})`));
    });
  });
}

async function main() {
  const shouldZip = process.argv.includes('--zip');
  const releaseRoot = path.join(process.cwd(), 'release');
  await fs.mkdir(releaseRoot, { recursive: true });
  const version = await getAppVersion();
  const outDirBase = version ? path.join(releaseRoot, version) : path.join(releaseRoot, formatTimestamp(new Date()));
  const outDir = await makeUniqueOutDir(outDirBase);
  // user-note: Packaging is intentionally build-free so release scripts can control when lint/build run.
  if (!(await hasReleaseBuildArtifacts())) {
    throw new Error('missing release build artifacts. Run npm run build:release first.');
  }

  const macArch = process.arch;
  await run('node', [
    'scripts/package.mjs',
    `--out=${outDir}`,
    '--platform=darwin',
    `--arch=${macArch}`,
    ...(shouldZip ? ['--zip'] : [])
  ]);
  await run('node', [
    'scripts/package.mjs',
    `--out=${outDir}`,
    '--platform=win32',
    '--arch=x64',
    '--keep-locales=en-US,ja',
    ...(shouldZip ? ['--zip'] : [])
  ]);

  console.log(`\n[package:macwin] done: ${outDir}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
