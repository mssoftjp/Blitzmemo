import { app, safeStorage } from 'electron';
import path from 'node:path';
import { readJsonFile, writeJsonFile } from './persistence';
import {
  AppSettings,
  MEMO_PAD_BUTTON_ORDER,
  MemoPadButtonId,
  OverlayPlacement,
  SilenceProcessingMode,
  TranscriptionLanguage,
  ThemeMode,
  TrayLeftClickAction,
  TranscriptionModel,
  UiLanguage,
  WindowBounds
} from '../shared/types';
import { normalizeOverlayOffsetFromSettings } from '../shared/overlayOffset';
import {
  DEFAULT_HISTORY_MAX_ITEMS,
  DEFAULT_KEYBOARD_CHARS_PER_MINUTE,
  DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX,
  DEFAULT_RECORDING_MAX_SECONDS,
  DEFAULT_SILENCE_AUTO_STOP_SECONDS,
  MAX_HISTORY_MAX_ITEMS,
  MAX_KEYBOARD_CHARS_PER_MINUTE,
  MAX_MEMO_PAD_EDITOR_FONT_SIZE_PX,
  MAX_RECORDING_MAX_SECONDS,
  MAX_SILENCE_AUTO_STOP_SECONDS,
  MIN_HISTORY_MAX_ITEMS,
  MIN_MEMO_PAD_EDITOR_FONT_SIZE_PX,
  MIN_RECORDING_MAX_SECONDS,
  normalizeHistoryMaxItemsFromSettings,
  normalizeKeyboardCharsPerMinuteFromSettings,
  normalizeMemoPadEditorFontSizePxFromSettings,
  normalizeRecordingMaxSecondsFromSettings,
  normalizeSilenceAutoStopSecondsFromSettings
} from '../shared/settingsConstraints';
import { isHotkeyConflictingWithFixedShortcuts, isUserConfigurableHotkeyAccelerator, normalizeAccelerator } from '../shared/hotkey';
import { isTranscriptionLanguage, isTranscriptionModel, isUiLanguage } from '../shared/typeGuards';

const SETTINGS_FILENAME = 'settings.json';
const MAX_MIC_WARM_GRACE_SECONDS = 300;
const MAX_MEMO_PAD_UNDO_MAX_STEPS = 5000;
const MIN_API_TIMEOUT_SECONDS = 10;
const MAX_API_TIMEOUT_SECONDS = 600;

type LocaleParts = { language: string; script: string | null; region: string | null };

function parseLocaleTag(value: string): LocaleParts | null {
  const trimmed = value.trim();
  if (!trimmed) return null;
  const parts = trimmed.replaceAll('_', '-').split('-').filter(Boolean);
  const language = (parts[0] ?? '').toLowerCase();
  if (!language) return null;

  let script: string | null = null;
  let region: string | null = null;
  for (const part of parts.slice(1)) {
    if (!script && /^[A-Za-z]{4}$/.test(part)) {
      script = part.toLowerCase();
      continue;
    }
    if (!region && (/^[A-Za-z]{2}$/.test(part) || /^[0-9]{3}$/.test(part))) {
      region = part.toLowerCase();
      continue;
    }
  }

  return { language, script, region };
}

function toChineseLocaleFromParts(parts: LocaleParts): 'zh-hans' | 'zh-hant' {
  const script = parts.script;
  if (script === 'hans') return 'zh-hans';
  if (script === 'hant') return 'zh-hant';

  const region = parts.region;
  if (region === 'tw' || region === 'hk' || region === 'mo') return 'zh-hant';
  return 'zh-hans';
}

function toTranscriptionLanguageFromLocaleTag(tag: string): TranscriptionLanguage | null {
  const parsed = parseLocaleTag(tag);
  if (!parsed) return null;
  if (parsed.language === 'zh') return toChineseLocaleFromParts(parsed);
  return isTranscriptionLanguage(parsed.language) ? parsed.language : null;
}

function toUiLanguageFromLocaleTag(tag: string): UiLanguage | null {
  const parsed = parseLocaleTag(tag);
  if (!parsed) return null;
  if (parsed.language === 'zh') return toChineseLocaleFromParts(parsed);
  return isUiLanguage(parsed.language) ? parsed.language : null;
}

