import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';

function getArgValue(name) {
  const prefix = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i] ?? '';
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}`) return process.argv[i + 1] ?? null;
  }
  return null;
}

function toNumber(value, fallback) {
  const n = Number(value);
  return Number.isFinite(n) ? n : fallback;
}

function mbToBytesDecimal(mb) {
  return Math.floor(mb * 1_000_000);
}

function formatBytes(bytes) {
  const units = ['B', 'KB', 'MB', 'GB'];
  let value = bytes;
  let unit = units[0];
  for (let i = 1; i < units.length && value >= 1000; i++) {
    value /= 1000;
    unit = units[i];
  }
  return `${value.toFixed(unit === 'B' ? 0 : 1)}${unit}`;
}

async function run(cmd, args, options = {}) {
  return await new Promise((resolve, reject) => {
    const child = spawn(cmd, args, {
      stdio: ['ignore', 'pipe', 'pipe'],
      ...options
    });
    let stdout = '';
    let stderr = '';
    child.stdout.on('data', (d) => {
      stdout += String(d);
    });
    child.stderr.on('data', (d) => {
      stderr += String(d);
    });
    child.on('error', reject);
    child.on('close', (code) => {
      if (code === 0) resolve({ stdout, stderr });
      else reject(new Error(`${cmd} ${args.join(' ')} failed (code=${code})\n${stderr || stdout}`));
    });
  });
}

async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function listFilesRec(dir) {
  const entries = await fs.readdir(dir, { withFileTypes: true });
  const out = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      out.push(...(await listFilesRec(full)));
      continue;
    }
    if (entry.isFile()) out.push(full);
  }
  return out;
}

async function sha256File(filePath) {
  const hash = createHash('sha256');
  const handle = await fs.open(filePath, 'r');
  try {
    const stream = handle.createReadStream();
    await new Promise((resolve, reject) => {
      stream.on('data', (chunk) => hash.update(chunk));
      stream.on('error', reject);
      stream.on('end', resolve);
    });
  } finally {
    await handle.close();
  }
  return hash.digest('hex');
}

function packFirstFitDescending(items, maxBytes) {
  const sorted = [...items].sort((a, b) => b.weightBytes - a.weightBytes);
  /** @type {{ sum: number, items: typeof sorted }[]} */
  const bins = [];

  for (const item of sorted) {
    let placed = false;
    for (const bin of bins) {
      if (bin.sum + item.weightBytes <= maxBytes) {
        bin.items.push(item);
        bin.sum += item.weightBytes;
        placed = true;
        break;
      }
    }
    if (!placed) {
      bins.push({ sum: item.weightBytes, items: [item] });
    }
  }

  return bins.map((b) => b.items);
}

async function resolveAppDir({ outDir, platform, arch, appDirArg, appName }) {
  if (appDirArg) {
    const resolved = path.isAbsolute(appDirArg) ? appDirArg : path.join(process.cwd(), appDirArg);
    if (!(await pathExists(resolved))) throw new Error(`app dir not found: ${resolved}`);
    return resolved;
  }

  const suffix = `-${platform}-${arch}`;
  const expectedBase = `${appName}${suffix}`;

  async function listDirsWithSuffix(dir) {
    const entries = await fs.readdir(dir, { withFileTypes: true });
    return entries
      .filter((e) => e.isDirectory() && e.name.endsWith(suffix))
      .map((e) => path.join(dir, e.name));
  }

  /** @type {string[]} */
  const candidates = [];

  candidates.push(...(await listDirsWithSuffix(outDir)));

  const outEntries = await fs.readdir(outDir, { withFileTypes: true });
  for (const entry of outEntries) {
    if (!entry.isDirectory()) continue;
    const childDir = path.join(outDir, entry.name);
    candidates.push(...(await listDirsWithSuffix(childDir)));
  }

  const exact = candidates.filter((c) => path.basename(c) === expectedBase);
  const filtered = exact.length > 0 ? exact : candidates;

  const unique = Array.from(new Set(filtered));
  if (unique.length === 0) {
    throw new Error(`no app dir found in ${outDir} (suffix=${suffix})`);
  }
  if (unique.length === 1) return unique[0];

  const byTime = await Promise.all(
    unique.map(async (p) => ({ p, mtimeMs: (await fs.stat(p)).mtimeMs }))
  );
  byTime.sort((a, b) => b.mtimeMs - a.mtimeMs || a.p.localeCompare(b.p));
  return byTime[0].p;
}

async function checkZipAvailable() {
  try {
    await run('zip', ['-v']);
  } catch {
    throw new Error(
      'zip command not found. Install Info-ZIP (zip) and retry, or use 7-Zip volumes as a fallback.'
    );
  }
}

async function estimateCompressedBytes({ cwd, zipRootPath, relPathInRoot, tempDir }) {
  const archivePath = path.join(tempDir, 'one.zip');
  await fs.rm(archivePath, { force: true });

  const zipEntryPath = path.join(zipRootPath, relPathInRoot);
  await run('zip', ['-9', '-q', archivePath, zipEntryPath], { cwd });
  const stat = await fs.stat(archivePath);
  return stat.size;
}

async function buildPartsZips({ outDir, appDir, maxBytes }) {
  const zipRootDir = path.basename(appDir);
  const parentDir = path.dirname(appDir);
  const filesAbs = await listFilesRec(appDir);
  const filesRel = filesAbs.map((p) => path.relative(appDir, p));

  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blitzmemo-split-zip-'));
  try {
    /** @type {{ rel: string, zipPath: string, weightBytes: number }[]} */
    const items = [];
    for (const rel of filesRel) {
      const zipPath = path.join(zipRootDir, rel);
      const weightBytes = await estimateCompressedBytes({
        cwd: parentDir,
        zipRootPath: zipRootDir,
        relPathInRoot: rel,
        tempDir
      });
      if (weightBytes > maxBytes) {
        throw new Error(
          `single file exceeds max: ${zipPath} (${formatBytes(weightBytes)} > ${formatBytes(maxBytes)})`
        );
      }
      items.push({ rel, zipPath, weightBytes });
    }

    const groups = packFirstFitDescending(items, maxBytes);
    if (groups.length === 0) throw new Error('no files to zip');

    const partPaths = [];
    const baseName = path.basename(appDir);

    // Clean previous parts (count can change).
    const outEntries = await fs.readdir(outDir, { withFileTypes: true });
    await Promise.all(
      outEntries.map(async (entry) => {
        if (!entry.isFile()) return;
        if (!entry.name.startsWith(`${baseName}.part`)) return;
        if (!entry.name.endsWith('.zip')) return;
        await fs.rm(path.join(outDir, entry.name), { force: true });
      })
    );

    for (let i = 0; i < groups.length; i++) {
      const partZipName = `${baseName}.part${i + 1}.zip`;
      const partZipPath = path.join(outDir, partZipName);
      partPaths.push(partZipPath);
    }

    for (let i = 0; i < groups.length; i++) {
      const partZipPath = partPaths[i];
      const zipPaths = groups[i].map((x) => x.zipPath);
      await run('zip', ['-9', '-q', partZipPath, ...zipPaths], { cwd: parentDir });
      const stat = await fs.stat(partZipPath);
      if (stat.size > maxBytes) {
        throw new Error(
          `part too large: ${path.basename(partZipPath)} (${formatBytes(stat.size)} > ${formatBytes(maxBytes)})`
        );
      }
    }

    const manifest = {
      appDir: path.relative(process.cwd(), appDir),
      maxBytes,
      parts: await Promise.all(
        partPaths.map(async (p) => ({
          file: path.basename(p),
          bytes: (await fs.stat(p)).size,
          sha256: await sha256File(p)
        }))
      )
    };

    const manifestPath = path.join(outDir, `${baseName}.parts.json`);
    await fs.writeFile(manifestPath, `${JSON.stringify(manifest, null, 2)}\n`, 'utf8');

    return { partPaths, manifestPath };
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function main() {
  const platform = getArgValue('platform') ?? 'win32';
  const arch = getArgValue('arch') ?? 'x64';
  const outArg = getArgValue('out');
  const outDirSearch = path.resolve(outArg ?? path.join(process.cwd(), 'release'));
  const appName = getArgValue('app-name') ?? 'Blitzmemo';
  const appDirArg = getArgValue('app-dir');

  const maxBytes =
    toNumber(getArgValue('max-bytes'), NaN) ||
    mbToBytesDecimal(toNumber(getArgValue('max-mb'), 90));

  await checkZipAvailable();

  const appDir = await resolveAppDir({
    outDir: outDirSearch,
    platform,
    arch,
    appDirArg,
    appName
  });
  const outDir = outArg ? outDirSearch : path.dirname(appDir);
  const { partPaths, manifestPath } = await buildPartsZips({ outDir, appDir, maxBytes });

  console.log(`\n[split-zip] app: ${path.relative(process.cwd(), appDir)}`);
  console.log(`[split-zip] max: ${formatBytes(maxBytes)}`);
  for (const p of partPaths) {
    const stat = await fs.stat(p);
    console.log(`[split-zip] ${path.basename(p)} (${formatBytes(stat.size)})`);
  }
  console.log(`[split-zip] manifest: ${path.relative(process.cwd(), manifestPath)}`);
  console.log('\n[split-zip] How to use on Windows: unzip ALL parts into the same folder, then run the .exe.');
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
