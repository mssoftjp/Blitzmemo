export const MIN_HISTORY_MAX_ITEMS = 50;
export const MAX_HISTORY_MAX_ITEMS = 500;
export const DEFAULT_HISTORY_MAX_ITEMS = 200;

export const MIN_RECORDING_MAX_SECONDS = 30;
export const MAX_RECORDING_MAX_SECONDS = 300;
export const DEFAULT_RECORDING_MAX_SECONDS = 300;

export const MAX_KEYBOARD_CHARS_PER_MINUTE = 10000;
export const DEFAULT_KEYBOARD_CHARS_PER_MINUTE = 80;

export const MAX_SILENCE_AUTO_STOP_SECONDS = 30;
export const DEFAULT_SILENCE_AUTO_STOP_SECONDS = 15;

export const MIN_MEMO_PAD_EDITOR_FONT_SIZE_PX = 6;
export const MAX_MEMO_PAD_EDITOR_FONT_SIZE_PX = 24;
export const DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX = 14;

export function normalizeHistoryMaxItemsFromSettings(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(MIN_HISTORY_MAX_ITEMS, Math.min(MAX_HISTORY_MAX_ITEMS, Math.floor(value)));
}

export function normalizeHistoryMaxItemsFromUi(value: unknown): number {
  const normalized = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(normalized)) return MIN_HISTORY_MAX_ITEMS;
  return Math.max(MIN_HISTORY_MAX_ITEMS, Math.min(MAX_HISTORY_MAX_ITEMS, Math.floor(normalized)));
}

export function normalizeSilenceAutoStopSecondsFromSettings(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(MAX_SILENCE_AUTO_STOP_SECONDS, Math.floor(value)));
}

export function normalizeSilenceAutoStopSecondsFromUi(value: unknown): number {
  const normalized = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(MAX_SILENCE_AUTO_STOP_SECONDS, Math.floor(normalized)));
}

export function normalizeRecordingMaxSecondsFromSettings(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(MIN_RECORDING_MAX_SECONDS, Math.min(MAX_RECORDING_MAX_SECONDS, Math.floor(value)));
}

export function normalizeRecordingMaxSecondsFromUi(value: unknown): number {
  const normalized = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(normalized)) return MAX_RECORDING_MAX_SECONDS;
  return Math.max(MIN_RECORDING_MAX_SECONDS, Math.min(MAX_RECORDING_MAX_SECONDS, Math.floor(normalized)));
}

export function normalizeKeyboardCharsPerMinuteFromSettings(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(0, Math.min(MAX_KEYBOARD_CHARS_PER_MINUTE, Math.floor(value)));
}

export function normalizeKeyboardCharsPerMinuteFromUi(value: unknown): number {
  const normalized = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(0, Math.min(MAX_KEYBOARD_CHARS_PER_MINUTE, Math.floor(normalized)));
}

export function normalizeMemoPadEditorFontSizePxFromSettings(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(MIN_MEMO_PAD_EDITOR_FONT_SIZE_PX, Math.min(MAX_MEMO_PAD_EDITOR_FONT_SIZE_PX, Math.floor(value)));
}

export function normalizeMemoPadEditorFontSizePxFromUi(value: unknown): number {
  const normalized = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(normalized)) return DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX;
  return Math.max(MIN_MEMO_PAD_EDITOR_FONT_SIZE_PX, Math.min(MAX_MEMO_PAD_EDITOR_FONT_SIZE_PX, Math.floor(normalized)));
}
