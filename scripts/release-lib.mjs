import fs from 'node:fs/promises';
import path from 'node:path';

const SEMVER_PATTERN = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?(?:\+[0-9A-Za-z.-]+)?$/;

export async function readRootPackageJson() {
  const raw = await fs.readFile(path.join(process.cwd(), 'package.json'), 'utf8');
  const pkg = JSON.parse(raw);
  return pkg && typeof pkg === 'object' ? pkg : {};
}

export function normalizeTagInput(rawTag) {
  const value = String(rawTag ?? '').trim();
  if (!value) {
    throw new Error('missing tag. pass --tag=<tag> or set GITHUB_REF_NAME.');
  }
  if (value.startsWith('refs/tags/')) return value.slice('refs/tags/'.length);
  return value;
}

export function stripLeadingV(versionLike) {
  return versionLike.startsWith('v') ? versionLike.slice(1) : versionLike;
}

export function buildReleaseMetadata(packageVersion, rawTag) {
  const version = String(packageVersion ?? '').trim();
  if (!SEMVER_PATTERN.test(version)) {
    throw new Error(`package.json version is not a supported semver string: ${version || '(empty)'}`);
  }

  const tag = normalizeTagInput(rawTag);
  const normalizedTagVersion = stripLeadingV(tag);
  if (normalizedTagVersion !== version) {
    throw new Error(`tag ${tag} does not match package.json version ${version}`);
  }

  // user-note: Keep release titles aligned to the packaged app version even if the git tag keeps a leading "v".
  const releaseName = version;
  return {
    version,
    tag,
    releaseName,
    releaseDir: path.posix.join('release', version),
    assetGlob: path.posix.join('release', version, '*.zip')
  };
}

export async function appendGitHubOutputs(outputPath, outputs) {
  if (!outputPath) return;
  const lines = Object.entries(outputs).map(([key, value]) => `${key}=${String(value)}`);
  await fs.appendFile(outputPath, `${lines.join('\n')}\n`);
}
