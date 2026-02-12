import { app } from 'electron';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from './persistence';
import { WriteQueue } from './writeQueue';

const USAGE_FILENAME = 'usage.json';

type UsageFile = {
  version: 1;
  audioSecondsByModel: Record<string, number>;
  sinceAt?: number;
};

function getUsagePath(): string {
  return path.join(app.getPath('userData'), USAGE_FILENAME);
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function parseAudioSecondsByModel(value: unknown): Record<string, number> {
  if (!value || typeof value !== 'object') return {};
  const obj = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [model, seconds] of Object.entries(obj)) {
    if (typeof model !== 'string' || model.trim().length === 0) continue;
    if (!isNonNegativeNumber(seconds)) continue;
    out[model] = seconds;
  }
  return out;
}

export class UsageStore {
  private loaded = false;
  private audioSecondsByModel: Record<string, number> = {};
  private sinceAt: number | null = null;
  private readonly writeQueue = new WriteQueue();

  async load(): Promise<void> {
    const usagePath = getUsagePath();
    const raw = await readJsonFile(usagePath);
    if (raw && typeof raw === 'object') {
      const obj = raw as Partial<UsageFile>;
      this.audioSecondsByModel = parseAudioSecondsByModel(obj.audioSecondsByModel);
      if (isNonNegativeNumber(obj.sinceAt)) {
        this.sinceAt = obj.sinceAt;
      } else {
        const hasUsage = Object.keys(this.audioSecondsByModel).length > 0;
        this.sinceAt = hasUsage ? null : Date.now();
      }
    } else {
      this.audioSecondsByModel = {};
      this.sinceAt = Date.now();
    }
    await this.save();
    this.loaded = true;
  }

  getSnapshot(): { audioSecondsByModel: Record<string, number>; sinceAt: number | null } {
    return { audioSecondsByModel: { ...this.audioSecondsByModel }, sinceAt: this.sinceAt };
  }

  async clear(): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    this.audioSecondsByModel = {};
    this.sinceAt = Date.now();
    await this.save();
  }

  async addAudioSeconds(model: string, seconds: number): Promise<void> {
    if (!this.loaded) {
      await this.load();
    }
    const normalizedModel = model.trim();
    if (!normalizedModel) return;
    const normalizedSeconds = Number.isFinite(seconds) ? seconds : 0;
    if (normalizedSeconds <= 0) return;

    if (this.sinceAt === null && Object.keys(this.audioSecondsByModel).length === 0) {
      this.sinceAt = Date.now();
    }

    const existing = this.audioSecondsByModel[normalizedModel] ?? 0;
    this.audioSecondsByModel[normalizedModel] = existing + normalizedSeconds;
    await this.save();
  }

  private async save(): Promise<void> {
    const usagePath = getUsagePath();
    await this.writeQueue.enqueue(async () => {
      const data: UsageFile = {
        version: 1,
        audioSecondsByModel: this.audioSecondsByModel,
        ...(this.sinceAt !== null ? { sinceAt: this.sinceAt } : {})
      };
      await writeJsonFile(usagePath, data);
    });
  }
}