function getSystemLocaleCandidates(): string[] {
  const out: string[] = [];
  try {
    const preferred = app.getPreferredSystemLanguages?.();
    if (Array.isArray(preferred)) {
      for (const item of preferred) {
        if (typeof item !== 'string') continue;
        const trimmed = item.trim();
        if (!trimmed) continue;
        out.push(trimmed);
      }
    }
  } catch {
    // ignore
  }
  try {
    const locale = app.getLocale?.();
    if (typeof locale === 'string') {
      const trimmed = locale.trim();
      if (trimmed) out.push(trimmed);
    }
  } catch {
    // ignore
  }
  try {
    const systemLocale = app.getSystemLocale?.();
    if (typeof systemLocale === 'string') {
      const trimmed = systemLocale.trim();
      if (trimmed) out.push(trimmed);
    }
  } catch {
    // ignore
  }

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const item of out) {
    if (seen.has(item)) continue;
    seen.add(item);
    unique.push(item);
  }
  return unique;
}

function detectDefaultLanguages(): { uiLanguage: UiLanguage; language: TranscriptionLanguage } {
  const candidates = getSystemLocaleCandidates();
  for (const locale of candidates) {
    const language = toTranscriptionLanguageFromLocaleTag(locale);
    const uiLanguage = toUiLanguageFromLocaleTag(locale);
    if (!language && !uiLanguage) continue;
    return { uiLanguage: uiLanguage ?? 'en', language: language ?? 'en' };
  }
  return { uiLanguage: 'en', language: 'en' };
}

const DEFAULT_SETTINGS: AppSettings = {
  uiLanguage: 'en',
  themeMode: 'system',
  accentColor: null,
  overlayPlacement: 'bottomCenter',
  overlayOffsetX: 0,
  overlayOffsetY: 0,
  language: 'en',
  model: 'gpt-4o-transcribe',
  hotkey: 'CommandOrControl+F12',
  trayLeftClickAction: 'showMenu',
  apiTimeoutSeconds: 60,
  recordingMaxSeconds: DEFAULT_RECORDING_MAX_SECONDS,
  keyboardCharsPerMinute: DEFAULT_KEYBOARD_CHARS_PER_MINUTE,
  silenceProcessingMode: 'none',
  silenceAutoStopSeconds: DEFAULT_SILENCE_AUTO_STOP_SECONDS,
  micDeviceId: null,
  micWarmGraceSeconds: 0,
  updateCheckEnabled: true,
  softStartOpenMemoPad: true,
  softStartOpenHistory: false,
  autoPaste: false,
  memoPadAutoMemo: true,
  memoPadPersistText: false,
  memoPadInsertAtCursor: false,
  memoPadAlwaysOnTop: false,
  memoPadEditorFontSizePx: DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX,
  memoPadUndoMaxSteps: 500,
  memoPadText: '',
  memoPadVisibleButtons: [...MEMO_PAD_BUTTON_ORDER],
  translationEnabled: false,
  translationTarget: 'en',
  historyMaxItems: DEFAULT_HISTORY_MAX_ITEMS,
  historyAlwaysOnTop: false,
  dictionaryEnabled: false,
  dictionaryRulesText: ''
};

function getSettingsPath(): string {
  return path.join(app.getPath('userData'), SETTINGS_FILENAME);
}

function buildDefaultSettings(): AppSettings {
  const detected = detectDefaultLanguages();
  return {
    ...DEFAULT_SETTINGS,
    uiLanguage: detected.uiLanguage,
    language: detected.language,
    memoPadVisibleButtons: [...MEMO_PAD_BUTTON_ORDER]
  };
}

function toUiLanguageFromTranscriptionLanguage(language: TranscriptionLanguage): UiLanguage | null {
  if (isUiLanguage(language)) return language;
  return null;
}

function isThemeMode(value: unknown): value is ThemeMode {
  return value === 'system' || value === 'light' || value === 'dark';
}

function normalizeAccentColor(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) return null;
  return normalized;
}

function isOverlayPlacement(value: unknown): value is OverlayPlacement {
  return (
    value === 'cursor' ||
    value === 'bottomRight' ||
    value === 'bottomLeft' ||
    value === 'bottomCenter' ||
    value === 'topRight' ||
    value === 'topLeft' ||
    value === 'none'
  );
}

