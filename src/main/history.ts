import { app } from 'electron';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from './persistence';
import { HistoryEntry, TranscriptionLanguage, TranscriptionModel } from '../shared/types';
import { isTranscriptionLanguage, isTranscriptionModel } from '../shared/typeGuards';
import { WriteQueue } from './writeQueue';

const HISTORY_FILENAME = 'history.json';

type HistoryFile = {
  version: 1;
  entries: HistoryEntry[];
};

function getHistoryPath(): string {
  return path.join(app.getPath('userData'), HISTORY_FILENAME);
}

function generateId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function normalizeTranscriptionLanguage(value: unknown): TranscriptionLanguage | null {
  return isTranscriptionLanguage(value) ? value : null;
}

function parseHistoryEntry(value: unknown): HistoryEntry | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  if (typeof obj.id !== 'string') return null;
  if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt)) return null;
  const language = normalizeTranscriptionLanguage(obj.language);
  if (!language) return null;
  if (!isTranscriptionModel(obj.model)) return null;
  if (typeof obj.transcript !== 'string') return null;
  if (typeof obj.text !== 'string') return null;
  if (typeof obj.translated !== 'boolean') return null;
  const translationTargetRaw = obj.translationTarget;
  const translationTarget =
    translationTargetRaw !== undefined ? normalizeTranscriptionLanguage(translationTargetRaw) : null;
  if (translationTargetRaw !== undefined && !translationTarget) return null;

  return {
    id: obj.id,
    createdAt: obj.createdAt,
    language,
    model: obj.model,
    transcript: obj.transcript,
    text: obj.text,
    translated: obj.translated,
    ...(translationTarget ? { translationTarget } : {})
  };
}

export class HistoryStore {
  private entries: HistoryEntry[] = [];
  private loaded = false;
  private readonly writeQueue = new WriteQueue();

  constructor(private readonly getMaxItems: () => number) {}

  async load(): Promise<void> {
    const historyPath = getHistoryPath();
    const raw = await readJsonFile(historyPath);
    if (raw && typeof raw === 'object') {
      const obj = raw as Partial<HistoryFile>;
      const rawEntries = Array.isArray(obj.entries) ? obj.entries : [];
      const parsed: HistoryEntry[] = [];
      for (const item of rawEntries) {
        const entry = parseHistoryEntry(item);
        if (entry) parsed.push(entry);
      }
      // Newest first
      parsed.sort((a, b) => b.createdAt - a.createdAt);
      this.entries = parsed;
      await this.pruneAndSave();
    } else {
      this.entries = [];
      await this.save();
    }
    this.loaded = true;
  }

  list(): HistoryEntry[] {
    return [...this.entries];
  }

  async clear(): Promise<void> {
    this.entries = [];
    await this.save();
  }

  async remove(id: string): Promise<boolean> {
    if (!this.loaded) {
      await this.load();
    }

    const next = this.entries.filter((entry) => entry.id !== id);
    if (next.length === this.entries.length) return false;

    this.entries = next;
    await this.save();
    return true;
  }

  async add(input: {
    language: TranscriptionLanguage;
    model: TranscriptionModel;
    transcript: string;
    text: string;
    translated: boolean;
    translationTarget?: TranscriptionLanguage;
  }): Promise<void> {
    const maxItems = this.getMaxItems();
    if (maxItems <= 0) return;
    if (!this.loaded) {
      await this.load();
    }

    const transcript = input.transcript.trim();
    const text = input.text.trim();
    if (!text) return;

    const entry: HistoryEntry = {
      id: generateId(),
      createdAt: Date.now(),
      language: input.language,
      model: input.model,
      transcript,
      text,
      translated: input.translated,
      ...(input.translationTarget ? { translationTarget: input.translationTarget } : {})
    };

    this.entries.unshift(entry);
    await this.pruneAndSave();
  }

  private async pruneAndSave(): Promise<void> {
    const maxItems = Math.max(0, Math.floor(this.getMaxItems()));
    if (maxItems === 0) {
      this.entries = [];
    } else if (this.entries.length > maxItems) {
      this.entries = this.entries.slice(0, maxItems);
    }
    await this.save();
  }

  private async save(): Promise<void> {
    const historyPath = getHistoryPath();
    await this.writeQueue.enqueue(async () => {
      const data: HistoryFile = { version: 1, entries: this.entries };
      await writeJsonFile(historyPath, data);
    });
  }
}
