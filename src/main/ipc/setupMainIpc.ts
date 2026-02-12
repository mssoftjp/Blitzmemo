import { app, BrowserWindow, dialog, ipcMain, shell, systemPreferences, type IpcMainInvokeEvent } from 'electron';
import crypto from 'node:crypto';
import fs from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import zlib from 'node:zlib';
import { promisify } from 'node:util';
import { writeJsonFile } from '../persistence';
import { isPlausibleOpenAIKey, type SettingsStore } from '../settings';
import type { HistoryStore } from '../history';
import type { UsageStore } from '../usage';
import type { StatsStore } from '../stats';
import { compareSemverStrings, fetchLatestGitHubRelease, type ReleaseWatchStore } from '../releaseWatch';
import { parseDictionaryRules, validateDictionaryRules } from '../dictionary';
import { translateWithOpenAIAutoDetectSource } from '../translation';
import { isHotkeyConflictingWithFixedShortcuts, isUserConfigurableHotkeyAccelerator, normalizeAccelerator } from '../../shared/hotkey';
import { t } from '../../shared/i18n';
import {
  MEMO_PAD_BUTTON_ORDER,
  type AppSettings,
  type HistoryEntry,
  type MemoPadButtonId,
  type OverlayPlacement,
  type SilenceProcessingMode,
  type StatsEntry,
  type ThemeMode,
  type TranscriptionLanguage,
  type TranscriptionModel
} from '../../shared/types';
import type { ApiErrorCode, AppDataSections } from '../../shared/voiceInputApi';
import { isTranscriptionLanguage, isTranscriptionModel, isUiLanguage } from '../../shared/typeGuards';

export type RecordingState = 'idle' | 'recording' | 'transcribing' | 'error';

type AudioInputDeviceInfo = { deviceId: string; label: string };
type TranscribePayload = {
  audioData: ArrayBuffer;
  mimeType: string;
  durationSeconds?: number;
  silenceProcessingMode?: SilenceProcessingMode;
  endedAt?: number;
};
type TranscribeResult = {
  ok: boolean;
  text?: string;
  transcript?: string;
  didCopy?: boolean;
  didPaste?: boolean;
  pasteError?: string;
  canceled?: boolean;
  error?: string;
  errorCode?: ApiErrorCode;
};

export type MainIpcContext = {
  settingsStore: SettingsStore;
  historyStore: HistoryStore;
  usageStore: UsageStore;
  statsStore: StatsStore;
  releaseWatchStore: ReleaseWatchStore;
  about: {
    copyright: string;
    githubUrl: string;
    websiteUrl: string;
    privacyPolicyUrl: string;
  };
  applyThemeMode: (mode: ThemeMode) => void;
  openAppUiWindow: (target: 'memo' | 'history' | 'preferences') => Promise<void>;
  popupTrayMenuInWindow: (window: BrowserWindow, x?: number, y?: number) => void;
  getMemoWindow: () => BrowserWindow | null;
  getHistoryWindow: () => BrowserWindow | null;
  getRecordingState: () => RecordingState;
  setRecordingState: (state: RecordingState) => void;
  setLastRecordingStartAt: (timestamp: number) => void;
  setLastRecordingLevel: (level: number) => void;
  setLastRecordingErrorMessage: (message: string | null) => void;
  setAudioInputDevices: (devices: AudioInputDeviceInfo[]) => void;
  setSystemDefaultMicrophoneLabel: (label: string | null) => void;
  normalizeMicLabel: (value: unknown) => string;
  updateTrayMenu: () => void;
  syncUpdateCheckLoopEnabled: () => void;
  setTrayState: (state: RecordingState) => void;
  setOverlayState: (state: RecordingState) => void;
  restoreRecordingStartFocusIfNeeded: (state: RecordingState) => void;
  broadcastRecordingLevel: (level: number) => void;
  broadcastRecordingState: (state: RecordingState, message?: string) => void;
  broadcastUiLanguageChanged: () => void;
  broadcastSettingsChanged: () => void;
  broadcastAccentColorChanged: () => void;
  broadcastMemoButtonLayout: () => void;
  clearGlobalHotkeyPttSession: () => void;
  setCancelHotkeyEnabled: (enabled: boolean) => void;
  scheduleAutoPasteFlush: (delayMs: number) => void;
  rememberRecordingStartFocus: (event: IpcMainInvokeEvent) => void;
  sendRecordingToggle: () => void;
  sendRecordingStart: () => void;
  sendRecordingStop: () => void;
  sendRecordingCancel: () => void;
  cancelPendingTranscriptions: () => void;
  enqueueTranscribe: (payload: TranscribePayload) => Promise<TranscribeResult>;
  tryRegisterHotkey: (hotkey: string) => { ok: boolean; errorCode?: ApiErrorCode; error?: string };
  isAccessibilityTrusted: () => boolean;
  getApiTimeoutMsForText: (text: string) => number;
};

function normalizeAudioInputDevices(ctx: MainIpcContext, value: unknown): AudioInputDeviceInfo[] {
  if (!Array.isArray(value)) return [];
  const next: AudioInputDeviceInfo[] = [];
  const seen = new Set<string>();
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.deviceId !== 'string') continue;
    const deviceId = obj.deviceId.trim();
    if (!deviceId) continue;
    if (deviceId === 'default') continue;
    if (seen.has(deviceId)) continue;
    seen.add(deviceId);
    next.push({ deviceId, label: ctx.normalizeMicLabel(obj.label) });
  }
  return next;
}

function parseGitHubOwnerRepoFromUrl(url: string): { owner: string; repo: string } | null {
  try {
    const parsed = new URL(url);
    if (parsed.hostname.toLowerCase() !== 'github.com') return null;
    const parts = parsed.pathname.split('/').filter(Boolean);
    if (parts.length < 2) return null;
    const owner = parts[0]?.trim() ?? '';
    const repo = parts[1]?.trim() ?? '';
    if (!owner || !repo) return null;
    return { owner, repo };
  } catch {
    return null;
  }
}

const APP_DATA_FILE_KIND = 'blitzmemo-app-data';
const APP_DATA_EXPORT_EXTENSION = 'blitzmemo';
const APP_DATA_EXPORT_MAGIC = Buffer.from('BLITZMEM');
const APP_DATA_EXPORT_CONTAINER_VERSION = 1;
const APP_DATA_EXPORT_FLAG_ENCRYPTED = 1 << 0;
const APP_DATA_EXPORT_HEADER_SIZE_PLAIN = 8 + 1 + 1;
const APP_DATA_EXPORT_SALT_BYTES = 16;
const APP_DATA_EXPORT_IV_BYTES = 12;
const APP_DATA_EXPORT_TAG_BYTES = 16;
const APP_DATA_EXPORT_HEADER_SIZE_ENCRYPTED =
  APP_DATA_EXPORT_HEADER_SIZE_PLAIN + APP_DATA_EXPORT_SALT_BYTES + APP_DATA_EXPORT_IV_BYTES + APP_DATA_EXPORT_TAG_BYTES;

const gzipAsync = promisify(zlib.gzip) as unknown as (buffer: Buffer) => Promise<Buffer>;
const gunzipAsync = promisify(zlib.gunzip) as unknown as (buffer: Buffer) => Promise<Buffer>;
const scryptAsync = promisify(crypto.scrypt) as unknown as (
  password: string,
  salt: Buffer,
  keyLength: number,
  options: crypto.ScryptOptions
) => Promise<Buffer>;

const APP_DATA_EXPORT_SCRYPT_OPTIONS: crypto.ScryptOptions = {
  N: 1 << 15,
  r: 8,
  p: 1
};

const APP_DATA_SETTINGS_KEYS_APP: (keyof AppSettings)[] = [
  'themeMode',
  'accentColor',
  'overlayPlacement',
  'overlayOffsetX',
  'overlayOffsetY',
  'language',
  'model',
  'hotkey',
  'apiTimeoutSeconds',
  'recordingMaxSeconds',
  'silenceProcessingMode',
  'silenceAutoStopSeconds',
  'micWarmGraceSeconds',
  'autoPaste',
  'memoPadAutoMemo',
  'memoPadPersistText',
  'memoPadInsertAtCursor',
  'memoPadAlwaysOnTop',
  'memoPadEditorFontSizePx',
  'memoPadUndoMaxSteps',
  'memoPadText',
  'memoPadVisibleButtons',
  'translationEnabled',
  'translationTarget',
  // Intentionally excluded: micDeviceId, memoPadBounds
];