function isTrayLeftClickAction(value: unknown): value is TrayLeftClickAction {
  return (
    value === 'toggleRecording' ||
    value === 'showMenu' ||
    value === 'openMemoPad' ||
    value === 'openHistory' ||
    value === 'openPreferences' ||
    value === 'none'
  );
}

function isHotkey(value: unknown): value is string {
  return typeof value === 'string' && value.trim().length > 0;
}

function isSilenceProcessingMode(value: unknown): value is SilenceProcessingMode {
  return value === 'none' || value === 'server';
}

function normalizeMicDeviceId(value: unknown): string | null {
  if (typeof value === 'string') {
    const trimmed = value.trim();
    if (trimmed === 'default') return null;
    return trimmed.length > 0 ? trimmed : null;
  }
  return value === null ? null : DEFAULT_SETTINGS.micDeviceId;
}

function isNonNegativeInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value) && value >= 0;
}

function isInteger(value: unknown): value is number {
  return typeof value === 'number' && Number.isInteger(value);
}

function isBoolean(value: unknown): value is boolean {
  return typeof value === 'boolean';
}

function isWindowBounds(value: unknown): value is WindowBounds {
  if (!value || typeof value !== 'object') return false;
  const obj = value as Record<string, unknown>;
  if (!isInteger(obj.x) || !isInteger(obj.y)) return false;
  if (!isNonNegativeInteger(obj.width) || !isNonNegativeInteger(obj.height)) return false;
  if (obj.width <= 0 || obj.height <= 0) return false;
  return true;
}

function isMemoPadButtonId(value: unknown): value is MemoPadButtonId {
  return (
    value === 'toggle' ||
    value === 'cancel' ||
    value === 'translate' ||
    value === 'cut' ||
    value === 'copy' ||
    value === 'clear' ||
    value === 'history' ||
    value === 'autoPaste' ||
    value === 'autoMemo' ||
    value === 'insertAtCursor' ||
    value === 'settings'
  );
}

function normalizeMemoPadVisibleButtons(value: unknown): MemoPadButtonId[] | null {
  if (!Array.isArray(value)) return null;
  const next: MemoPadButtonId[] = [];
  for (const item of value) {
    if (!isMemoPadButtonId(item)) continue;
    if (next.includes(item)) continue;
    next.push(item);
  }
  return next;
}

function encryptSecret(plain: string): string {
  if (!safeStorage.isEncryptionAvailable()) {
    throw new Error('Secure storage is not available');
  }
  const encrypted = safeStorage.encryptString(plain).toString('base64');
  return `safe:${encrypted}`;
}

function decryptSecret(encrypted: string): string {
  if (encrypted.startsWith('safe:')) {
    const payload = encrypted.slice('safe:'.length);
    return safeStorage.decryptString(Buffer.from(payload, 'base64'));
  }
  if (encrypted.startsWith('plain:')) {
    const payload = encrypted.slice('plain:'.length);
    return Buffer.from(payload, 'base64').toString('utf-8');
  }
  // Backward-compat: treat as safeStorage base64
  return safeStorage.decryptString(Buffer.from(encrypted, 'base64'));
}

export function isPlausibleOpenAIKey(value: string): boolean {
  // Accept sk-... and sk-proj-... style keys.
  return /^sk-[A-Za-z0-9_-]{16,}$/.test(value.trim());
}

export class SettingsStore {
  private settings: AppSettings = { ...DEFAULT_SETTINGS };

