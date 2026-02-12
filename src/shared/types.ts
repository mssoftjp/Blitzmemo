export type SupportedLanguage = 'ja' | 'en' | 'zh' | 'ko';
export type UiLanguage =
  | 'ja'
  | 'en'
  | 'es'
  | 'pt'
  | 'fr'
  | 'de'
  | 'it'
  | 'pl'
  | 'id'
  | 'ru'
  | 'vi'
  | 'tr'
  | 'th'
  | 'ko'
  | 'zh-hans'
  | 'zh-hant';
export type TranscriptionLanguage =
  | 'ja'
  | 'en'
  | 'es'
  | 'it'
  | 'de'
  | 'pt'
  | 'pl'
  | 'id'
  | 'fr'
  | 'ru'
  | 'vi'
  | 'nl'
  | 'uk'
  | 'ko'
  | 'ro'
  | 'ms'
  | 'tr'
  | 'th'
  | 'sv'
  | 'no'
  | 'da'
  | 'zh-hans'
  | 'zh-hant';
export type TranscriptionModel = 'gpt-4o-transcribe' | 'gpt-4o-mini-transcribe';
export type SilenceProcessingMode = 'none' | 'server';
export type ThemeMode = 'system' | 'light' | 'dark';
export type OverlayPlacement = 'cursor' | 'bottomRight' | 'bottomLeft' | 'bottomCenter' | 'topRight' | 'topLeft' | 'none';
export type TrayLeftClickAction =
  | 'toggleRecording'
  | 'showMenu'
  | 'openMemoPad'
  | 'openHistory'
  | 'openPreferences'
  | 'none';

export type WindowBounds = { x: number; y: number; width: number; height: number };

export type MemoPadButtonId =
  | 'toggle'
  | 'cancel'
  | 'translate'
  | 'cut'
  | 'copy'
  | 'clear'
  | 'history'
  | 'autoPaste'
  | 'autoMemo'
  | 'insertAtCursor'
  | 'settings';

// user-note: Default memo pad button order matches the Preferences "Display (Order)" UI.
export const MEMO_PAD_BUTTON_ORDER: MemoPadButtonId[] = [
  'toggle',
  'cancel',
  'cut',
  'copy',
  'clear',
  'history',
  'translate',
  'autoPaste',
  'autoMemo',
  'insertAtCursor',
  'settings'
];

export type AppSettings = {
  uiLanguage: UiLanguage;
  themeMode: ThemeMode;
  accentColor: string | null;
  overlayPlacement: OverlayPlacement;
  overlayOffsetX: number;
  overlayOffsetY: number;
  language: TranscriptionLanguage;
  model: TranscriptionModel;
  hotkey: string;
  trayLeftClickAction: TrayLeftClickAction;
  apiTimeoutSeconds: number;
  recordingMaxSeconds: number;
  keyboardCharsPerMinute: number;
  silenceProcessingMode: SilenceProcessingMode;
  silenceAutoStopSeconds: number;
  micDeviceId: string | null;
  micWarmGraceSeconds: number;
  updateCheckEnabled: boolean;
  softStartOpenMemoPad: boolean;
  softStartOpenHistory: boolean;
  autoPaste: boolean;
  memoPadAutoMemo: boolean;
  memoPadPersistText: boolean;
  memoPadInsertAtCursor: boolean;
  memoPadAlwaysOnTop: boolean;
  memoPadEditorFontSizePx: number;
  memoPadUndoMaxSteps: number;
  memoPadText: string;
  memoPadVisibleButtons: MemoPadButtonId[];
  translationEnabled: boolean;
  translationTarget: TranscriptionLanguage;
  historyMaxItems: number;
  historyAlwaysOnTop: boolean;
  dictionaryEnabled: boolean;
  dictionaryRulesText: string;
  memoPadBounds?: WindowBounds;
  apiKeyEncrypted?: string;
};

export type HistoryEntry = {
  id: string;
  createdAt: number;
  language: TranscriptionLanguage;
  model: TranscriptionModel;
  transcript: string;
  text: string;
  translated: boolean;
  translationTarget?: TranscriptionLanguage;
};

export type StatsEntry = {
  id: string;
  endedAt: number;
  durationSeconds: number;
  waitSeconds?: number;
  charCount: number;
  language: TranscriptionLanguage;
  model: TranscriptionModel;
};
