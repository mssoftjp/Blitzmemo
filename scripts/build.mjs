import { build, context } from 'esbuild';
import fs from 'node:fs/promises';
import path from 'node:path';

const isWatch = process.argv.includes('--watch');
const isRelease = process.argv.includes('--release');

async function copyDir(srcDir, destDir) {
  await fs.mkdir(destDir, { recursive: true });
  const entries = await fs.readdir(srcDir, { withFileTypes: true });
  await Promise.all(
    entries.map(async (entry) => {
      const srcPath = path.join(srcDir, entry.name);
      const destPath = path.join(destDir, entry.name);
      if (entry.isDirectory()) {
        await copyDir(srcPath, destPath);
        return;
      }
      if (entry.name.endsWith('.ts') || entry.name.endsWith('.tsx')) return;
      await fs.copyFile(srcPath, destPath);
    })
  );
}

async function main() {
  await fs.rm('dist/renderer', { recursive: true, force: true });
  await fs.mkdir('dist/renderer', { recursive: true });
  await copyDir('src/renderer', 'dist/renderer');
  await fs.rm('dist/assets', { recursive: true, force: true });
  await fs.mkdir('dist/assets', { recursive: true });
  await copyDir('src/assets', 'dist/assets');

  const rootPkg = JSON.parse(await fs.readFile('package.json', 'utf8'));
  const distPkg = {
    name: rootPkg.name ?? 'app',
    version: rootPkg.version ?? '0.0.0',
    private: true,
    main: 'main.js'
  };
  await fs.writeFile('dist/package.json', `${JSON.stringify(distPkg, null, 2)}\n`);
  if (isRelease) {
    await fs.rm('dist/buildInfo.json', { force: true });
    await fs.rm('dist/main.js.map', { force: true });
    await fs.rm('dist/preload.js.map', { force: true });
    await fs.rm('dist/overlay-preload.js.map', { force: true });
  }

  const common = {
    bundle: true,
    sourcemap: isRelease ? false : true,
    legalComments: isRelease ? 'none' : 'eof',
    minify: isRelease,
    logLevel: 'info',
    external: ['electron']
  };

  async function run(buildOptions) {
    if (!isWatch) {
      await build(buildOptions);
      return null;
    }
    const ctx = await context(buildOptions);
    await ctx.watch();
    return ctx;
  }

  const contexts = await Promise.all([
    run({
      ...common,
      entryPoints: ['src/main/main.ts'],
      platform: 'node',
      format: 'cjs',
      target: ['node20'],
      outfile: 'dist/main.js'
    }),
    run({
      ...common,
      entryPoints: ['src/main/preload.ts'],
      platform: 'node',
      format: 'cjs',
      target: ['node20'],
      outfile: 'dist/preload.js'
    }),
    run({
      ...common,
      entryPoints: ['src/main/overlayPreload.ts'],
      platform: 'node',
      format: 'cjs',
      target: ['node20'],
      outfile: 'dist/overlay-preload.js'
    }),
    run({
      ...common,
      entryPoints: ['src/renderer/app.ts'],
      platform: 'browser',
      format: 'esm',
      target: ['es2020'],
      outfile: 'dist/renderer/app.js'
    }),
    run({
      ...common,
      entryPoints: ['src/renderer/vadWorklet.ts'],
      platform: 'browser',
      format: 'esm',
      target: ['es2020'],
      outfile: 'dist/renderer/vadWorklet.js'
    }),
  ]);

  if (isWatch) {
    console.debug('[esbuild] watching...');
    // Keep process alive while watching
    await new Promise(() => {});
    // Dispose (unreachable, but keeps types correct)
    await Promise.all(contexts.filter(Boolean).map((ctx) => ctx.dispose()));
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