type AppDataFileV1 = {
  kind: typeof APP_DATA_FILE_KIND;
  version: 1;
  createdAt: number;
  appVersion: string;
  platform: string;
  data: {
    settings?: {
      app?: Partial<AppSettings>;
      dictionary?: Pick<AppSettings, 'dictionaryEnabled' | 'dictionaryRulesText'>;
      history?: Pick<AppSettings, 'historyMaxItems' | 'historyAlwaysOnTop'>;
      stats?: Pick<AppSettings, 'keyboardCharsPerMinute'>;
    };
    history?: { version: 1; entries: HistoryEntry[] };
    stats?: { version: 1; entries: StatsEntry[]; sinceAt?: number };
    usage?: { version: 1; audioSecondsByModel: Record<string, number>; sinceAt?: number };
  };
};

function encodeAppDataExportHeader(flags: number): Buffer {
  const header = Buffer.alloc(APP_DATA_EXPORT_HEADER_SIZE_PLAIN);
  APP_DATA_EXPORT_MAGIC.copy(header, 0);
  header[8] = APP_DATA_EXPORT_CONTAINER_VERSION;
  header[9] = flags;
  return header;
}

function encodeAppDataExportAad(flags: number, salt: Buffer, iv: Buffer): Buffer {
  const header = Buffer.alloc(APP_DATA_EXPORT_HEADER_SIZE_PLAIN + APP_DATA_EXPORT_SALT_BYTES + APP_DATA_EXPORT_IV_BYTES);
  APP_DATA_EXPORT_MAGIC.copy(header, 0);
  header[8] = APP_DATA_EXPORT_CONTAINER_VERSION;
  header[9] = flags;
  salt.copy(header, APP_DATA_EXPORT_HEADER_SIZE_PLAIN);
  iv.copy(header, APP_DATA_EXPORT_HEADER_SIZE_PLAIN + APP_DATA_EXPORT_SALT_BYTES);
  return header;
}

async function buildAppDataExportBytes(file: AppDataFileV1, password: string | null): Promise<Buffer> {
  const json = Buffer.from(JSON.stringify(file), 'utf-8');
  const gzipped = await gzipAsync(json);

  if (!password) {
    return Buffer.concat([encodeAppDataExportHeader(0), gzipped]);
  }

  const salt = crypto.randomBytes(APP_DATA_EXPORT_SALT_BYTES);
  const iv = crypto.randomBytes(APP_DATA_EXPORT_IV_BYTES);
  const flags = APP_DATA_EXPORT_FLAG_ENCRYPTED;
  const aad = encodeAppDataExportAad(flags, salt, iv);
  const key = await scryptAsync(password, salt, 32, APP_DATA_EXPORT_SCRYPT_OPTIONS);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);
  cipher.setAAD(aad);
  const ciphertext = Buffer.concat([cipher.update(gzipped), cipher.final()]);
  const tag = cipher.getAuthTag();
  return Buffer.concat([aad, tag, ciphertext]);
}

async function decodeAppDataExportBytes(
  buffer: Buffer,
  password: string | null
): Promise<{ ok: true; file: AppDataFileV1 } | { ok: false; errorCode: ApiErrorCode; error?: string }> {
  if (buffer.length < APP_DATA_EXPORT_HEADER_SIZE_PLAIN) {
    return { ok: false, errorCode: 'transfer.failedToImport', error: t('en', 'detail.transfer.invalidFileFormat') };
  }

  const magic = buffer.subarray(0, 8);
  if (!magic.equals(APP_DATA_EXPORT_MAGIC)) {
    return { ok: false, errorCode: 'transfer.failedToImport', error: t('en', 'detail.transfer.notExportFile') };
  }

  const containerVersion = buffer[8] ?? 0;
  if (containerVersion !== APP_DATA_EXPORT_CONTAINER_VERSION) {
    return { ok: false, errorCode: 'transfer.failedToImport', error: t('en', 'detail.transfer.unsupportedExportVersion') };
  }

  const flags = buffer[9] ?? 0;
  const encrypted = (flags & APP_DATA_EXPORT_FLAG_ENCRYPTED) !== 0;

  let gzipped: Buffer;
  if (!encrypted) {
    gzipped = buffer.subarray(APP_DATA_EXPORT_HEADER_SIZE_PLAIN);
  } else {
    if (!password) {
      return { ok: false, errorCode: 'transfer.passwordRequired' };
    }
    if (buffer.length < APP_DATA_EXPORT_HEADER_SIZE_ENCRYPTED) {
      return { ok: false, errorCode: 'transfer.failedToImport', error: t('en', 'detail.transfer.invalidFileFormat') };
    }

    const aadLength = APP_DATA_EXPORT_HEADER_SIZE_PLAIN + APP_DATA_EXPORT_SALT_BYTES + APP_DATA_EXPORT_IV_BYTES;
    const aad = buffer.subarray(0, aadLength);
    const salt = buffer.subarray(APP_DATA_EXPORT_HEADER_SIZE_PLAIN, APP_DATA_EXPORT_HEADER_SIZE_PLAIN + APP_DATA_EXPORT_SALT_BYTES);
    const iv = buffer.subarray(
      APP_DATA_EXPORT_HEADER_SIZE_PLAIN + APP_DATA_EXPORT_SALT_BYTES,
      APP_DATA_EXPORT_HEADER_SIZE_PLAIN + APP_DATA_EXPORT_SALT_BYTES + APP_DATA_EXPORT_IV_BYTES
    );
    const tagStart = aadLength;
    const tagEnd = tagStart + APP_DATA_EXPORT_TAG_BYTES;
    const tag = buffer.subarray(tagStart, tagEnd);
    const ciphertext = buffer.subarray(tagEnd);
    try {
      const key = await scryptAsync(password, salt, 32, APP_DATA_EXPORT_SCRYPT_OPTIONS);
      const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
      decipher.setAAD(aad);
      decipher.setAuthTag(tag);
      gzipped = Buffer.concat([decipher.update(ciphertext), decipher.final()]);
    } catch {
      return { ok: false, errorCode: 'transfer.invalidPassword' };
    }
  }

  let jsonBytes: Buffer;
  try {
    jsonBytes = await gunzipAsync(gzipped);
  } catch {
    return { ok: false, errorCode: 'transfer.failedToImport', error: t('en', 'detail.transfer.invalidFileFormat') };
  }

  let parsedJson: unknown;
  try {
    parsedJson = JSON.parse(jsonBytes.toString('utf-8')) as unknown;
  } catch {
    return { ok: false, errorCode: 'transfer.failedToImport', error: t('en', 'detail.transfer.invalidFileFormat') };
  }

  const parsed = parseAppDataFile(parsedJson);
  if (!parsed.ok) {
    return { ok: false, errorCode: 'transfer.failedToImport', error: parsed.error };
  }

  return { ok: true, file: parsed.file };
}

function normalizeAppDataSections(value: unknown): AppDataSections {
  if (!value || typeof value !== 'object') {
    return { appSettings: false, dictionary: false, history: false, stats: false, usage: false };
  }
  const obj = value as Record<string, unknown>;
  return {
    appSettings: obj.appSettings === true,
    dictionary: obj.dictionary === true,
    history: obj.history === true,
    stats: obj.stats === true,
    usage: obj.usage === true
  };
}

type AppDataExportOptions = { password: string | null };
type AppDataImportOptions = { password: string | null; filePath: string | null };

function normalizeAppDataPassword(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  return trimmed;
}

function normalizeAppDataExportOptions(value: unknown): AppDataExportOptions {
  if (!value || typeof value !== 'object') {
    return { password: null };
  }
  const obj = value as Record<string, unknown>;
  return { password: normalizeAppDataPassword(obj.password) };
}

function normalizeAppDataImportOptions(value: unknown): AppDataImportOptions {
  if (!value || typeof value !== 'object') {
    return { password: null, filePath: null };
  }
  const obj = value as Record<string, unknown>;
  const filePath = typeof obj.filePath === 'string' ? obj.filePath.trim() : '';
  return { password: normalizeAppDataPassword(obj.password), filePath: filePath.length > 0 ? filePath : null };
}

function formatAppDataExportFilename(now: Date = new Date()): string {
  const pad2 = (n: number) => String(n).padStart(2, '0');
  const yyyy = now.getFullYear();
  const mm = pad2(now.getMonth() + 1);
  const dd = pad2(now.getDate());
  const hh = pad2(now.getHours());
  const mi = pad2(now.getMinutes());
  const ss = pad2(now.getSeconds());
  return `blitzmemo-export-${yyyy}${mm}${dd}-${hh}${mi}${ss}.${APP_DATA_EXPORT_EXTENSION}`;
}