  async load(): Promise<AppSettings> {
    const defaults = buildDefaultSettings();
    const settingsPath = getSettingsPath();
    const raw = await readJsonFile(settingsPath);
    if (raw && typeof raw === 'object') {
      const obj = raw as Omit<Partial<AppSettings>, 'language' | 'uiLanguage' | 'translationTarget'> & {
        language?: unknown;
        uiLanguage?: unknown;
        translationTarget?: unknown;
      };
      const languageRaw = obj.language;
      const language =
        isTranscriptionLanguage(languageRaw) ? languageRaw : defaults.language;
      const uiLanguageRaw = obj.uiLanguage;
      const uiLanguage =
        isUiLanguage(uiLanguageRaw)
          ? uiLanguageRaw
          : (toUiLanguageFromTranscriptionLanguage(language) ?? defaults.uiLanguage);
      const memoPadVisibleButtons = normalizeMemoPadVisibleButtons(obj.memoPadVisibleButtons);
      const overlayOffsetX = normalizeOverlayOffsetFromSettings(obj.overlayOffsetX);
      const overlayOffsetY = normalizeOverlayOffsetFromSettings(obj.overlayOffsetY);
      const accentColor = normalizeAccentColor((obj as Record<string, unknown>).accentColor);

      const translationEnabled =
        typeof obj.translationEnabled === 'boolean' ? obj.translationEnabled : defaults.translationEnabled;
      const translationTargetRaw = obj.translationTarget;
      const translationTarget = isTranscriptionLanguage(translationTargetRaw)
        ? translationTargetRaw
        : defaults.translationTarget;

      const micDeviceId = normalizeMicDeviceId(obj.micDeviceId);
      const silenceAutoStopSeconds = normalizeSilenceAutoStopSecondsFromSettings(obj.silenceAutoStopSeconds);
      const recordingMaxSeconds = normalizeRecordingMaxSecondsFromSettings(obj.recordingMaxSeconds);
      const keyboardCharsPerMinute = normalizeKeyboardCharsPerMinuteFromSettings(obj.keyboardCharsPerMinute);
      const historyMaxItems = normalizeHistoryMaxItemsFromSettings(obj.historyMaxItems);
      const memoPadEditorFontSizePx = normalizeMemoPadEditorFontSizePxFromSettings(obj.memoPadEditorFontSizePx);

      this.settings = {
        ...defaults,
        uiLanguage,
        ...(isThemeMode(obj.themeMode) ? { themeMode: obj.themeMode } : {}),
        ...(accentColor ? { accentColor } : {}),
        ...(isOverlayPlacement(obj.overlayPlacement) ? { overlayPlacement: obj.overlayPlacement } : {}),
        ...(overlayOffsetX !== null ? { overlayOffsetX } : {}),
        ...(overlayOffsetY !== null ? { overlayOffsetY } : {}),
        language,
        ...(isTranscriptionModel(obj.model) ? { model: obj.model } : {}),
        ...(isHotkey(obj.hotkey) && isUserConfigurableHotkeyAccelerator(obj.hotkey) && !isHotkeyConflictingWithFixedShortcuts(obj.hotkey)
          ? { hotkey: normalizeAccelerator(obj.hotkey) }
          : {}),
        ...(isTrayLeftClickAction(obj.trayLeftClickAction) ? { trayLeftClickAction: obj.trayLeftClickAction } : {}),
        ...(isNonNegativeInteger(obj.apiTimeoutSeconds)
          ? {
              apiTimeoutSeconds: Math.max(
                MIN_API_TIMEOUT_SECONDS,
                Math.min(MAX_API_TIMEOUT_SECONDS, Math.floor(obj.apiTimeoutSeconds))
              )
            }
          : {}),
        ...(recordingMaxSeconds !== null ? { recordingMaxSeconds } : {}),
        ...(keyboardCharsPerMinute !== null ? { keyboardCharsPerMinute } : {}),
        ...(isSilenceProcessingMode(obj.silenceProcessingMode) ? { silenceProcessingMode: obj.silenceProcessingMode } : {}),
        ...(silenceAutoStopSeconds !== null ? { silenceAutoStopSeconds } : {}),
        ...(micDeviceId !== DEFAULT_SETTINGS.micDeviceId ? { micDeviceId } : {}),
        ...(isNonNegativeInteger(obj.micWarmGraceSeconds)
          ? { micWarmGraceSeconds: Math.min(obj.micWarmGraceSeconds, MAX_MIC_WARM_GRACE_SECONDS) }
          : {}),
        ...(isBoolean(obj.updateCheckEnabled) ? { updateCheckEnabled: obj.updateCheckEnabled } : {}),
        ...(isBoolean(obj.softStartOpenMemoPad) ? { softStartOpenMemoPad: obj.softStartOpenMemoPad } : {}),
        ...(isBoolean(obj.softStartOpenHistory) ? { softStartOpenHistory: obj.softStartOpenHistory } : {}),
        ...(isBoolean(obj.autoPaste) ? { autoPaste: obj.autoPaste } : {}),
        ...(isBoolean(obj.memoPadAutoMemo) ? { memoPadAutoMemo: obj.memoPadAutoMemo } : {}),
        ...(isBoolean(obj.memoPadPersistText) ? { memoPadPersistText: obj.memoPadPersistText } : {}),
        ...(isBoolean(obj.memoPadInsertAtCursor)
          ? { memoPadInsertAtCursor: obj.memoPadInsertAtCursor }
          : {}),
        ...(isBoolean(obj.memoPadAlwaysOnTop) ? { memoPadAlwaysOnTop: obj.memoPadAlwaysOnTop } : {}),
        ...(memoPadEditorFontSizePx !== null ? { memoPadEditorFontSizePx } : {}),
        ...(isNonNegativeInteger(obj.memoPadUndoMaxSteps)
          ? { memoPadUndoMaxSteps: Math.min(obj.memoPadUndoMaxSteps, MAX_MEMO_PAD_UNDO_MAX_STEPS) }
          : {}),
        ...(typeof obj.memoPadText === 'string' ? { memoPadText: obj.memoPadText } : {}),
        ...(memoPadVisibleButtons ? { memoPadVisibleButtons } : {}),
        translationEnabled,
        translationTarget,
        ...(historyMaxItems !== null ? { historyMaxItems } : {}),
        ...(isBoolean(obj.historyAlwaysOnTop) ? { historyAlwaysOnTop: obj.historyAlwaysOnTop } : {}),
        ...(isBoolean(obj.dictionaryEnabled) ? { dictionaryEnabled: obj.dictionaryEnabled } : {}),
        ...(typeof obj.dictionaryRulesText === 'string'
          ? { dictionaryRulesText: obj.dictionaryRulesText }
          : {}),
        ...(isWindowBounds(obj.memoPadBounds) ? { memoPadBounds: obj.memoPadBounds } : {}),
        ...(typeof obj.apiKeyEncrypted === 'string' ? { apiKeyEncrypted: obj.apiKeyEncrypted } : {})
      };
    } else {
      this.settings = { ...defaults };
    }
    if (!this.settings.memoPadPersistText && this.settings.memoPadText) {
      this.settings.memoPadText = '';
    }
    if (!this.settings.memoPadAutoMemo && this.settings.memoPadInsertAtCursor) {
      this.settings.memoPadInsertAtCursor = false;
    }
    this.maybeUpgradeApiKeyEncryption();
    await this.save();
    return this.settings;
  }

