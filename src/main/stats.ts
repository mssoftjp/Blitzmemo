import { app } from 'electron';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from './persistence';
import type { StatsEntry, TranscriptionLanguage, TranscriptionModel } from '../shared/types';
import { isTranscriptionLanguage, isTranscriptionModel } from '../shared/typeGuards';
import { WriteQueue } from './writeQueue';

const STATS_FILENAME = 'stats.json';
const MAX_STATS_ENTRIES = 100000;

type StatsFile = {
  version: 1;
  entries: StatsEntry[];
  sinceAt?: number;
};

function getStatsPath(): string {
  return path.join(app.getPath('userData'), STATS_FILENAME);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function countGraphemes(text: string): number {
  if (!text) return 0;
  if (typeof Intl.Segmenter !== 'function') return Array.from(text).length;
  const seg = new Intl.Segmenter('und', { granularity: 'grapheme' });
  return Array.from(seg.segment(text)).length;
}

function normalizeTranscriptionLanguage(value: unknown): TranscriptionLanguage | null {
  return isTranscriptionLanguage(value) ? value : null;
}

function parseStatsEntry(value: unknown): StatsEntry | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string') return null;
  if (!isNonNegativeNumber(obj.endedAt)) return null;
  if (!isNonNegativeNumber(obj.durationSeconds)) return null;
  const waitSeconds = isNonNegativeNumber(obj.waitSeconds) ? obj.waitSeconds : null;
  if (!isNonNegativeNumber(obj.charCount)) return null;
  const language = normalizeTranscriptionLanguage(obj.language);
  if (!language) return null;
  if (!isTranscriptionModel(obj.model)) return null;
  return {
    id: obj.id,
    endedAt: obj.endedAt,
    durationSeconds: obj.durationSeconds,
    ...(waitSeconds !== null ? { waitSeconds } : {}),
    charCount: obj.charCount,
    language,
    model: obj.model
  };
}

function minEndedAt(entries: StatsEntry[]): number {
  let min = Number.POSITIVE_INFINITY;
  for (const entry of entries) {
    min = Math.min(min, entry.endedAt);
  }
  return Number.isFinite(min) ? min : Date.now();
}

export class StatsStore {
  private loaded = false;
  private entries: StatsEntry[] = [];
  private sinceAt: number | null = null;
  private readonly writeQueue = new WriteQueue();

  async load(): Promise<void> {
    const statsPath = getStatsPath();
    const raw = await readJsonFile(statsPath);
    if (raw && typeof raw === 'object') {
      const obj = raw as Partial<StatsFile>;
      const parsedEntries: StatsEntry[] = [];
      const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
      for (const item of rawEntries) {
        const entry = parseStatsEntry(item);
        if (entry) parsedEntries.push(entry);
      }
      parsedEntries.sort((a, b) => b.endedAt - a.endedAt);
      this.entries = parsedEntries;
      if (isNonNegativeNumber(obj.sinceAt)) {
        this.sinceAt = obj.sinceAt;
      } else if (this.entries.length === 0) {
        this.sinceAt = Date.now();
      } else {
        this.sinceAt = minEndedAt(this.entries);
      }
    } else {
      this.entries = [];
      this.sinceAt = Date.now();
    }
    await this.pruneAndSave();
    this.loaded = true;
  }

  getSnapshot(): { entries: StatsEntry[]; sinceAt: number | null } {
    return { entries: [...this.entries], sinceAt: this.sinceAt };
  }

  async clear(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    this.entries = [];
    this.sinceAt = Date.now();
    await this.save();
  }

  async addTranscription(input: {
    endedAt: number;
    durationSeconds: number;
    waitSeconds?: number;
    language: TranscriptionLanguage;
    model: TranscriptionModel;
    text: string;
  }): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }

    const trimmed = input.text.trim();
    if (!trimmed) return;

    const endedAt = Number.isFinite(input.endedAt) ? Math.max(0, Math.floor(input.endedAt)) : Date.now();
    const durationSeconds = Number.isFinite(input.durationSeconds) ? Math.max(0, input.durationSeconds) : 0;
    const waitSecondsRaw = input.waitSeconds;
    const waitSeconds =
      typeof waitSecondsRaw === 'number' && Number.isFinite(waitSecondsRaw)
        ? Math.max(0, Math.min(24 * 60 * 60, waitSecondsRaw))
        : null;
    const charCount = countGraphemes(input.text);
    if (charCount <= 0) return;

    const entry: StatsEntry = {
      id: generateId(),
      endedAt,
      durationSeconds,
      ...(waitSeconds !== null ? { waitSeconds } : {}),
      charCount,
      language: input.language,
      model: input.model
    };

    this.entries.unshift(entry);
    await this.pruneAndSave();
  }

  private async pruneAndSave(): Promise<void> {
    if (this.entries.length > MAX_STATS_ENTRIES) {
      this.entries = this.entries.slice(0, MAX_STATS_ENTRIES);
    }
    if (this.sinceAt === null) {
      this.sinceAt = this.entries.length > 0 ? minEndedAt(this.entries) : Date.now();
    }
    await this.save();
  }

  private async save(): Promise<void> {
    const statsPath = getStatsPath();
    await this.writeQueue.enqueue(async () => {
      const data: StatsFile = {
        version: 1,
        entries: this.entries,
        ...(this.sinceAt !== null ? { sinceAt: this.sinceAt } : {})
      };
      await writeJsonFile(statsPath, data);
    });
  }
}
