import { appendGitHubOutputs, buildReleaseMetadata, readRootPackageJson } from './release-lib.mjs';

function getArgValue(name) {
  const prefix = `--${name}=`;
  for (let i = 2; i < process.argv.length; i++) {
    const arg = process.argv[i] ?? '';
    if (arg.startsWith(prefix)) return arg.slice(prefix.length);
    if (arg === `--${name}`) return process.argv[i + 1] ?? null;
  }
  return null;
}

async function main() {
  const pkg = await readRootPackageJson();
  const tag = getArgValue('tag') ?? process.env.GITHUB_REF_NAME ?? process.env.GITHUB_REF ?? '';
  const releaseNameArg = getArgValue('release-name');
  const outputPath = getArgValue('github-output') ?? process.env.GITHUB_OUTPUT ?? '';
  const metadata = buildReleaseMetadata(pkg.version, tag);

  if (releaseNameArg && releaseNameArg !== metadata.releaseName) {
    throw new Error(`release name ${releaseNameArg} does not match expected value ${metadata.releaseName}`);
  }

  console.log(`[release] version=${metadata.version}`);
  console.log(`[release] tag=${metadata.tag}`);
  console.log(`[release] release_name=${metadata.releaseName}`);
  console.log(`[release] release_dir=${metadata.releaseDir}`);

  await appendGitHubOutputs(outputPath, {
    version: metadata.version,
    tag: metadata.tag,
    release_name: metadata.releaseName,
    release_dir: metadata.releaseDir,
    asset_glob: metadata.assetGlob
  });
}

main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exit(1);
});
