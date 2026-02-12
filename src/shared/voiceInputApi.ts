import type {
  MemoPadButtonId,
  OverlayPlacement,
  SilenceProcessingMode,
  StatsEntry,
  TranscriptionLanguage,
  ThemeMode,
  TrayLeftClickAction,
  TranscriptionModel,
  UiLanguage
} from './types';

export type ApiErrorCode =
  | 'canceled'
  | 'unknown'
  | 'apiKey.notSet'
  | 'settings.invalidApiKeyFormat'
  | 'settings.secureStorageUnavailable'
  | 'settings.invalidUiLanguage'
  | 'hotkey.empty'
  | 'hotkey.conflict'
  | 'hotkey.inUse'
  | 'hotkey.invalid'
  | 'history.failedToLoad'
  | 'history.failedToClear'
  | 'history.failedToDelete'
  | 'history.openFailed'
  | 'transfer.nothingSelected'
  | 'transfer.filePathEmpty'
  | 'transfer.passwordRequired'
  | 'transfer.invalidPassword'
  | 'transfer.failedToExport'
  | 'transfer.failedToImport'
  | 'dictionary.invalidRules'
  | 'memo.notAvailable'
  | 'invalidPayload'
  | 'notSupported'
  | 'window.notFound'
  | 'transcribe.failed'
  | 'translation.failed';

export type ApiErrorFields = { errorCode?: ApiErrorCode; error?: string };

export type ApiKeyStorage = 'none' | 'safe' | 'plain' | 'unknown';

export type SettingsSnapshot = {
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
  memoPadVisibleButtons: MemoPadButtonId[];
  translationEnabled: boolean;
  translationTarget: TranscriptionLanguage;
  historyMaxItems: number;
  historyAlwaysOnTop: boolean;
  dictionaryEnabled: boolean;
  dictionaryRulesText: string;
  hasApiKey: boolean;
  secureStorageAvailable: boolean;
  apiKeyStorage: ApiKeyStorage;
};

export type SettingsChangedPayload = {
  autoPaste: boolean;
  memoPadAutoMemo: boolean;
  memoPadInsertAtCursor: boolean;
  memoPadEditorFontSizePx: number;
  memoPadUndoMaxSteps: number;
  translationEnabled: boolean;
  translationTarget: TranscriptionLanguage;
};

export type AboutInfo = {
  appVersion: string;
  electron: string;
  chromium: string;
  node: string;
  v8: string;
  os: string;
  copyright: string;
  githubUrl: string;
  websiteUrl: string;
  privacyPolicyUrl: string;
  lastUpdateCheckAt: number | null;
};

export type CheckForUpdatesResult =
  | {
      ok: true;
      status: 'upToDate' | 'updateAvailable' | 'cannotCompare';
      currentVersion: string;
      latestVersion: string;
      latestUrl: string;
    }
  | { ok: false; error?: string; errorCode?: ApiErrorCode };

export type AppDataSections = {
  appSettings: boolean;
  dictionary: boolean;
  history: boolean;
  stats: boolean;
  usage: boolean;
};

export type AppDataExportOptions = { password?: string | null };

export type AppDataImportOptions = {
  password?: string | null;
  filePath?: string;
};

export type ExportAppDataResult = { ok: boolean; canceled?: boolean; filePath?: string; error?: string; errorCode?: ApiErrorCode };

export type ImportAppDataResult = {
  ok: boolean;
  canceled?: boolean;
  filePath?: string;
  imported?: {
    appSettings: boolean;
    dictionary: boolean;
    historyEntries: number;
    statsEntries: number;
    usageModels: number;
  };
  error?: string;
  errorCode?: ApiErrorCode;
};