  async save(): Promise<void> {
    const settingsPath = getSettingsPath();
    await writeJsonFile(settingsPath, this.settings);
  }

  get(): AppSettings {
    return this.settings;
  }

  isSecureStorageAvailable(): boolean {
    try {
      return safeStorage.isEncryptionAvailable();
    } catch {
      return false;
    }
  }

  getApiKeyStorage(): 'none' | 'safe' | 'plain' | 'unknown' {
    const encrypted = this.settings.apiKeyEncrypted;
    if (!encrypted) return 'none';
    if (encrypted.startsWith('safe:')) return 'safe';
    if (encrypted.startsWith('plain:')) return 'plain';
    return 'unknown';
  }

  hasApiKey(): boolean {
    const apiKey = this.getApiKey();
    return typeof apiKey === 'string' && apiKey.trim().length > 0;
  }

  getApiKey(): string | null {
    if (!this.settings.apiKeyEncrypted) return null;
    try {
      return decryptSecret(this.settings.apiKeyEncrypted);
    } catch {
      return null;
    }
  }

  private maybeUpgradeApiKeyEncryption(): void {
    const encrypted = this.settings.apiKeyEncrypted;
    if (!encrypted || !encrypted.startsWith('plain:')) return;
    if (!this.isSecureStorageAvailable()) return;
    const apiKey = this.getApiKey();
    if (!apiKey || !apiKey.trim()) return;
    try {
      this.settings.apiKeyEncrypted = encryptSecret(apiKey.trim());
    } catch {
      // ignore
    }
  }

  async setApiKey(apiKey: string): Promise<void> {
    this.settings.apiKeyEncrypted = encryptSecret(apiKey.trim());
    await this.save();
  }