function pickSettings<T extends keyof AppSettings>(
  settings: AppSettings,
  keys: readonly T[]
): Partial<Pick<AppSettings, T>> {
  const out: Partial<Pick<AppSettings, T>> = {};
  for (const key of keys) {
    const value = settings[key];
    if (value === undefined) continue;
    out[key] = value;
  }
  return out;
}

function isNonNegativeNumber(value: unknown): value is number {
  return typeof value === 'number' && Number.isFinite(value) && value >= 0;
}

function normalizeTranscriptionLanguage(value: unknown): TranscriptionLanguage | null {
  return isTranscriptionLanguage(value) ? value : null;
}

function normalizeHistoryEntries(value: unknown): HistoryEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: HistoryEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.id !== 'string') continue;
    if (typeof obj.createdAt !== 'number' || !Number.isFinite(obj.createdAt)) continue;
    const language = normalizeTranscriptionLanguage(obj.language);
    if (!language) continue;
    if (!isTranscriptionModel(obj.model)) continue;
    if (typeof obj.transcript !== 'string') continue;
    if (typeof obj.text !== 'string') continue;
    if (typeof obj.translated !== 'boolean') continue;
    const translationTargetRaw = obj.translationTarget;
    const translationTarget =
      translationTargetRaw !== undefined ? normalizeTranscriptionLanguage(translationTargetRaw) : null;
    if (translationTargetRaw !== undefined && !translationTarget) continue;
    out.push({
      id: obj.id,
      createdAt: obj.createdAt,
      language,
      model: obj.model,
      transcript: obj.transcript,
      text: obj.text,
      translated: obj.translated,
      ...(translationTarget ? { translationTarget } : {})
    });
  }
  out.sort((a, b) => b.createdAt - a.createdAt);
  return out;
}

function normalizeStatsEntries(value: unknown): StatsEntry[] | null {
  if (!Array.isArray(value)) return null;
  const out: StatsEntry[] = [];
  for (const item of value) {
    if (!item || typeof item !== 'object') continue;
    const obj = item as Record<string, unknown>;
    if (typeof obj.id !== 'string') continue;
    if (!isNonNegativeNumber(obj.endedAt)) continue;
    if (!isNonNegativeNumber(obj.durationSeconds)) continue;
    const waitSeconds = isNonNegativeNumber(obj.waitSeconds) ? obj.waitSeconds : null;
    if (!isNonNegativeNumber(obj.charCount)) continue;
    const language = normalizeTranscriptionLanguage(obj.language);
    if (!language) continue;
    if (!isTranscriptionModel(obj.model)) continue;
    out.push({
      id: obj.id,
      endedAt: obj.endedAt,
      durationSeconds: obj.durationSeconds,
      ...(waitSeconds !== null ? { waitSeconds } : {}),
      charCount: obj.charCount,
      language,
      model: obj.model
    });
  }
  out.sort((a, b) => b.endedAt - a.endedAt);
  return out;
}

function normalizeAudioSecondsByModel(value: unknown): Record<string, number> | null {
  if (!value || typeof value !== 'object') return null;
  const obj = value as Record<string, unknown>;
  const out: Record<string, number> = {};
  for (const [model, seconds] of Object.entries(obj)) {
    if (typeof model !== 'string' || model.trim().length === 0) continue;
    if (!isNonNegativeNumber(seconds)) continue;
    out[model] = seconds;
  }
  return out;
}

function buildAppDataExportFile(ctx: MainIpcContext, sections: AppDataSections): AppDataFileV1 {
  const settingsStore = ctx.settingsStore;
  const historyStore = ctx.historyStore;
  const usageStore = ctx.usageStore;
  const statsStore = ctx.statsStore;

  const s = settingsStore.get();
  const settings: NonNullable<AppDataFileV1['data']['settings']> = {};
  // user-note: Keep exported JSON section order stable (and diff-friendly) by
  // inserting `settings` first, then adding other selected sections.
  const data: AppDataFileV1['data'] = { settings };

  if (sections.appSettings) {
    settings.app = pickSettings(s, APP_DATA_SETTINGS_KEYS_APP);
  }
  if (sections.dictionary) {
    settings.dictionary = { dictionaryEnabled: s.dictionaryEnabled, dictionaryRulesText: s.dictionaryRulesText };
  }
  if (sections.history) {
    settings.history = { historyMaxItems: s.historyMaxItems, historyAlwaysOnTop: s.historyAlwaysOnTop };
    data.history = { version: 1, entries: historyStore.list() };
  }
  if (sections.stats) {
    settings.stats = { keyboardCharsPerMinute: s.keyboardCharsPerMinute };
    const snapshot = statsStore.getSnapshot();
    data.stats = {
      version: 1,
      entries: snapshot.entries,
      ...(isNonNegativeNumber(snapshot.sinceAt) ? { sinceAt: snapshot.sinceAt } : {})
    };
  }
  if (sections.usage) {
    const snapshot = usageStore.getSnapshot();
    data.usage = {
      version: 1,
      audioSecondsByModel: snapshot.audioSecondsByModel,
      ...(isNonNegativeNumber(snapshot.sinceAt) ? { sinceAt: snapshot.sinceAt } : {})
    };
  }

  if (Object.keys(settings).length === 0) {
    delete data.settings;
  }

  return {
    kind: APP_DATA_FILE_KIND,
    version: 1,
    createdAt: Date.now(),
    appVersion: app.getVersion(),
    platform: process.platform,
    data
  };
}

function asRecord(value: unknown): Record<string, unknown> | null {
  if (!value || typeof value !== 'object') return null;
  return value as Record<string, unknown>;
}

function parseAppDataFile(value: unknown): { ok: true; file: AppDataFileV1 } | { ok: false; error: string } {
  const obj = asRecord(value);
  if (!obj) return { ok: false, error: t('en', 'detail.transfer.invalidFileFormat') };
  if (obj.kind !== APP_DATA_FILE_KIND) return { ok: false, error: t('en', 'detail.transfer.notExportFile') };
  if (obj.version !== 1) return { ok: false, error: t('en', 'detail.transfer.unsupportedExportVersion') };
  const data = asRecord(obj.data);
  if (!data) return { ok: false, error: t('en', 'detail.transfer.invalidExportPayload') };

  const createdAt = typeof obj.createdAt === 'number' && Number.isFinite(obj.createdAt) ? obj.createdAt : Date.now();
  const appVersion = typeof obj.appVersion === 'string' ? obj.appVersion : '';
  const platform = typeof obj.platform === 'string' ? obj.platform : '';
  const file: AppDataFileV1 = {
    kind: APP_DATA_FILE_KIND,
    version: 1,
    createdAt,
    appVersion,
    platform,
    data: data as unknown as AppDataFileV1['data']
  };
  return { ok: true, file };
}

const MEMO_PAD_BUTTON_ID_SET = new Set<MemoPadButtonId>(MEMO_PAD_BUTTON_ORDER);

