import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';

function isGitRepoRoot(dirPath) {
  return fs.existsSync(path.join(dirPath, '.git'));
}

function getHooksPath(repoRoot) {
  try {
    const value = execFileSync('git', ['config', '--get', 'core.hooksPath'], { encoding: 'utf8' }).trim();
    if (value) return path.resolve(repoRoot, value);
  } catch {
    // ignore
  }
  return path.join(repoRoot, '.git', 'hooks');
}

function installHookFile(repoRoot, name) {
  const src = path.join(repoRoot, '.githooks', name);
  if (!fs.existsSync(src)) return;

  const hooksDir = getHooksPath(repoRoot);
  fs.mkdirSync(hooksDir, { recursive: true });

  const dest = path.join(hooksDir, name);
  fs.copyFileSync(src, dest);
  try {
    fs.chmodSync(dest, 0o755);
  } catch {
    // ignore (e.g. Windows)
  }
}

const repoRoot = process.cwd();
if (!isGitRepoRoot(repoRoot)) process.exit(0);

try {
  execFileSync('git', ['rev-parse', '--is-inside-work-tree'], { stdio: 'ignore' });
} catch {
  process.exit(0);
}

installHookFile(repoRoot, 'pre-commit');
