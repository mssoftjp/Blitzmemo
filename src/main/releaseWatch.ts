import { app } from 'electron';
import path from 'node:path';
import { requestTextWithElectronNet } from './openaiClient';
import { readJsonFile, writeJsonFile } from './persistence';
import { WriteQueue } from './writeQueue';

const RELEASE_WATCH_FILENAME = 'release-watch.json';
const DEFAULT_MIN_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const DEFAULT_REQUEST_TIMEOUT_MS = 10_000;

type ReleaseWatchFile = {
  version: 1;
  lastCheckedAt?: number;
  lastNotifiedVersion?: string;
};

export type LatestGitHubRelease = {
  version: string;
  tag: string;
  htmlUrl: string;
  publishedAt: string | null;
};

function getReleaseWatchPath(): string {
  return path.join(app.getPath('userData'), RELEASE_WATCH_FILENAME);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function normalizeVersionLike(value: string): string {
  return value.trim().replace(/^v/i, '');
}

type Semver = { major: number; minor: number; patch: number };

function getHeaderValue(headers: Record<string, string | string[]>, name: string): string | null {
  const wanted = name.toLowerCase();
  for (const [key, value] of Object.entries(headers)) {
    if (key.toLowerCase() !== wanted) continue;
    if (Array.isArray(value)) return typeof value[0] === 'string' ? value[0] : null;
    return typeof value === 'string' ? value : null;
  }
  return null;
}

function extractTagFromReleaseUrl(value: string): string | null {
  const match = value.match(/\/releases\/tag\/([^"'\s<>?#]+)/);
  if (!match) return null;
  try {
    return decodeURIComponent(match[1]);
  } catch {
    return match[1];
  }
}

function extractTagFromReleaseHtml(html: string): string | null {
  const canonical = html.match(/rel="canonical"[^>]*href="([^"]+)"/i);
  const canonicalUrl = typeof canonical?.[1] === 'string' ? canonical[1] : '';
  const fromCanonical = canonicalUrl ? extractTagFromReleaseUrl(canonicalUrl) : null;
  if (fromCanonical) return fromCanonical;

  const ogUrl = html.match(/property="og:url"[^>]*content="([^"]+)"/i);
  const ogUrlValue = typeof ogUrl?.[1] === 'string' ? ogUrl[1] : '';
  const fromOg = ogUrlValue ? extractTagFromReleaseUrl(ogUrlValue) : null;
  if (fromOg) return fromOg;

  return extractTagFromReleaseUrl(html);
}

function parseSemver(value: string): Semver | null {
  const m = normalizeVersionLike(value).match(/^(\d+)\.(\d+)\.(\d+)(?:[-+].*)?$/);
  if (!m) return null;
  const major = Number(m[1]);
  const minor = Number(m[2]);
  const patch = Number(m[3]);
  if (!Number.isFinite(major) || !Number.isFinite(minor) || !Number.isFinite(patch)) return null;
  return { major, minor, patch };
}

function compareSemver(a: Semver, b: Semver): number {
  if (a.major !== b.major) return a.major > b.major ? 1 : -1;
  if (a.minor !== b.minor) return a.minor > b.minor ? 1 : -1;
  if (a.patch !== b.patch) return a.patch > b.patch ? 1 : -1;
  return 0;
}

export function compareSemverStrings(a: string, b: string): number | null {
  const aSemver = parseSemver(a);
  const bSemver = parseSemver(b);
  if (!aSemver || !bSemver) return null;
  return compareSemver(aSemver, bSemver);
}

function isRemoteVersionNewer(remote: string, current: string): boolean {
  const remoteSemver = parseSemver(remote);
  const currentSemver = parseSemver(current);
  if (!remoteSemver || !currentSemver) return false;
  return compareSemver(remoteSemver, currentSemver) > 0;
}

async function fetchJson(
  url: string,
  headers: Record<string, string>,
  timeoutMs: number
): Promise<unknown> {
  const res = await requestTextWithElectronNet({
    url,
    method: 'GET',
    headers,
    timeoutMs
  });
  if (res.status < 200 || res.status >= 300) {
    throw new Error(`request failed: ${res.status}`);
  }
  try {
    return JSON.parse(res.bodyText) as unknown;
  } catch (error) {
    throw error instanceof Error ? error : new Error('failed to parse json response');
  }
}

async function fetchLatestReleaseFromGitHubApi(owner: string, repo: string): Promise<LatestGitHubRelease | null> {
  const url = `https://api.github.com/repos/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
  try {
    const json = await fetchJson(
      url,
      {
        Accept: 'application/vnd.github+json',
        'User-Agent': 'Blitzmemo',
        'X-GitHub-Api-Version': '2022-11-28'
      },
      DEFAULT_REQUEST_TIMEOUT_MS
    );
    const obj = asRecord(json);
    if (!obj) return null;
    const tag = typeof obj.tag_name === 'string' ? obj.tag_name : '';
    const htmlUrl = typeof obj.html_url === 'string' ? obj.html_url : '';
    const publishedAt = typeof obj.published_at === 'string' ? obj.published_at : null;
    const normalized = normalizeVersionLike(tag);
    if (!normalized || !tag || !htmlUrl) return null;
    return { version: normalized, tag, htmlUrl, publishedAt };
  } catch {
    return null;
  }
}

async function fetchLatestReleaseFromGitHubWebsite(owner: string, repo: string): Promise<LatestGitHubRelease | null> {
  // user-note: Some corporate proxy environments allow github.com but block api.github.com,
  // so we also support parsing the tag from the web redirect / HTML.
  const url = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/latest`;
  try {
    const res = await requestTextWithElectronNet({
      url,
      method: 'GET',
      headers: {
        Accept: 'text/html',
        'User-Agent': 'Blitzmemo'
      },
      timeoutMs: DEFAULT_REQUEST_TIMEOUT_MS
    });

    if (res.status >= 300 && res.status < 400) {
      const location = getHeaderValue(res.headers, 'location');
      if (!location) return null;
      const tag = extractTagFromReleaseUrl(location);
      if (!tag) return null;
      const normalized = normalizeVersionLike(tag);
      if (!normalized) return null;
      const htmlUrl = location.startsWith('http://') || location.startsWith('https://')
        ? location
        : `https://github.com${location.startsWith('/') ? '' : '/'}${location}`;
      return { version: normalized, tag, htmlUrl, publishedAt: null };
    }

    if (res.status < 200 || res.status >= 300) return null;
    const tag = extractTagFromReleaseHtml(res.bodyText);
    if (!tag) return null;
    const normalized = normalizeVersionLike(tag);
    if (!normalized) return null;
    const htmlUrl = `https://github.com/${encodeURIComponent(owner)}/${encodeURIComponent(repo)}/releases/tag/${encodeURIComponent(
      tag
    )}`;
    return { version: normalized, tag, htmlUrl, publishedAt: null };
  } catch {
    return null;
  }
}

async function fetchLatestRelease(owner: string, repo: string): Promise<LatestGitHubRelease | null> {
  const fromApi = await fetchLatestReleaseFromGitHubApi(owner, repo);
  if (fromApi) return fromApi;
  return await fetchLatestReleaseFromGitHubWebsite(owner, repo);
}

export async function fetchLatestGitHubRelease(owner: string, repo: string): Promise<LatestGitHubRelease | null> {
  return await fetchLatestRelease(owner, repo);
}

export class ReleaseWatchStore {
  private loaded = false;
  private lastCheckedAt: number | null = null;
  private lastNotifiedVersion: string | null = null;
  private readonly writeQueue = new WriteQueue();

  async load(): Promise<void> {
    const filePath = getReleaseWatchPath();
    const raw = await readJsonFile(filePath);
    if (raw && typeof raw === 'object') {
      const obj = raw as Partial<ReleaseWatchFile>;
      this.lastCheckedAt = isNonNegativeNumber(obj.lastCheckedAt) ? obj.lastCheckedAt : null;
      this.lastNotifiedVersion = typeof obj.lastNotifiedVersion === 'string' ? obj.lastNotifiedVersion : null;
    } else {
      this.lastCheckedAt = null;
      this.lastNotifiedVersion = null;
    }
    await this.save();
    this.loaded = true;
  }

  async ensureLoaded(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
  }

  getSnapshot(): { lastCheckedAt: number | null; lastNotifiedVersion: string | null } {
    return { lastCheckedAt: this.lastCheckedAt, lastNotifiedVersion: this.lastNotifiedVersion };
  }

  async setLastCheckedAt(timestampMs: number): Promise<void> {
    await this.ensureLoaded();
    this.lastCheckedAt = isNonNegativeNumber(timestampMs) ? timestampMs : Date.now();
    await this.save();
  }

  async setLastNotifiedVersion(version: string): Promise<void> {
    await this.ensureLoaded();
    const normalized = normalizeVersionLike(version);
    if (!normalized) return;
    this.lastNotifiedVersion = normalized;
    await this.save();
  }

  private async save(): Promise<void> {
    const filePath = getReleaseWatchPath();
    await this.writeQueue.enqueue(async () => {
      const data: ReleaseWatchFile = {
        version: 1,
        ...(this.lastCheckedAt !== null ? { lastCheckedAt: this.lastCheckedAt } : {}),
        ...(this.lastNotifiedVersion ? { lastNotifiedVersion: this.lastNotifiedVersion } : {})
      };
      await writeJsonFile(filePath, data);
    });
  }
}

export async function checkForNewGitHubRelease(options: {
  owner: string;
  repo: string;
  currentVersion: string;
  store: ReleaseWatchStore;
  nowMs?: number;
  minCheckIntervalMs?: number;
}): Promise<LatestGitHubRelease | null> {
  const nowMs = isNonNegativeNumber(options.nowMs) ? options.nowMs : Date.now();
  const minIntervalMs =
    isNonNegativeNumber(options.minCheckIntervalMs) && options.minCheckIntervalMs > 0
      ? options.minCheckIntervalMs
      : DEFAULT_MIN_CHECK_INTERVAL_MS;

  const store = options.store;
  await store.ensureLoaded();
  const snapshot = store.getSnapshot();

  if (snapshot.lastCheckedAt !== null && nowMs - snapshot.lastCheckedAt < minIntervalMs) {
    return null;
  }

  try {
    const latest = await fetchLatestGitHubRelease(options.owner, options.repo);
    if (!latest) return null;
    if (!isRemoteVersionNewer(latest.version, options.currentVersion)) return null;
    if (snapshot.lastNotifiedVersion && normalizeVersionLike(snapshot.lastNotifiedVersion) === latest.version) {
      return null;
    }
    return latest;
  } finally {
    await store.setLastCheckedAt(nowMs);
  }
}