async function applyImportedSettingsPatch(ctx: MainIpcContext, section: Partial<AppSettings>): Promise<void> {
  const settingsStore = ctx.settingsStore;
  const patch = section;

  // Theme
  if (typeof patch.themeMode === 'string') {
    const mode = patch.themeMode.trim();
    if (mode === 'system' || mode === 'light' || mode === 'dark') {
      await settingsStore.setThemeMode(mode as ThemeMode);
      ctx.applyThemeMode(mode as ThemeMode);
    }
  }
  const accentColorRaw = (patch as Record<string, unknown>).accentColor;
  if (accentColorRaw === null) {
    await settingsStore.setAccentColor(null);
  } else if (typeof accentColorRaw === 'string') {
    const normalized = accentColorRaw.trim().toLowerCase();
    if (/^#[0-9a-f]{6}$/.test(normalized)) {
      await settingsStore.setAccentColor(normalized);
    }
  }

  // Overlay
  if (typeof patch.overlayPlacement === 'string') {
    const placement = patch.overlayPlacement.trim();
    if (
      placement === 'cursor' ||
      placement === 'bottomRight' ||
      placement === 'bottomLeft' ||
      placement === 'bottomCenter' ||
      placement === 'topRight' ||
      placement === 'topLeft' ||
      placement === 'none'
    ) {
      await settingsStore.setOverlayPlacement(placement as OverlayPlacement);
    }
  }
  if (typeof patch.overlayOffsetX === 'number' && Number.isFinite(patch.overlayOffsetX)) {
    await settingsStore.setOverlayOffsetX(patch.overlayOffsetX);
  }
  if (typeof patch.overlayOffsetY === 'number' && Number.isFinite(patch.overlayOffsetY)) {
    await settingsStore.setOverlayOffsetY(patch.overlayOffsetY);
  }

  // Language / Model
  const uiLanguageRaw = (patch as Record<string, unknown>).uiLanguage;
  if (isUiLanguage(uiLanguageRaw)) {
    await settingsStore.setUiLanguage(uiLanguageRaw);
  }
  const transcriptionLanguage = normalizeTranscriptionLanguage(patch.language);
  if (transcriptionLanguage) {
    await settingsStore.setLanguage(transcriptionLanguage);
  }
  if (isTranscriptionModel(patch.model)) {
    await settingsStore.setModel(patch.model);
  }

  // Hotkey (validate + try to register first)
  if (typeof patch.hotkey === 'string') {
    const hotkey = patch.hotkey.trim();
    if (hotkey) {
      const normalized = normalizeAccelerator(hotkey);
      if (normalized && isUserConfigurableHotkeyAccelerator(normalized) && !isHotkeyConflictingWithFixedShortcuts(normalized)) {
        const result = ctx.tryRegisterHotkey(normalized);
        if (result.ok) {
          await settingsStore.setHotkey(normalized);
          ctx.updateTrayMenu();
        }
      }
    }
  }

  // API timeout
  if (typeof patch.apiTimeoutSeconds === 'number' && Number.isFinite(patch.apiTimeoutSeconds)) {
    await settingsStore.setApiTimeoutSeconds(patch.apiTimeoutSeconds);
  }

  // Recording
  if (typeof patch.recordingMaxSeconds === 'number' && Number.isFinite(patch.recordingMaxSeconds)) {
    await settingsStore.setRecordingMaxSeconds(patch.recordingMaxSeconds);
  }

  // Silence
  if (patch.silenceProcessingMode === 'none' || patch.silenceProcessingMode === 'server') {
    await settingsStore.setSilenceProcessingMode(patch.silenceProcessingMode);
  }
  if (typeof patch.silenceAutoStopSeconds === 'number' && Number.isFinite(patch.silenceAutoStopSeconds)) {
    await settingsStore.setSilenceAutoStopSeconds(patch.silenceAutoStopSeconds);
  }

  // Mic
  if (typeof patch.micWarmGraceSeconds === 'number' && Number.isFinite(patch.micWarmGraceSeconds)) {
    await settingsStore.setMicWarmGraceSeconds(patch.micWarmGraceSeconds);
  }

  // Paste / memo
  if (typeof patch.autoPaste === 'boolean') {
    await settingsStore.setAutoPaste(patch.autoPaste);
    ctx.updateTrayMenu();
  }
  if (typeof patch.memoPadAutoMemo === 'boolean') {
    await settingsStore.setMemoPadAutoMemo(patch.memoPadAutoMemo);
    ctx.updateTrayMenu();
  }
  if (typeof patch.memoPadPersistText === 'boolean') {
    await settingsStore.setMemoPadPersistText(patch.memoPadPersistText);
  }
  if (typeof patch.memoPadInsertAtCursor === 'boolean') {
    await settingsStore.setMemoPadInsertAtCursor(patch.memoPadInsertAtCursor);
    ctx.updateTrayMenu();
  }
  if (typeof patch.memoPadAlwaysOnTop === 'boolean') {
    const next = patch.memoPadAlwaysOnTop;
    await settingsStore.setMemoPadAlwaysOnTop(next);
    const memoWindow = ctx.getMemoWindow();
    memoWindow?.setAlwaysOnTop(next);
    if (process.platform === 'darwin') {
      memoWindow?.setFullScreenable(!next);
    }
  }
  if (typeof patch.memoPadEditorFontSizePx === 'number' && Number.isFinite(patch.memoPadEditorFontSizePx)) {
    await settingsStore.setMemoPadEditorFontSizePx(patch.memoPadEditorFontSizePx);
  }
  if (typeof patch.memoPadUndoMaxSteps === 'number' && Number.isFinite(patch.memoPadUndoMaxSteps)) {
    await settingsStore.setMemoPadUndoMaxSteps(patch.memoPadUndoMaxSteps);
  }
  if (typeof patch.memoPadText === 'string' && settingsStore.get().memoPadPersistText) {
    await settingsStore.setMemoPadText(patch.memoPadText);
  }
  if (Array.isArray(patch.memoPadVisibleButtons)) {
    const next: MemoPadButtonId[] = [];
    for (const item of patch.memoPadVisibleButtons) {
      if (!MEMO_PAD_BUTTON_ID_SET.has(item)) continue;
      const id = item;
      if (next.includes(id)) continue;
      next.push(id);
    }
    await settingsStore.setMemoPadVisibleButtons(next);
    ctx.broadcastMemoButtonLayout();
  }

  // Translation
  const translationEnabledRaw = (patch as Record<string, unknown>).translationEnabled;
  if (typeof translationEnabledRaw === 'boolean') {
    await settingsStore.setTranslationEnabled(translationEnabledRaw);
  }
  const translationTargetRaw = (patch as Record<string, unknown>).translationTarget;
  const translationTarget = normalizeTranscriptionLanguage(translationTargetRaw);
  if (translationTarget) {
    await settingsStore.setTranslationTarget(translationTarget);
  }

  ctx.broadcastUiLanguageChanged();
  ctx.broadcastSettingsChanged();
  ctx.broadcastAccentColorChanged();
}

function isAllowedExternalUrl(value: string): boolean {
  try {
    const url = new URL(value);
    if (url.protocol !== 'https:') return false;
    const host = url.hostname.toLowerCase();
    if (host === 'github.com' || host.endsWith('.github.com')) return true;
    if (host === 'blitzmemo.com' || host.endsWith('.blitzmemo.com')) return true;
    // user-note: About page has external links (author website / donation) hosted outside blitzmemo.com/github.com.
    if (host === 'ms-soft.jp' || host.endsWith('.ms-soft.jp')) return true;
    if (host === 'buymeacoffee.com' || host.endsWith('.buymeacoffee.com')) return true;
    return false;
  } catch {
    return false;
  }
}

async function pathExists(p: string): Promise<boolean> {
  try {
    await fs.stat(p);
    return true;
  } catch {
    return false;
  }
}

async function findThirdPartyNoticesFilePath(): Promise<string | null> {
  const candidates = [
    path.join(process.resourcesPath, 'LICENSES.chromium.html'),
    path.join(process.resourcesPath, '..', 'LICENSES.chromium.html'),
    path.join(path.dirname(process.execPath), 'LICENSES.chromium.html'),
    path.join(path.dirname(process.execPath), '..', 'LICENSES.chromium.html')
  ];
  for (const candidate of candidates) {
    if (await pathExists(candidate)) return candidate;
  }
  return null;
}