  async clearApiKey(): Promise<void> {
    delete this.settings.apiKeyEncrypted;
    await this.save();
  }

  async setUiLanguage(language: UiLanguage): Promise<void> {
    this.settings.uiLanguage = language;
    await this.save();
  }

  async setLanguage(language: TranscriptionLanguage): Promise<void> {
    this.settings.language = language;
    await this.save();
  }

  async setModel(model: TranscriptionModel): Promise<void> {
    this.settings.model = model;
    await this.save();
  }

  async setAutoPaste(enabled: boolean): Promise<void> {
    this.settings.autoPaste = enabled;
    await this.save();
  }

  async setMemoPadAutoMemo(enabled: boolean): Promise<void> {
    this.settings.memoPadAutoMemo = enabled;
    if (!enabled) {
      this.settings.memoPadInsertAtCursor = false;
    }
    await this.save();
  }

  async setMemoPadPersistText(enabled: boolean): Promise<void> {
    this.settings.memoPadPersistText = enabled;
    if (!enabled) {
      this.settings.memoPadText = '';
    }
    await this.save();
  }

  async setMemoPadInsertAtCursor(enabled: boolean): Promise<void> {
    this.settings.memoPadInsertAtCursor = enabled && this.settings.memoPadAutoMemo;
    await this.save();
  }

  async setMemoPadAlwaysOnTop(enabled: boolean): Promise<void> {
    this.settings.memoPadAlwaysOnTop = enabled;
    await this.save();
  }

  async setMemoPadEditorFontSizePx(fontSizePx: number): Promise<void> {
    const normalized = Number.isFinite(fontSizePx) ? Math.floor(fontSizePx) : DEFAULT_SETTINGS.memoPadEditorFontSizePx;
    this.settings.memoPadEditorFontSizePx = Math.max(
      MIN_MEMO_PAD_EDITOR_FONT_SIZE_PX,
      Math.min(MAX_MEMO_PAD_EDITOR_FONT_SIZE_PX, normalized)
    );
    await this.save();
  }

  async setMemoPadText(text: string): Promise<void> {
    this.settings.memoPadText = text;
    await this.save();
  }

  async setMemoPadVisibleButtons(buttons: MemoPadButtonId[]): Promise<void> {
    const next: MemoPadButtonId[] = [];
    for (const item of buttons) {
      if (!isMemoPadButtonId(item)) continue;
      if (next.includes(item)) continue;
      next.push(item);
    }
    this.settings.memoPadVisibleButtons = next;
    await this.save();
  }

  async setTranslationEnabled(enabled: boolean): Promise<void> {
    this.settings.translationEnabled = enabled;
    await this.save();
  }

  async setTranslationTarget(language: TranscriptionLanguage): Promise<void> {
    this.settings.translationTarget = language;
    await this.save();
  }

  async setHotkey(hotkey: string): Promise<void> {
    this.settings.hotkey = hotkey;
    await this.save();
  }

  async setTrayLeftClickAction(action: TrayLeftClickAction): Promise<void> {
    this.settings.trayLeftClickAction = action;
    await this.save();
  }

  async setThemeMode(themeMode: ThemeMode): Promise<void> {
    this.settings.themeMode = themeMode;
    await this.save();
  }

  async setAccentColor(accentColor: string | null): Promise<void> {
    const normalized = normalizeAccentColor(accentColor);
    this.settings.accentColor = normalized;
    await this.save();
  }

  async setOverlayPlacement(placement: OverlayPlacement): Promise<void> {
    this.settings.overlayPlacement = placement;
    await this.save();
  }

  async setOverlayOffsetX(offsetX: number): Promise<void> {
    const normalized = normalizeOverlayOffsetFromSettings(offsetX);
    if (normalized === null) return;
    this.settings.overlayOffsetX = normalized;
    await this.save();
  }

  async setOverlayOffsetY(offsetY: number): Promise<void> {
    const normalized = normalizeOverlayOffsetFromSettings(offsetY);
    if (normalized === null) return;
    this.settings.overlayOffsetY = normalized;
    await this.save();
  }

  async setHistoryAlwaysOnTop(enabled: boolean): Promise<void> {
    this.settings.historyAlwaysOnTop = enabled;
    await this.save();
  }

