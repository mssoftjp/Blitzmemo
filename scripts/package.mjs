import fs from 'node:fs/promises';
import { execFile } from 'node:child_process';
import os from 'node:os';
import path from 'node:path';
import { promisify } from 'node:util';
import { packager } from '@electron/packager';
import { formatTimestamp, makeUniqueOutDir, pathExists } from './lib.mjs';

const execFileAsync = promisify(execFile);

function getArgValue(name) {
  const prefix = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i] ?? '';
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}`) return process.argv[i + 1] ?? null;
  }
  return null;
}

function parseCsv(value) {
  if (!value) return [];
  return String(value)
    .split(',')
    .map((p) => p.trim())
    .filter(Boolean);
}

function escapePowerShellSingleQuoted(value) {
  return String(value).replace(/'/g, "''");
}

function getEnvValue(name) {
  const raw = process.env[name];
  return typeof raw === 'string' ? raw.trim() : '';
}

async function copyFileIfExists(src, dest) {
  if (!(await pathExists(src))) return false;
  await fs.copyFile(src, dest);
  return true;
}

async function copyDirWithoutXattrs(srcPath, destPath) {
  await execFileAsync('cp', ['-R', '-X', srcPath, destPath], { timeout: 10 * 60_000 });
}

async function resolveMacAppBundlePath(appPath) {
  if (appPath.endsWith('.app')) return appPath;
  try {
    const entries = await fs.readdir(appPath, { withFileTypes: true });
    const appBundles = entries
      .filter((entry) => entry.isDirectory() && entry.name.endsWith('.app'))
      .map((entry) => path.join(appPath, entry.name));
    if (appBundles.length === 1) return appBundles[0];
  } catch {
    // ignore
  }
  return null;
}

async function findMacSignTargets(appBundlePath) {
  const frameworksDir = path.join(appBundlePath, 'Contents', 'Frameworks');
  const targets = new Set();
  if (!(await pathExists(frameworksDir))) return [];

  const addFound = (stdout) => {
    const lines = String(stdout)
      .split('\n')
      .map((line) => line.trim())
      .filter(Boolean);
    for (const line of lines) targets.add(line);
  };

  try {
    const { stdout } = await execFileAsync(
      'find',
      [frameworksDir, '-type', 'd', '(', '-name', '*.app', '-o', '-name', '*.framework', ')', '-print'],
      { timeout: 60_000 }
    );
    addFound(stdout);
  } catch {
    // ignore
  }

  try {
    const { stdout } = await execFileAsync(
      'find',
      [
        frameworksDir,
        '-type',
        'f',
        '(',
        '-name',
        '*.dylib',
        '-o',
        '-name',
        '*.so',
        '-o',
        '-name',
        '*.node',
        '-o',
        '-name',
        'chrome_crashpad_handler',
        ')',
        '-print'
      ],
      { timeout: 60_000 }
    );
    addFound(stdout);
  } catch {
    // ignore
  }

  return Array.from(targets).sort((a, b) => b.length - a.length);
}

async function signMacApp(appPath) {
  if (process.platform !== 'darwin') return;
  const appBundlePath = await resolveMacAppBundlePath(appPath);
  if (!appBundlePath) return;

  const identity = getEnvValue('APPLE_CODESIGN_IDENTITY') || '-';
  const isAdhoc = identity === '-';

  const entitlements = getEnvValue('APPLE_CODESIGN_ENTITLEMENTS');
  const baseName = path.basename(appBundlePath);
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blitzmemo-sign-'));
  const tempAppPath = path.join(tempDir, baseName);

  try {
    // user-note: Some file providers can attach xattrs (FinderInfo etc) that break codesign.
    // Copy the bundle without xattrs, then codesign the clean copy.
    await copyDirWithoutXattrs(appBundlePath, tempAppPath);

    try {
      await execFileAsync('xattr', ['-cr', tempAppPath], { timeout: 60_000 });
    } catch {
      // ignore
    }

    const targets = await findMacSignTargets(tempAppPath);
    for (const target of targets) {
      const isApp = target.endsWith('.app');
      const args = ['--force', '--sign', identity];
      if (!isAdhoc && isApp) args.push('--options', 'runtime');
      if (entitlements && isApp) args.push('--entitlements', entitlements);
      await execFileAsync('codesign', [...args, target], { timeout: 10 * 60_000 });
    }

    const appArgs = ['--force', '--sign', identity];
    if (!isAdhoc) appArgs.push('--options', 'runtime');
    if (entitlements) appArgs.push('--entitlements', entitlements);
    await execFileAsync('codesign', [...appArgs, tempAppPath], { timeout: 10 * 60_000 });
    await execFileAsync('codesign', ['--verify', '--deep', '--strict', '--verbose=2', tempAppPath], {
      timeout: 10 * 60_000
    });

    await fs.rm(appBundlePath, { recursive: true, force: true });
    await copyDirWithoutXattrs(tempAppPath, appBundlePath);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function ensureReleaseNotices(appPath) {
  // user-note: Include README + Blitzmemo license + third-party notices in releases,
  // and keep Electron/Chromium license texts alongside them.
  const rootDir = appPath.endsWith('.app') ? path.dirname(appPath) : appPath;

  // Avoid mixing up Electron's bundled LICENSE file and Blitzmemo's own project LICENSE.
  const electronLicensePath = path.join(rootDir, 'LICENSE');
  const electronLicenseDest = path.join(rootDir, 'LICENSE.electron.txt');
  if ((await pathExists(electronLicensePath)) && !(await pathExists(electronLicenseDest))) {
    await fs.rename(electronLicensePath, electronLicenseDest);
  }

  // user-note: Electron distributes a small "version" file (Electron version). Not required for Blitzmemo, so omit.
  await fs.rm(path.join(rootDir, 'version'), { force: true });

  await copyFileIfExists(path.join(process.cwd(), 'README.md'), path.join(rootDir, 'README.md'));
  await copyFileIfExists(path.join(process.cwd(), 'LICENSE'), path.join(rootDir, 'LICENSE'));
  await copyFileIfExists(path.join(process.cwd(), 'THIRD_PARTY_NOTICES.md'), path.join(rootDir, 'THIRD_PARTY_NOTICES.md'));
}

async function runSipsResizePng(srcPng, sizePx, outPng) {
  await execFileAsync('sips', ['-z', String(sizePx), String(sizePx), srcPng, '--out', outPng], { timeout: 30_000 });
}

async function buildMacIcns(srcPng, outIcns) {
  const iconsetDir = `${outIcns}.iconset`;
  await fs.rm(iconsetDir, { recursive: true, force: true });
  await fs.mkdir(iconsetDir, { recursive: true });

  const items = [
    { size: 16, scale: 1, name: 'icon_16x16.png' },
    { size: 16, scale: 2, name: 'icon_16x16@2x.png' },
    { size: 32, scale: 1, name: 'icon_32x32.png' },
    { size: 32, scale: 2, name: 'icon_32x32@2x.png' },
    { size: 128, scale: 1, name: 'icon_128x128.png' },
    { size: 128, scale: 2, name: 'icon_128x128@2x.png' },
    { size: 256, scale: 1, name: 'icon_256x256.png' },
    { size: 256, scale: 2, name: 'icon_256x256@2x.png' },
    { size: 512, scale: 1, name: 'icon_512x512.png' },
    { size: 512, scale: 2, name: 'icon_512x512@2x.png' }
  ];

  await Promise.all(
    items.map(async (item) => {
      const sizePx = item.size * item.scale;
      const outPng = path.join(iconsetDir, item.name);
      await runSipsResizePng(srcPng, sizePx, outPng);
    })
  );

  await execFileAsync('iconutil', ['--convert', 'icns', '--output', outIcns, iconsetDir], { timeout: 30_000 });
  await fs.rm(iconsetDir, { recursive: true, force: true });
}

function buildIcoFromPngs(pngs) {
  const sorted = [...pngs].sort((a, b) => a.size - b.size);
  const count = sorted.length;
  const header = Buffer.alloc(6);
  header.writeUInt16LE(0, 0);
  header.writeUInt16LE(1, 2);
  header.writeUInt16LE(count, 4);

  const directory = Buffer.alloc(16 * count);
  let offset = header.length + directory.length;
  const images = [];

  for (let i = 0; i < sorted.length; i++) {
    const item = sorted[i];
    const sizeByte = item.size === 256 ? 0 : item.size;
    const entryOffset = i * 16;

    directory.writeUInt8(sizeByte, entryOffset + 0);
    directory.writeUInt8(sizeByte, entryOffset + 1);
    directory.writeUInt8(0, entryOffset + 2);
    directory.writeUInt8(0, entryOffset + 3);
    directory.writeUInt16LE(1, entryOffset + 4);
    directory.writeUInt16LE(32, entryOffset + 6);
    directory.writeUInt32LE(item.data.length, entryOffset + 8);
    directory.writeUInt32LE(offset, entryOffset + 12);

    images.push(item.data);
    offset += item.data.length;
  }

  return Buffer.concat([header, directory, ...images]);
}

async function buildWindowsIco(srcPng, outIco) {
  const sizes = [16, 20, 24, 32, 40, 48, 64, 96, 128, 256];
  const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blitzmemo-ico-'));
  try {
    const pngs = [];
    for (const size of sizes) {
      const outPng = path.join(tempDir, `icon-${size}.png`);
      await runSipsResizePng(srcPng, size, outPng);
      const data = await fs.readFile(outPng);
      pngs.push({ size, data });
    }
    const ico = buildIcoFromPngs(pngs);
    await fs.writeFile(outIco, ico);
  } finally {
    await fs.rm(tempDir, { recursive: true, force: true });
  }
}

async function preparePackagerIcon(platform) {
  const srcAssetsDir = path.join(process.cwd(), 'src', 'assets');
  const winPng = path.join(srcAssetsDir, 'Blitzmemo_icon_color_transparent.png');
  const sharedPng = path.join(srcAssetsDir, 'Blitzmemo_icon_color.png');
  const srcPng = platform === 'win32' && (await pathExists(winPng)) ? winPng : sharedPng;
  if (!(await pathExists(srcPng))) return null;

  if (platform === 'darwin') {
    if (process.platform !== 'darwin') {
      console.warn('[package] skipping macOS icon generation: requires macOS host');
      return null;
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blitzmemo-icns-'));
    const iconBase = path.join(tempDir, 'Blitzmemo');
    const outIcns = `${iconBase}.icns`;
    await buildMacIcns(srcPng, outIcns);
    return { iconPath: iconBase, cleanupDir: tempDir };
  }

  if (platform === 'win32') {
    const prebuiltIco = path.join(srcAssetsDir, 'Blitzmemo_app.ico');
    if (await pathExists(prebuiltIco)) {
      const ext = path.extname(prebuiltIco).toLowerCase();
      const iconBase = ext ? prebuiltIco.slice(0, -ext.length) : prebuiltIco;
      return { iconPath: iconBase, cleanupDir: null };
    }
    if (process.platform !== 'darwin') {
      console.warn('[package] skipping Windows icon generation: requires macOS host (uses sips)');
      return null;
    }
    const tempDir = await fs.mkdtemp(path.join(os.tmpdir(), 'blitzmemo-ico-out-'));
    const iconBase = path.join(tempDir, 'Blitzmemo');
    const outIco = `${iconBase}.ico`;
    await buildWindowsIco(srcPng, outIco);
    return { iconPath: iconBase, cleanupDir: tempDir };
  }

  return null;
}

async function stripLocales(appPath, keepLocales) {
  if (!keepLocales || keepLocales.length === 0) return;

  const localesDir = path.join(appPath, 'locales');
  try {
    const entries = await fs.readdir(localesDir, { withFileTypes: true });
    const keep = new Set(keepLocales.map((l) => `${l}.pak`));

    await Promise.all(
      entries.map(async (entry) => {
        if (!entry.isFile()) return;
        if (!entry.name.endsWith('.pak')) return;
        if (keep.has(entry.name)) return;
        await fs.rm(path.join(localesDir, entry.name), { force: true });
      })
    );
  } catch {
    // ignore (no locales dir or cannot read)
  }
}

async function zipAppPath(appPath, zipPath) {
  const baseName = path.basename(appPath);
  const parentDir = path.dirname(appPath);
  await fs.rm(zipPath, { force: true });

  if (process.platform === 'win32') {
    const escapedSource = escapePowerShellSingleQuoted(baseName);
    const escapedDest = escapePowerShellSingleQuoted(zipPath);
    const command = `Compress-Archive -Path '${escapedSource}' -DestinationPath '${escapedDest}' -Force`;
    await execFileAsync('powershell', ['-NoProfile', '-NonInteractive', '-Command', command], {
      cwd: parentDir,
      timeout: 10 * 60_000
    });
    return;
  }

  await execFileAsync('zip', ['-9', '-r', '-q', '-y', '-X', zipPath, baseName], {
    cwd: parentDir,
    timeout: 10 * 60_000
  });
}

async function main() {
  const platform = getArgValue('platform') ?? process.platform;
  const arch = getArgValue('arch') ?? process.arch;
  const keepLocales = parseCsv(getArgValue('keep-locales'));
  const shouldZip = process.argv.includes('--zip');
  const appName = 'Blitzmemo';
  const appDir = path.join(process.cwd(), 'dist');
  const outArg = getArgValue('out');
  const outDir = outArg
    ? path.resolve(process.cwd(), outArg)
    : await makeUniqueOutDir(path.join(process.cwd(), 'release', formatTimestamp(new Date())));

  const ignore = [
    /^\/node_modules($|\/)/,
    /^\/.*\.map$/,
    /^\/buildInfo\.json$/
  ];

  ignore.push(/^\/assets\/pin\.png$/);
  ignore.push(/^\/assets\/Blitzmemo_icon_yellow\.png$/);
  ignore.push(/^\/assets\/Blitzmemo_icon_tray\.svg$/);
  ignore.push(/^\/assets\/Blitzmemo_icon_color_transparent\.png$/);
  ignore.push(/^\/assets\/Blitzmemo_icon_mac\.icon($|\/)/);

  if (platform === 'win32') {
    ignore.push(/^\/assets\/.*\.png$/);
    ignore.push(/^\/assets\/.*\.svg$/);
  } else {
    ignore.push(/^\/assets\/.*\.ico$/);
  }

  let iconPrepared = null;
  try {
    iconPrepared = await preparePackagerIcon(platform);
  } catch (error) {
    console.warn(`[package] failed to prepare icon: ${error instanceof Error ? error.message : String(error)}`);
  }

  try {
    const appPaths = await packager({
      dir: appDir,
      name: appName,
      platform,
      arch,
      out: outDir,
      overwrite: true,
      prune: true,
      asar: true,
      ...(iconPrepared ? { icon: iconPrepared.iconPath } : {}),
      ignore
    });

    console.log(`\n[package] done: ${outDir}`);
    for (const appPath of appPaths) {
      await stripLocales(appPath, keepLocales);
      await signMacApp(appPath);
      await ensureReleaseNotices(appPath);
      console.log(`[package] ${appPath}`);
    }

    if (shouldZip) {
      for (const appPath of appPaths) {
        const zipSource = appPath.endsWith('.app') ? path.dirname(appPath) : appPath;
        const baseName = path.basename(zipSource);
        const zipPath = path.join(outDir, `${baseName}.zip`);
        await zipAppPath(zipSource, zipPath);
        console.log(`[package] zip: ${zipPath}`);
      }
    }
  } finally {
    if (iconPrepared?.cleanupDir) {
      await fs.rm(iconPrepared.cleanupDir, { recursive: true, force: true });
    }
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