export function setupMainIpc(ctx: MainIpcContext): void {
  const settingsStore = ctx.settingsStore;
  const historyStore = ctx.historyStore;
  const usageStore = ctx.usageStore;
  const statsStore = ctx.statsStore;
  const releaseWatchStore = ctx.releaseWatchStore;

  // user-note: Some environments show recording indicators (tray/overlay/memo pad) slightly after the recording actually
  // starts. Delay the "recording" UI state a bit so users don't start speaking before the UI says it's recording.
  const RECORDING_UI_START_DELAY_MS = 100;
  let recordingUiStartTimer: NodeJS.Timeout | null = null;

  function cancelRecordingUiStartTimer(): void {
    if (!recordingUiStartTimer) return;
    clearTimeout(recordingUiStartTimer);
    recordingUiStartTimer = null;
  }

  function applyRecordingUiState(state: RecordingState, message?: string): void {
    ctx.setTrayState(state);
    ctx.setOverlayState(state);
    ctx.broadcastRecordingState(state, message);
  }

  ipcMain.handle('settings:get', () => {
    const s = settingsStore.get();
    return {
      uiLanguage: s.uiLanguage,
      themeMode: s.themeMode,
      accentColor: s.accentColor,
      overlayPlacement: s.overlayPlacement,
      overlayOffsetX: s.overlayOffsetX,
      overlayOffsetY: s.overlayOffsetY,
      language: s.language,
      model: s.model,
      hotkey: s.hotkey,
      trayLeftClickAction: s.trayLeftClickAction,
      apiTimeoutSeconds: s.apiTimeoutSeconds,
      recordingMaxSeconds: s.recordingMaxSeconds,
      keyboardCharsPerMinute: s.keyboardCharsPerMinute,
      silenceProcessingMode: s.silenceProcessingMode,
      silenceAutoStopSeconds: s.silenceAutoStopSeconds,
      micDeviceId: s.micDeviceId,
      micWarmGraceSeconds: s.micWarmGraceSeconds,
      updateCheckEnabled: s.updateCheckEnabled,
      softStartOpenMemoPad: s.softStartOpenMemoPad,
      softStartOpenHistory: s.softStartOpenHistory,
      autoPaste: s.autoPaste,
      memoPadAutoMemo: s.memoPadAutoMemo,
      memoPadPersistText: s.memoPadPersistText,
      memoPadInsertAtCursor: s.memoPadInsertAtCursor,
      memoPadAlwaysOnTop: s.memoPadAlwaysOnTop,
      memoPadEditorFontSizePx: s.memoPadEditorFontSizePx,
      memoPadUndoMaxSteps: s.memoPadUndoMaxSteps,
      memoPadVisibleButtons: s.memoPadVisibleButtons,
      translationEnabled: s.translationEnabled,
      translationTarget: s.translationTarget,
      historyMaxItems: s.historyMaxItems,
      historyAlwaysOnTop: s.historyAlwaysOnTop,
      dictionaryEnabled: s.dictionaryEnabled,
      dictionaryRulesText: s.dictionaryRulesText,
      hasApiKey: settingsStore.hasApiKey(),
      secureStorageAvailable: settingsStore.isSecureStorageAvailable(),
      apiKeyStorage: settingsStore.getApiKeyStorage()
    };
  });

  ipcMain.handle('app:openPreferences', async () => {
    try {
      await ctx.openAppUiWindow('preferences');
      return { ok: true };
    } catch (error) {
      return { ok: false, errorCode: 'unknown', error: String(error) };
    }
  });

  ipcMain.handle('app:getAbout', async () => {
    await releaseWatchStore.ensureLoaded();
    const snapshot = releaseWatchStore.getSnapshot();
    const versions = process.versions;
    const electron = typeof versions.electron === 'string' ? versions.electron.trim() : '';
    const appVersionRaw = app.getVersion();
    const appVersionNormalized = typeof appVersionRaw === 'string' ? appVersionRaw.trim() : '';
    const appVersion =
      !appVersionNormalized || appVersionNormalized === '0.0.0' || (electron && appVersionNormalized === electron)
        ? ''
        : appVersionNormalized;
    return {
      ok: true,
      info: {
        appVersion,
        electron,
        chromium: typeof versions.chrome === 'string' ? versions.chrome.trim() : '',
        node: typeof versions.node === 'string' ? versions.node.trim() : '',
        v8: typeof versions.v8 === 'string' ? versions.v8.trim() : '',
        os: `${os.type()} ${process.arch} ${os.release()}`,
        copyright: ctx.about.copyright,
        githubUrl: ctx.about.githubUrl,
        websiteUrl: ctx.about.websiteUrl,
        privacyPolicyUrl: ctx.about.privacyPolicyUrl,
        lastUpdateCheckAt: snapshot.lastCheckedAt
      }
    };
  });

  ipcMain.handle('app:checkForUpdates', async () => {
    const parsed = parseGitHubOwnerRepoFromUrl(ctx.about.githubUrl);
    if (!parsed) return { ok: false, errorCode: 'unknown' };

    const now = Date.now();
    try {
      const latest = await fetchLatestGitHubRelease(parsed.owner, parsed.repo);
      if (!latest) return { ok: false, errorCode: 'unknown' };

      const currentVersionRaw = app.getVersion();
      const currentVersion = typeof currentVersionRaw === 'string' ? currentVersionRaw.trim() : '';
      const cmp = compareSemverStrings(latest.version, currentVersion);
      if (cmp === null) {
        return {
          ok: true,
          status: 'cannotCompare',
          currentVersion,
          latestVersion: latest.version,
          latestUrl: latest.htmlUrl
        };
      }
      return {
        ok: true,
        status: cmp > 0 ? 'updateAvailable' : 'upToDate',
        currentVersion,
        latestVersion: latest.version,
        latestUrl: latest.htmlUrl
      };
    } catch (error) {
      return { ok: false, errorCode: 'unknown', error: String(error) };
    } finally {
      await releaseWatchStore.setLastCheckedAt(now);
    }
  });

  ipcMain.handle('app:openExternal', async (_evt, url: unknown) => {
    const raw = typeof url === 'string' ? url.trim() : '';
    if (!raw) return { ok: false, errorCode: 'invalidPayload', error: 'url is empty' };
    if (!isAllowedExternalUrl(raw)) return { ok: false, errorCode: 'invalidPayload', error: 'url is not allowed' };
    try {
      await shell.openExternal(raw);
      return { ok: true };
    } catch (error) {
      return { ok: false, errorCode: 'unknown', error: String(error) };
    }
  });

  ipcMain.handle('app:openThirdPartyNotices', async () => {
    try {
      const filePath = await findThirdPartyNoticesFilePath();
      if (filePath) {
        const result = await shell.openPath(filePath);
        if (result) {
          return { ok: false, errorCode: 'unknown', error: result };
        }
        return { ok: true };
      }
      await shell.openExternal(ctx.about.githubUrl);
      return { ok: true };
    } catch (error) {
      return { ok: false, errorCode: 'unknown', error: String(error) };
    }
  });

  ipcMain.handle('tray:popupMenu', (event, position: unknown) => {
    const window = BrowserWindow.fromWebContents(event.sender);
    if (!window) return { ok: false, errorCode: 'window.notFound' };
    const memoWindow = ctx.getMemoWindow();
    if (!memoWindow || window.id !== memoWindow.id) return { ok: false, errorCode: 'memo.notAvailable' };

    let x: number | undefined;
    let y: number | undefined;

    if (position && typeof position === 'object') {
      const obj = position as Record<string, unknown>;
      if (typeof obj.x === 'number' && Number.isFinite(obj.x)) x = Math.floor(obj.x);
      if (typeof obj.y === 'number' && Number.isFinite(obj.y)) y = Math.floor(obj.y);
    }

    try {
      ctx.popupTrayMenuInWindow(window, x, y);
      return { ok: true };
    } catch (error) {
      return { ok: false, errorCode: 'unknown', error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.on('recording:state', (_event, state: unknown, message: unknown) => {
    if (state !== 'idle' && state !== 'recording' && state !== 'transcribing' && state !== 'error') {
      return;
    }
    const prevRecordingState = ctx.getRecordingState();
    ctx.setRecordingState(state);
    if (state === 'recording') {
      ctx.setLastRecordingStartAt(Date.now());
    }
    let nextErrorMessage: string | null = null;
    if (state === 'error' && typeof message === 'string') {
      const trimmed = message.trim();
      nextErrorMessage = trimmed ? trimmed.slice(0, 200) : null;
    }
    ctx.setLastRecordingErrorMessage(nextErrorMessage);
    if (state !== 'recording') {
      ctx.setLastRecordingLevel(0);
      ctx.broadcastRecordingLevel(0);
      ctx.clearGlobalHotkeyPttSession();
    }
    ctx.restoreRecordingStartFocusIfNeeded(state);
    cancelRecordingUiStartTimer();
    const uiMessage = state === 'error' ? nextErrorMessage ?? undefined : undefined;
    if (state === 'recording' && prevRecordingState !== 'recording') {
      recordingUiStartTimer = setTimeout(() => {
        recordingUiStartTimer = null;
        applyRecordingUiState('recording');
      }, RECORDING_UI_START_DELAY_MS);
    } else {
      applyRecordingUiState(state, uiMessage);
    }
    ctx.setCancelHotkeyEnabled(state === 'recording' || state === 'transcribing');
    if (state !== 'recording') {
      ctx.scheduleAutoPasteFlush(0);
    }
  });

  ipcMain.on('recording:level', (_event, level: unknown) => {
    if (typeof level !== 'number' || !Number.isFinite(level)) return;
    const next = Math.max(0, Math.min(1, level));
    ctx.setLastRecordingLevel(next);
    ctx.broadcastRecordingLevel(next);
  });

  ipcMain.on('mic:devices', (_event, devices: unknown) => {
    ctx.setAudioInputDevices(normalizeAudioInputDevices(ctx, devices));
    ctx.updateTrayMenu();
  });

  ipcMain.on('mic:systemDefault', (_event, label: unknown) => {
    ctx.setSystemDefaultMicrophoneLabel(typeof label === 'string' ? ctx.normalizeMicLabel(label) : null);
    ctx.updateTrayMenu();
  });

  ipcMain.on('mic:active', () => {
    ctx.updateTrayMenu();
  });

  ipcMain.on('transcribe:cancel', () => {
    ctx.cancelPendingTranscriptions();
  });

  ipcMain.handle('permissions:get', () => {
    return {
      platform: process.platform,
      accessibilityTrusted: ctx.isAccessibilityTrusted()
    };
  });

  ipcMain.handle('permissions:requestAccessibility', () => {
    if (process.platform !== 'darwin') {
      return { ok: false, errorCode: 'notSupported' };
    }
    try {
      const trusted = systemPreferences.isTrustedAccessibilityClient(true);
      return { ok: true, trusted };
    } catch (error) {
      return { ok: false, errorCode: 'unknown', error: error instanceof Error ? error.message : String(error) };
    }
  });

  ipcMain.handle('permissions:openAccessibility', async () => {
    if (process.platform !== 'darwin') {
      return { ok: false, errorCode: 'notSupported' };
    }
    try {
      await shell.openExternal('x-apple.systempreferences:com.apple.preference.security?Privacy_Accessibility');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : t('en', 'detail.permissions.openAccessibilityFailed'),
        errorCode: 'unknown'
      };
    }
  });

  ipcMain.handle('settings:setThemeMode', async (_evt, mode: unknown) => {
    if (typeof mode !== 'string') {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    const normalized = mode.trim();
    if (normalized !== 'system' && normalized !== 'light' && normalized !== 'dark') {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    const next = normalized as ThemeMode;
    await settingsStore.setThemeMode(next);
    ctx.applyThemeMode(next);
    return { ok: true };
  });

  ipcMain.handle('settings:setAccentColor', async (_evt, color: unknown) => {
    if (color === null) {
      await settingsStore.setAccentColor(null);
      ctx.broadcastAccentColorChanged();
      return { ok: true };
    }
    if (typeof color !== 'string') {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    const trimmed = color.trim();
    if (!trimmed) {
      await settingsStore.setAccentColor(null);
      ctx.broadcastAccentColorChanged();
      return { ok: true };
    }
    const normalized = trimmed.toLowerCase();
    if (!/^#[0-9a-f]{6}$/.test(normalized)) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    await settingsStore.setAccentColor(normalized);
    ctx.broadcastAccentColorChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:setOverlayPlacement', async (_evt, placement: unknown) => {
    if (
      placement !== 'cursor' &&
      placement !== 'bottomRight' &&
      placement !== 'bottomLeft' &&
      placement !== 'bottomCenter' &&
      placement !== 'topRight' &&
      placement !== 'topLeft' &&
      placement !== 'none'
    ) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    await settingsStore.setOverlayPlacement(placement as OverlayPlacement);
    ctx.setOverlayState(ctx.getRecordingState());
    return { ok: true };
  });

  ipcMain.handle('settings:setOverlayOffsetX', async (_evt, offsetX: unknown) => {
    if (typeof offsetX !== 'number' || !Number.isFinite(offsetX)) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    await settingsStore.setOverlayOffsetX(offsetX);
    return { ok: true };
  });

  ipcMain.handle('settings:setOverlayOffsetY', async (_evt, offsetY: unknown) => {
    if (typeof offsetY !== 'number' || !Number.isFinite(offsetY)) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    await settingsStore.setOverlayOffsetY(offsetY);
    return { ok: true };
  });

  ipcMain.handle('settings:setApiKey', async (_evt, apiKey: string) => {
    if (typeof apiKey !== 'string' || apiKey.trim().length === 0) {
      await settingsStore.clearApiKey();
      return { ok: true };
    }
    if (!isPlausibleOpenAIKey(apiKey)) {
      return { ok: false, errorCode: 'settings.invalidApiKeyFormat' };
    }
    if (!settingsStore.isSecureStorageAvailable()) {
      return { ok: false, errorCode: 'settings.secureStorageUnavailable' };
    }
    try {
      await settingsStore.setApiKey(apiKey);
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : '',
        errorCode: 'settings.secureStorageUnavailable'
      };
    }
  });

  ipcMain.handle('settings:setUiLanguage', async (_evt, language: unknown) => {
    if (!isUiLanguage(language)) {
      return { ok: false, errorCode: 'settings.invalidUiLanguage' };
    }
    await settingsStore.setUiLanguage(language);
    ctx.broadcastUiLanguageChanged();
    ctx.setTrayState(ctx.getRecordingState());
    return { ok: true };
  });

  ipcMain.handle('settings:setLanguage', async (_evt, language: unknown) => {
    const normalized = normalizeTranscriptionLanguage(language);
    if (!normalized) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    await settingsStore.setLanguage(normalized);
    return { ok: true };
  });

  ipcMain.handle('settings:setModel', async (_evt, model: TranscriptionModel) => {
    await settingsStore.setModel(model);
    return { ok: true };
  });

  ipcMain.handle('settings:setHistoryMaxItems', async (_evt, maxItems: number) => {
    await settingsStore.setHistoryMaxItems(maxItems);
    await historyStore.load();
    ctx.getHistoryWindow()?.webContents.send('history:updated');
    return { ok: true };
  });

  ipcMain.handle('settings:setHistoryAlwaysOnTop', async (_evt, enabled: boolean) => {
    const next = Boolean(enabled);
    await settingsStore.setHistoryAlwaysOnTop(next);
    ctx.getHistoryWindow()?.setAlwaysOnTop(next);
    return { ok: true };
  });

  ipcMain.handle('settings:setDictionaryEnabled', async (_evt, enabled: boolean) => {
    await settingsStore.setDictionaryEnabled(Boolean(enabled));
    return { ok: true };
  });

  ipcMain.handle('settings:setDictionaryRulesText', async (_evt, rulesText: string) => {
    const { errors, rules } = parseDictionaryRules(String(rulesText ?? ''));
    if (errors.length > 0) {
      return { ok: false, error: errors[0], errors, errorCode: 'dictionary.invalidRules' };
    }
    const validation = validateDictionaryRules(rules);
    if (!validation.ok) {
      return {
        ok: false,
        error: validation.errors[0] ?? t('en', 'detail.transfer.invalidDictionaryRules'),
        errors: validation.errors,
        errorCode: 'dictionary.invalidRules'
      };
    }
    await settingsStore.setDictionaryRulesText(String(rulesText ?? ''));
    return { ok: true, ruleCount: rules.length };
  });

  ipcMain.handle('settings:setHotkey', async (_evt, hotkey: string) => {
    const normalized = normalizeAccelerator(hotkey);
    if (!normalized) return { ok: false, errorCode: 'hotkey.empty' };
    if (!isUserConfigurableHotkeyAccelerator(normalized)) return { ok: false, errorCode: 'hotkey.invalid' };
    if (isHotkeyConflictingWithFixedShortcuts(normalized)) return { ok: false, errorCode: 'hotkey.conflict' };

    const result = ctx.tryRegisterHotkey(normalized);
    if (!result.ok) return { ok: false, error: result.error, errorCode: result.errorCode ?? 'hotkey.invalid' };
    await settingsStore.setHotkey(normalized);
    ctx.updateTrayMenu();
    return { ok: true };
  });

  ipcMain.handle('settings:setTrayLeftClickAction', async (_evt, action: unknown) => {
    if (
      action !== 'toggleRecording' &&
      action !== 'showMenu' &&
      action !== 'openMemoPad' &&
      action !== 'openHistory' &&
      action !== 'openPreferences' &&
      action !== 'none'
    ) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    await settingsStore.setTrayLeftClickAction(action);
    return { ok: true };
  });

  ipcMain.handle('settings:setApiTimeoutSeconds', async (_evt, seconds: number) => {
    await settingsStore.setApiTimeoutSeconds(Number(seconds));
    return { ok: true };
  });

  ipcMain.handle('settings:setRecordingMaxSeconds', async (_evt, maxSeconds: number) => {
    await settingsStore.setRecordingMaxSeconds(maxSeconds);
    return { ok: true };
  });

  ipcMain.handle('settings:setKeyboardCharsPerMinute', async (_evt, charsPerMinute: number) => {
    await settingsStore.setKeyboardCharsPerMinute(charsPerMinute);
    return { ok: true };
  });

  ipcMain.handle('settings:setSilenceProcessingMode', async (_evt, mode: SilenceProcessingMode) => {
    await settingsStore.setSilenceProcessingMode(mode);
    return { ok: true };
  });

  ipcMain.handle('settings:setSilenceAutoStopSeconds', async (_evt, seconds: number) => {
    await settingsStore.setSilenceAutoStopSeconds(seconds);
    return { ok: true };
  });

  ipcMain.handle('settings:setMicDeviceId', async (_evt, deviceId: unknown) => {
    const normalized = typeof deviceId === 'string' ? deviceId : null;
    await settingsStore.setMicDeviceId(normalized);
    ctx.updateTrayMenu();
    return { ok: true };
  });

  ipcMain.handle('settings:setMicWarmGraceSeconds', async (_evt, seconds: number) => {
    await settingsStore.setMicWarmGraceSeconds(seconds);
    return { ok: true };
  });

  ipcMain.handle('settings:setUpdateCheckEnabled', async (_evt, enabled: boolean) => {
    await settingsStore.setUpdateCheckEnabled(Boolean(enabled));
    ctx.syncUpdateCheckLoopEnabled();
    return { ok: true };
  });

  ipcMain.handle('settings:setSoftStartOpenMemoPad', async (_evt, enabled: boolean) => {
    await settingsStore.setSoftStartOpenMemoPad(Boolean(enabled));
    return { ok: true };
  });

  ipcMain.handle('settings:setSoftStartOpenHistory', async (_evt, enabled: boolean) => {
    await settingsStore.setSoftStartOpenHistory(Boolean(enabled));
    return { ok: true };
  });

  ipcMain.handle('settings:setAutoPaste', async (_evt, enabled: boolean) => {
    await settingsStore.setAutoPaste(Boolean(enabled));
    ctx.updateTrayMenu();
    ctx.broadcastSettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:setMemoPadAutoMemo', async (_evt, enabled: boolean) => {
    await settingsStore.setMemoPadAutoMemo(Boolean(enabled));
    ctx.updateTrayMenu();
    ctx.broadcastSettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:setMemoPadPersistText', async (_evt, enabled: boolean) => {
    const next = Boolean(enabled);
    await settingsStore.setMemoPadPersistText(next);
    if (next) {
      ctx.getMemoWindow()?.webContents.send('memo:requestText');
    }
    return { ok: true };
  });

  ipcMain.handle('settings:setMemoPadInsertAtCursor', async (_evt, enabled: boolean) => {
    await settingsStore.setMemoPadInsertAtCursor(Boolean(enabled));
    ctx.updateTrayMenu();
    ctx.broadcastSettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:setMemoPadAlwaysOnTop', async (_evt, enabled: boolean) => {
    const next = Boolean(enabled);
    await settingsStore.setMemoPadAlwaysOnTop(next);
    const memoWindow = ctx.getMemoWindow();
    memoWindow?.setAlwaysOnTop(next);
    if (process.platform === 'darwin') {
      memoWindow?.setFullScreenable(!next);
    }
    return { ok: true };
  });

  ipcMain.handle('settings:setMemoPadEditorFontSizePx', async (_evt, fontSizePx: unknown) => {
    if (typeof fontSizePx !== 'number' || !Number.isFinite(fontSizePx)) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    await settingsStore.setMemoPadEditorFontSizePx(fontSizePx);
    ctx.broadcastSettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:setMemoPadUndoMaxSteps', async (_evt, maxSteps: number) => {
    await settingsStore.setMemoPadUndoMaxSteps(maxSteps);
    ctx.broadcastSettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:setMemoPadVisibleButtons', async (_evt, buttons: unknown) => {
    if (!Array.isArray(buttons)) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    const next: MemoPadButtonId[] = [];
    for (const item of buttons) {
      if (!MEMO_PAD_BUTTON_ID_SET.has(item as MemoPadButtonId)) continue;
      const id = item as MemoPadButtonId;
      if (next.includes(id)) continue;
      next.push(id);
    }
    await settingsStore.setMemoPadVisibleButtons(next);
    ctx.broadcastMemoButtonLayout();
    return { ok: true };
  });

  ipcMain.handle('memo:setText', async (_evt, text: unknown) => {
    if (!settingsStore.get().memoPadPersistText) {
      return { ok: true };
    }
    await settingsStore.setMemoPadText(typeof text === 'string' ? text : '');
    return { ok: true };
  });

  ipcMain.handle('memo:replaceSelection', (_evt, payload: unknown) => {
    const memoWindow = ctx.getMemoWindow();
    if (!memoWindow || memoWindow.isDestroyed()) {
      return { ok: false, errorCode: 'memo.notAvailable' };
    }
    if (!payload || typeof payload !== 'object') {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    const obj = payload as Record<string, unknown>;
    const replacementText = typeof obj.replacementText === 'string' ? obj.replacementText : null;
    if (replacementText === null) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    memoWindow.webContents.send('memo:replaceSelection', { replacementText });
    return { ok: true };
  });

  ipcMain.handle('settings:setTranslationEnabled', async (_evt, enabled: boolean) => {
    await settingsStore.setTranslationEnabled(Boolean(enabled));
    ctx.broadcastSettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('settings:setTranslationTarget', async (_evt, target: unknown) => {
    const normalized = normalizeTranscriptionLanguage(target);
    if (!normalized) {
      return { ok: false, errorCode: 'invalidPayload' };
    }
    await settingsStore.setTranslationTarget(normalized);
    ctx.broadcastSettingsChanged();
    return { ok: true };
  });

  ipcMain.handle('recording:toggle', (event) => {
    if (ctx.getRecordingState() !== 'recording') {
      ctx.rememberRecordingStartFocus(event);
    }
    ctx.sendRecordingToggle();
    return { ok: true };
  });

  ipcMain.handle('recording:start', (event) => {
    if (ctx.getRecordingState() !== 'recording') {
      ctx.rememberRecordingStartFocus(event);
    }
    ctx.sendRecordingStart();
    return { ok: true };
  });

  ipcMain.handle('recording:stop', () => {
    ctx.sendRecordingStop();
    return { ok: true };
  });

  ipcMain.handle('recording:cancel', () => {
    ctx.sendRecordingCancel();
    return { ok: true };
  });

  ipcMain.handle('translation:manual', async (_evt, inputText: unknown) => {
    const apiKey = settingsStore.getApiKey() ?? process.env.OPENAI_API_KEY ?? null;
    if (!apiKey) {
      return { ok: false, errorCode: 'apiKey.notSet' };
    }

    const normalized = typeof inputText === 'string' ? inputText : '';
    if (!normalized.trim()) return { ok: true, text: '' };

    const { translationTarget } = settingsStore.get();

    const timeoutMs = ctx.getApiTimeoutMsForText(normalized);

    try {
      const text = await translateWithOpenAIAutoDetectSource({
        apiKey,
        inputText: normalized,
        targetLanguage: translationTarget,
        timeoutMs
      });
      return { ok: true, text };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : t('en', 'detail.translation.failed'),
        errorCode: 'translation.failed'
      };
    }
  });

  ipcMain.handle('transcribe', async (_evt, payload: TranscribePayload) => {
    return await ctx.enqueueTranscribe(payload);
  });

  ipcMain.handle('history:list', () => {
    return { ok: true, entries: historyStore.list() };
  });

  ipcMain.handle('history:clear', async () => {
    await historyStore.clear();
    ctx.getHistoryWindow()?.webContents.send('history:updated');
    return { ok: true };
  });

  ipcMain.handle('history:delete', async (_evt, id: unknown) => {
    const normalized = typeof id === 'string' ? id.trim() : '';
    if (!normalized) return { ok: false, errorCode: 'invalidPayload' };

    try {
      await historyStore.remove(normalized);
      ctx.getHistoryWindow()?.webContents.send('history:updated');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : t('en', 'history.error.failedToDelete'),
        errorCode: 'history.failedToDelete'
      };
    }
  });

  ipcMain.handle('history:openWindow', async () => {
    try {
      await ctx.openAppUiWindow('history');
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : t('en', 'detail.history.openWindowFailed'),
        errorCode: 'history.openFailed'
      };
    }
  });

  ipcMain.handle('usage:get', () => {
    const snapshot = usageStore.getSnapshot();
    return { ok: true, ...snapshot };
  });

  ipcMain.handle('usage:clear', async () => {
    await usageStore.clear();
    return { ok: true };
  });

  ipcMain.handle('stats:get', () => {
    const snapshot = statsStore.getSnapshot();
    return { ok: true, ...snapshot };
  });

  ipcMain.handle('stats:clear', async () => {
    await statsStore.clear();
    return { ok: true };
  });

  ipcMain.handle('appData:export', async (event, rawSections: unknown, rawOptions: unknown) => {
    const sections = normalizeAppDataSections(rawSections);
    const hasAny =
      sections.appSettings || sections.dictionary || sections.history || sections.stats || sections.usage;
    if (!hasAny) {
      return { ok: false, errorCode: 'transfer.nothingSelected' };
    }

    const options = normalizeAppDataExportOptions(rawOptions);
    const uiLanguage = settingsStore.get().uiLanguage;
    const win = BrowserWindow.fromWebContents(event.sender);
    const defaultPath = path.join(app.getPath('documents'), formatAppDataExportFilename());
    const saveDialogOptions: Electron.SaveDialogOptions = {
      title: t(uiLanguage, 'common.export'),
      defaultPath,
      filters: [{ name: 'Blitzmemo', extensions: [APP_DATA_EXPORT_EXTENSION] }]
    };
    const result = win ? await dialog.showSaveDialog(win, saveDialogOptions) : await dialog.showSaveDialog(saveDialogOptions);
    if (result.canceled || !result.filePath) {
      return { ok: false, canceled: true, errorCode: 'canceled' };
    }

    try {
      const file = buildAppDataExportFile(ctx, sections);
      const bytes = await buildAppDataExportBytes(file, options.password);
      await fs.writeFile(result.filePath, bytes);
      return { ok: true, filePath: result.filePath };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : t('en', 'detail.transfer.failedToExport'),
        errorCode: 'transfer.failedToExport'
      };
    }
  });

  ipcMain.handle('appData:import', async (event, rawSections: unknown, rawOptions: unknown) => {
    const sections = normalizeAppDataSections(rawSections);
    const hasAny =
      sections.appSettings || sections.dictionary || sections.history || sections.stats || sections.usage;
    if (!hasAny) {
      return { ok: false, errorCode: 'transfer.nothingSelected' };
    }

    const options = normalizeAppDataImportOptions(rawOptions);
    const uiLanguage = settingsStore.get().uiLanguage;
    const win = BrowserWindow.fromWebContents(event.sender);
    const resolvedFilePath = options.filePath ?? '';
    let filePath = resolvedFilePath;
    if (!filePath) {
      const openDialogOptions: Electron.OpenDialogOptions = {
        title: t(uiLanguage, 'common.import'),
        properties: ['openFile'],
        filters: [{ name: 'Blitzmemo', extensions: [APP_DATA_EXPORT_EXTENSION] }]
      };
      const openResult = win ? await dialog.showOpenDialog(win, openDialogOptions) : await dialog.showOpenDialog(openDialogOptions);
      if (openResult.canceled || openResult.filePaths.length === 0) {
        return { ok: false, canceled: true, errorCode: 'canceled' };
      }

      filePath = openResult.filePaths[0] ?? '';
      if (!filePath) {
        return { ok: false, errorCode: 'transfer.filePathEmpty' };
      }
    }

    let bytes: Buffer;
    try {
      bytes = await fs.readFile(filePath);
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : t('en', 'detail.transfer.failedToReadFile'),
        filePath,
        errorCode: 'transfer.failedToImport'
      };
    }

    const decoded = await decodeAppDataExportBytes(bytes, options.password);
    if (!decoded.ok) {
      return { ok: false, error: decoded.error, errorCode: decoded.errorCode, filePath };
    }

    const data = decoded.file.data;
    const dataRecord = asRecord(data) ?? {};
    const settingsRecord = asRecord(dataRecord.settings);

    const imported = {
      appSettings: false,
      dictionary: false,
      historyEntries: 0,
      statsEntries: 0,
      usageModels: 0
    };

    const dictionarySection = settingsRecord ? asRecord(settingsRecord.dictionary) : null;
    if (sections.dictionary && dictionarySection) {
      const rulesText = typeof dictionarySection.dictionaryRulesText === 'string' ? dictionarySection.dictionaryRulesText : '';
      const { errors, rules } = parseDictionaryRules(rulesText);
      if (errors.length > 0) {
        return {
          ok: false,
          error: errors[0] ?? t('en', 'detail.transfer.invalidDictionaryRules'),
          errorCode: 'transfer.failedToImport'
        };
      }
      const validation = validateDictionaryRules(rules);
      if (!validation.ok) {
        return {
          ok: false,
          error: validation.errors[0] ?? t('en', 'detail.transfer.invalidDictionaryRules'),
          errorCode: 'transfer.failedToImport'
        };
      }
    }

    let historyEntries: HistoryEntry[] | null = null;
    if (sections.history) {
      const historyRecord = asRecord(dataRecord.history);
      if (historyRecord) {
        historyEntries = normalizeHistoryEntries(historyRecord.entries);
        if (historyEntries === null) {
          return { ok: false, error: t('en', 'detail.transfer.invalidHistoryEntries'), errorCode: 'transfer.failedToImport' };
        }
      }
    }

    let statsEntries: StatsEntry[] | null = null;
    let statsSinceAt: number | undefined;
    if (sections.stats) {
      const statsRecord = asRecord(dataRecord.stats);
      if (statsRecord) {
        statsEntries = normalizeStatsEntries(statsRecord.entries);
        if (statsEntries === null) {
          return { ok: false, error: t('en', 'detail.transfer.invalidStatsEntries'), errorCode: 'transfer.failedToImport' };
        }
        if (isNonNegativeNumber(statsRecord.sinceAt)) {
          statsSinceAt = statsRecord.sinceAt;
        }
      }
    }

    let usageAudioSecondsByModel: Record<string, number> | null = null;
    let usageSinceAt: number | undefined;
    if (sections.usage) {
      const usageRecord = asRecord(dataRecord.usage);
      if (usageRecord) {
        usageAudioSecondsByModel = normalizeAudioSecondsByModel(usageRecord.audioSecondsByModel);
        if (usageAudioSecondsByModel === null) {
          return { ok: false, error: t('en', 'detail.transfer.invalidUsagePayload'), errorCode: 'transfer.failedToImport' };
        }
        if (isNonNegativeNumber(usageRecord.sinceAt)) {
          usageSinceAt = usageRecord.sinceAt;
        }
      }
    }

    if (sections.appSettings && settingsRecord) {
      const appSection = asRecord(settingsRecord.app);
      if (appSection) {
        const patch = appSection as Partial<AppSettings>;
        await applyImportedSettingsPatch(ctx, patch);
        imported.appSettings = true;
      }
    }

    if (sections.dictionary && dictionarySection) {
      if (typeof dictionarySection.dictionaryEnabled === 'boolean') {
        await settingsStore.setDictionaryEnabled(dictionarySection.dictionaryEnabled);
      }
      if (typeof dictionarySection.dictionaryRulesText === 'string') {
        await settingsStore.setDictionaryRulesText(dictionarySection.dictionaryRulesText);
      }
      imported.dictionary = true;
    }

    if (sections.history && settingsRecord) {
      const historySettings = asRecord(settingsRecord.history);
      if (historySettings) {
        if (typeof historySettings.historyMaxItems === 'number' && Number.isFinite(historySettings.historyMaxItems)) {
          await settingsStore.setHistoryMaxItems(historySettings.historyMaxItems);
        }
        if (typeof historySettings.historyAlwaysOnTop === 'boolean') {
          const next = historySettings.historyAlwaysOnTop;
          await settingsStore.setHistoryAlwaysOnTop(next);
          ctx.getHistoryWindow()?.setAlwaysOnTop(next);
        }
      }
    }

    if (sections.stats && settingsRecord) {
      const statsSettings = asRecord(settingsRecord.stats);
      if (statsSettings) {
        if (
          typeof statsSettings.keyboardCharsPerMinute === 'number' &&
          Number.isFinite(statsSettings.keyboardCharsPerMinute)
        ) {
          await settingsStore.setKeyboardCharsPerMinute(statsSettings.keyboardCharsPerMinute);
        }
      }
    }

    const userDataDir = app.getPath('userData');
    if (sections.history && historyEntries !== null) {
      await writeJsonFile(path.join(userDataDir, 'history.json'), { version: 1, entries: historyEntries });
      await historyStore.load();
      ctx.getHistoryWindow()?.webContents.send('history:updated');
      imported.historyEntries = historyEntries.length;
    }

    if (sections.stats && statsEntries !== null) {
      await writeJsonFile(path.join(userDataDir, 'stats.json'), {
        version: 1,
        entries: statsEntries,
        ...(typeof statsSinceAt === 'number' ? { sinceAt: statsSinceAt } : {})
      });
      await statsStore.load();
      imported.statsEntries = statsEntries.length;
    }

    if (sections.usage && usageAudioSecondsByModel !== null) {
      await writeJsonFile(path.join(userDataDir, 'usage.json'), {
        version: 1,
        audioSecondsByModel: usageAudioSecondsByModel,
        ...(typeof usageSinceAt === 'number' ? { sinceAt: usageSinceAt } : {})
      });
      await usageStore.load();
      imported.usageModels = Object.keys(usageAudioSecondsByModel).length;
    }

    ctx.updateTrayMenu();
    return { ok: true, imported };
  });
}