  async setApiTimeoutSeconds(seconds: number): Promise<void> {
    const normalized = Number.isFinite(seconds) ? seconds : DEFAULT_SETTINGS.apiTimeoutSeconds;
    this.settings.apiTimeoutSeconds = Math.max(
      MIN_API_TIMEOUT_SECONDS,
      Math.min(MAX_API_TIMEOUT_SECONDS, Math.floor(normalized))
    );
    await this.save();
  }

  async setRecordingMaxSeconds(maxSeconds: number): Promise<void> {
    const normalized = Number.isFinite(maxSeconds) ? maxSeconds : DEFAULT_SETTINGS.recordingMaxSeconds;
    this.settings.recordingMaxSeconds = Math.max(
      MIN_RECORDING_MAX_SECONDS,
      Math.min(MAX_RECORDING_MAX_SECONDS, Math.floor(normalized))
    );
    await this.save();
  }

  async setKeyboardCharsPerMinute(charsPerMinute: number): Promise<void> {
    const normalized = Number.isFinite(charsPerMinute) ? charsPerMinute : 0;
    this.settings.keyboardCharsPerMinute = Math.max(
      0,
      Math.min(MAX_KEYBOARD_CHARS_PER_MINUTE, Math.floor(normalized))
    );
    await this.save();
  }

  async setSilenceProcessingMode(mode: SilenceProcessingMode): Promise<void> {
    this.settings.silenceProcessingMode = mode;
    await this.save();
  }

  async setSilenceAutoStopSeconds(seconds: number): Promise<void> {
    const normalized = Number.isFinite(seconds) ? seconds : 0;
    this.settings.silenceAutoStopSeconds = Math.max(
      0,
      Math.min(MAX_SILENCE_AUTO_STOP_SECONDS, Math.floor(normalized))
    );
    await this.save();
  }

  async setMicDeviceId(deviceId: string | null): Promise<void> {
    const normalized = typeof deviceId === 'string' ? deviceId.trim() : '';
    this.settings.micDeviceId = normalized.length > 0 && normalized !== 'default' ? normalized : null;
    await this.save();
  }

  async setMicWarmGraceSeconds(seconds: number): Promise<void> {
    const normalized = Number.isFinite(seconds) ? seconds : 0;
    this.settings.micWarmGraceSeconds = Math.max(
      0,
      Math.min(MAX_MIC_WARM_GRACE_SECONDS, Math.floor(normalized))
    );
    await this.save();
  }

  async setUpdateCheckEnabled(enabled: boolean): Promise<void> {
    this.settings.updateCheckEnabled = Boolean(enabled);
    await this.save();
  }

  async setSoftStartOpenMemoPad(enabled: boolean): Promise<void> {
    this.settings.softStartOpenMemoPad = enabled;
    await this.save();
  }

  async setSoftStartOpenHistory(enabled: boolean): Promise<void> {
    this.settings.softStartOpenHistory = enabled;
    await this.save();
  }

  async setMemoPadUndoMaxSteps(maxSteps: number): Promise<void> {
    const normalized = Number.isFinite(maxSteps) ? Math.floor(maxSteps) : DEFAULT_SETTINGS.memoPadUndoMaxSteps;
    this.settings.memoPadUndoMaxSteps = Math.max(0, Math.min(MAX_MEMO_PAD_UNDO_MAX_STEPS, normalized));
    await this.save();
  }

  async setHistoryMaxItems(maxItems: number): Promise<void> {
    const normalized = Number.isFinite(maxItems) ? maxItems : DEFAULT_SETTINGS.historyMaxItems;
    this.settings.historyMaxItems = Math.max(
      MIN_HISTORY_MAX_ITEMS,
      Math.min(MAX_HISTORY_MAX_ITEMS, Math.floor(normalized))
    );
    await this.save();
  }

  async setDictionaryEnabled(enabled: boolean): Promise<void> {
    this.settings.dictionaryEnabled = enabled;
    await this.save();
  }

  async setDictionaryRulesText(text: string): Promise<void> {
    this.settings.dictionaryRulesText = text;
    await this.save();
  }

  async setMemoPadBounds(bounds: WindowBounds): Promise<void> {
    this.settings.memoPadBounds = bounds;
    await this.save();
  }

}
