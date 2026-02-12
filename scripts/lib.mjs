import fs from 'node:fs/promises';

export function pad2(n) {
  return String(n).padStart(2, '0');
}

export function formatTimestamp(date) {
  const yyyy = date.getFullYear();
  const mm = pad2(date.getMonth() + 1);
  const dd = pad2(date.getDate());
  const hh = pad2(date.getHours());
  const min = pad2(date.getMinutes());
  const sec = pad2(date.getSeconds());
  return `${yyyy}${mm}${dd}-${hh}${min}${sec}`;
}

export async function pathExists(p) {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

export async function makeUniqueOutDir(baseOutDir) {
  if (!(await pathExists(baseOutDir))) return baseOutDir;

  for (let i = 2; i < 1000; i++) {
    const candidate = `${baseOutDir}-${i}`;
    if (!(await pathExists(candidate))) return candidate;
  }

  throw new Error(`failed to find a unique out dir: ${baseOutDir}`);
}