export type VoiceInputApi = {
  getSettings: () => Promise<SettingsSnapshot>;
  getAboutInfo: () => Promise<{ ok: boolean; info?: AboutInfo; error?: string; errorCode?: ApiErrorCode }>;
  checkForUpdates: () => Promise<CheckForUpdatesResult>;
  getPermissions: () => Promise<{ platform: string; accessibilityTrusted: boolean }>;
  notifyRecordingState: (state: 'idle' | 'recording' | 'transcribing' | 'error', message?: string) => void;
  notifyRecordingLevel: (level: number) => void;
  notifyAudioInputDevices: (devices: { deviceId: string; label: string }[]) => void;
  notifySystemDefaultMicrophone: (label: string | null) => void;
  notifyActiveMicrophone: (microphone: { deviceId: string | null; label: string } | null) => void;
  cancelTranscription: () => void;
  requestAccessibilityPermission: () => Promise<{ ok: boolean; trusted?: boolean; error?: string; errorCode?: ApiErrorCode }>;
  openAccessibilitySettings: () => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  openPreferences: () => Promise<{ ok: boolean }>;
  openExternal: (url: string) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  openThirdPartyNotices: () => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  popupTrayMenu: (position?: { x?: number; y?: number }) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;

  setThemeMode: (mode: ThemeMode) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setAccentColor: (color: string | null) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setOverlayPlacement: (placement: OverlayPlacement) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setOverlayOffsetX: (offsetX: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setOverlayOffsetY: (offsetY: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setHotkey: (hotkey: string) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setTrayLeftClickAction: (action: TrayLeftClickAction) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setApiTimeoutSeconds: (seconds: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setRecordingMaxSeconds: (maxSeconds: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setKeyboardCharsPerMinute: (charsPerMinute: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setSilenceProcessingMode: (mode: SilenceProcessingMode) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setSilenceAutoStopSeconds: (seconds: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setMicDeviceId: (deviceId: string | null) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setMicWarmGraceSeconds: (seconds: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setUpdateCheckEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
  setHistoryMaxItems: (maxItems: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setDictionaryEnabled: (enabled: boolean) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setDictionaryRulesText: (
    rulesText: string
  ) => Promise<{ ok: boolean; ruleCount?: number; error?: string; errors?: string[]; errorCode?: ApiErrorCode }>;
  setApiKey: (apiKey: string) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setUiLanguage: (language: UiLanguage) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setLanguage: (language: TranscriptionLanguage) => Promise<{ ok: boolean }>;
  setModel: (model: TranscriptionModel) => Promise<{ ok: boolean }>;
  setSoftStartOpenMemoPad: (enabled: boolean) => Promise<{ ok: boolean }>;
  setSoftStartOpenHistory: (enabled: boolean) => Promise<{ ok: boolean }>;
  setAutoPaste: (enabled: boolean) => Promise<{ ok: boolean }>;
  setMemoPadAutoMemo: (enabled: boolean) => Promise<{ ok: boolean }>;
  setMemoPadPersistText: (enabled: boolean) => Promise<{ ok: boolean }>;
  setMemoPadInsertAtCursor: (enabled: boolean) => Promise<{ ok: boolean }>;
  setMemoPadAlwaysOnTop: (enabled: boolean) => Promise<{ ok: boolean }>;
  setMemoPadEditorFontSizePx: (fontSizePx: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setMemoPadUndoMaxSteps: (maxSteps: number) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setHistoryAlwaysOnTop: (enabled: boolean) => Promise<{ ok: boolean }>;
  setMemoPadVisibleButtons: (buttons: MemoPadButtonId[]) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setMemoPadText: (text: string) => Promise<{ ok: boolean }>;
  memoReplaceSelection: (payload: { replacementText: string }) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  setTranslationEnabled: (enabled: boolean) => Promise<{ ok: boolean }>;
  setTranslationTarget: (language: TranscriptionLanguage) => Promise<{ ok: boolean }>;

  listHistory: () => Promise<{ ok: boolean; entries?: unknown[]; error?: string; errorCode?: ApiErrorCode }>;
  clearHistory: () => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  deleteHistoryEntry: (id: string) => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;
  openHistoryWindow: () => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;

  getUsage: () => Promise<{
    ok: boolean;
    audioSecondsByModel?: Record<string, number>;
    sinceAt?: number | null;
    error?: string;
    errorCode?: ApiErrorCode;
  }>;
  clearUsage: () => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;

  getStats: () => Promise<{ ok: boolean; entries?: StatsEntry[]; sinceAt?: number | null; error?: string; errorCode?: ApiErrorCode }>;
  clearStats: () => Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }>;

  exportAppData: (sections: AppDataSections, options?: AppDataExportOptions) => Promise<ExportAppDataResult>;
  importAppData: (sections: AppDataSections, options?: AppDataImportOptions) => Promise<ImportAppDataResult>;

  toggleRecording: () => Promise<{ ok: boolean }>;
  startRecording: () => Promise<{ ok: boolean }>;
  stopRecording: () => Promise<{ ok: boolean }>;
  cancelRecording: () => Promise<{ ok: boolean }>;
  manualTranslate: (inputText: string) => Promise<{ ok: boolean; text?: string; error?: string; errorCode?: ApiErrorCode }>;
  transcribe: (
    audioData: ArrayBuffer,
    mimeType: string,
    durationSeconds: number,
    silenceProcessingMode?: SilenceProcessingMode,
    endedAt?: number
  ) => Promise<{
    ok: boolean;
    text?: string;
    transcript?: string;
    didCopy?: boolean;
    didPaste?: boolean;
    pasteError?: string;
    canceled?: boolean;
    error?: string;
    errorCode?: ApiErrorCode;
  }>;

  onToggleRecording: (callback: () => void) => () => void;
  onStartRecording: (callback: () => void) => () => void;
  onStopRecording: (callback: () => void) => () => void;
  onCancelRecording: (callback: () => void) => () => void;
  onRecordingStateChanged: (callback: (state: 'idle' | 'recording' | 'transcribing' | 'error', message?: string) => void) => () => void;
  onRecordingLevel: (callback: (level: number) => void) => () => void;
  onMemoAppendText: (callback: (text: string) => void) => () => void;
  onMemoRestoreText: (callback: (text: string) => void) => () => void;
  onMemoRequestText: (callback: () => void) => () => void;
  onMemoUndo: (callback: () => void) => () => void;
  onMemoRedo: (callback: () => void) => () => void;
  onMemoButtonLayout: (callback: (buttons: MemoPadButtonId[]) => void) => () => void;
  onMemoReplaceSelection: (callback: (payload: { replacementText: string }) => void) => () => void;
  onMemoOpenFindBar: (callback: (payload: { mode: 'find' | 'replace'; seed?: string }) => void) => () => void;
  onSettingsChanged: (callback: (settings: SettingsChangedPayload) => void) => () => void;
  onAccentColorChanged: (callback: (accentColor: string | null) => void) => () => void;
  onUiLanguageChanged: (callback: (language: UiLanguage) => void) => () => void;
  onHistoryUpdated: (callback: () => void) => () => void;
};
