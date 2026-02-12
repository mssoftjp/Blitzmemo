import type {
  MemoPadButtonId,
  SilenceProcessingMode,
  UiLanguage
} from '../shared/types';
import { MEMO_PAD_BUTTON_ORDER } from '../shared/types';
import { t, type UiStringKey } from '../shared/i18n';
import { formatApiError } from '../shared/apiError';
import {
  FIXED_CANCEL_HOTKEY,
  formatAcceleratorForDisplay,
  getAcceleratorKeycaps,
  isHotkeyConflictingWithFixedShortcuts,
  isUserConfigurableHotkeyAccelerator,
  keyEventToAccelerator,
  normalizeAccelerator,
  PUSH_TO_TALK_RESET_DELAY_MS,
  PUSH_TO_TALK_THRESHOLD_MS
} from '../shared/hotkey';
import { applyMicLevelToDot } from './micLevel';
import { applyAccentColor, getComputedAccentColorHex } from './accentColor';
import { setupAppDataTransfer } from './appDataTransfer';
import { applyI18n, setUiLanguage } from './i18n';
import { LocalVadSession } from './localVad';
import { createSilenceAutoStopController } from './recording/silenceAutoStop';
import { createWarmAudioStreamManager } from './recording/warmAudioStream';
import { createSegmentResultsBuffer } from './recording/segmentResults';
import { notifyActiveMicrophone, refreshAudioInputDevices } from './recording/microphone';
import { createMicLevelMeter } from './recording/micLevelMeter';
import { createRecordingSession, type RecordingSession } from './recording/session';
import { setupApiKeyPreferences } from './prefs/apiKey';
import { setupAboutSection } from './prefs/about';
import { setupAccessibilityPreferences } from './prefs/accessibility';
import { setupAppearancePreferences } from './prefs/appearance';
import { setupDictionaryPreferences } from './prefs/dictionary';
import { setupDictionaryEditor } from './prefs/dictionaryEditor';
import { setupHistoryPreferences } from './prefs/history';
import { setupLanguagePreferences } from './prefs/language';
import { setupMemoPadPreferences } from './prefs/memoPad';
import { setupMemoPadButtonsPreferences } from './prefs/memoPadButtons';
import { setupRecordingPreferences } from './prefs/recording';
import { setupShortcutPreferences } from './prefs/shortcuts';
import { setupTranslationPreferences } from './prefs/translation';
import { setupStatsUsage } from './statsUsage';
import type { SettingsSnapshot } from './voiceInputApi';
import {
  DEFAULT_RECORDING_MAX_SECONDS,
  normalizeHistoryMaxItemsFromUi,
  normalizeMemoPadEditorFontSizePxFromUi,
  normalizeRecordingMaxSecondsFromUi,
  normalizeSilenceAutoStopSecondsFromUi
} from '../shared/settingsConstraints';

type AppStatus = 'idle' | 'recording' | 'transcribing' | 'error';
const SHORTCUT_STATUS_AUTO_CLEAR_MS = 2500;

function applyPlatformClasses(platform: string): void {
  document.documentElement.classList.toggle('avi-platform-mac', platform === 'darwin');
  document.documentElement.classList.toggle('avi-platform-windows', platform === 'win32');
}

const els = {
  apiKey: document.getElementById('apiKey') as HTMLInputElement,
  saveKey: document.getElementById('saveKey') as HTMLButtonElement,
  keyStatus: document.getElementById('keyStatus') as HTMLDivElement,
  uiLanguage: document.getElementById('uiLanguage') as HTMLSelectElement,
  language: document.getElementById('language') as HTMLSelectElement,
  hotkeyDisplay: document.getElementById('hotkey') as HTMLDivElement,
  changeHotkey: document.getElementById('changeHotkey') as HTMLButtonElement,
  resetHotkey: document.getElementById('resetHotkey') as HTMLButtonElement,
  hotkeyStatus: document.getElementById('hotkeyStatus') as HTMLDivElement,
  model: document.getElementById('model') as HTMLSelectElement,
  autoPaste: document.getElementById('autoPaste') as HTMLInputElement,
  memoPadAutoMemo: document.getElementById('memoPadAutoMemo') as HTMLInputElement,
  memoPadInsertAtCursorRow: document.getElementById('memoPadInsertAtCursorRow') as HTMLDivElement,
  memoPadInsertAtCursor: document.getElementById('memoPadInsertAtCursor') as HTMLInputElement,
  memoPadPersistText: document.getElementById('memoPadPersistText') as HTMLInputElement,
  softStartOpenMemoPad: document.getElementById('softStartOpenMemoPad') as HTMLInputElement,
  softStartOpenHistory: document.getElementById('softStartOpenHistory') as HTMLInputElement,
  trayLeftClickAction: document.getElementById('trayLeftClickAction') as HTMLSelectElement,
  updateCheckEnabled: document.getElementById('updateCheckEnabled') as HTMLInputElement,
  aboutVersion: document.getElementById('aboutVersion') as HTMLDivElement,
  aboutCheckUpdates: document.getElementById('aboutCheckUpdates') as HTMLButtonElement,
  aboutCopyright: document.getElementById('aboutCopyright') as HTMLDivElement,
  aboutGithubLink: document.getElementById('aboutGithubLink') as HTMLAnchorElement,
  aboutWebsiteLink: document.getElementById('aboutWebsiteLink') as HTMLAnchorElement,
  aboutAuthorWebsiteLink: document.getElementById('aboutAuthorWebsiteLink') as HTMLAnchorElement,
  aboutDonationLink: document.getElementById('aboutDonationLink') as HTMLAnchorElement,
  memoPadEditorFontSize: document.getElementById('memoPadEditorFontSize') as HTMLInputElement,
  memoPadEditorFontSizeValue: document.getElementById('memoPadEditorFontSizeValue') as HTMLDivElement,
  themeMode: document.getElementById('themeMode') as HTMLSelectElement,
  accentColor: document.getElementById('accentColor') as HTMLInputElement,
  accentColorReset: document.getElementById('accentColorReset') as HTMLButtonElement,
  overlayPlacement: document.getElementById('overlayPlacement') as HTMLSelectElement,
  overlayOffsetX: document.getElementById('overlayOffsetX') as HTMLInputElement,
  overlayOffsetY: document.getElementById('overlayOffsetY') as HTMLInputElement,
  memoPadButtonsHidden: document.getElementById('memoPadButtonsHidden') as HTMLSelectElement,
  memoPadButtonsVisible: document.getElementById('memoPadButtonsVisible') as HTMLSelectElement,
  memoPadButtonsAdd: document.getElementById('memoPadButtonsAdd') as HTMLButtonElement,
  memoPadButtonsRemove: document.getElementById('memoPadButtonsRemove') as HTMLButtonElement,
  memoPadButtonsUp: document.getElementById('memoPadButtonsUp') as HTMLButtonElement,
  memoPadButtonsDown: document.getElementById('memoPadButtonsDown') as HTMLButtonElement,
  memoPadButtonsReset: document.getElementById('memoPadButtonsReset') as HTMLButtonElement,
  accessibilityStatus: document.getElementById('accessibilityStatus') as HTMLDivElement,
  requestAccessibility: document.getElementById('requestAccessibility') as HTMLButtonElement,
  openAccessibility: document.getElementById('openAccessibility') as HTMLButtonElement,
  translateEnabled: document.getElementById('translateEnabled') as HTMLInputElement,
  translateTarget: document.getElementById('translateTarget') as HTMLSelectElement,
  toggle: document.getElementById('toggle') as HTMLButtonElement | null,
  cancel: document.getElementById('cancel') as HTMLButtonElement | null,
  recordDot: document.getElementById('recordDot') as HTMLSpanElement | null,
  recordLabel: document.getElementById('recordLabel') as HTMLSpanElement | null,
  status: document.getElementById('status') as HTMLDivElement | null,
  recordingMaxSeconds: document.getElementById('recordingMaxSeconds') as HTMLInputElement,
  recordingMaxSecondsValue: document.getElementById('recordingMaxSecondsValue') as HTMLDivElement,
  silenceAutoStopSeconds: document.getElementById('silenceAutoStopSeconds') as HTMLInputElement,
  silenceAutoStopSecondsValue: document.getElementById('silenceAutoStopSecondsValue') as HTMLDivElement,
  dictionaryEnabled: document.getElementById('dictionaryEnabled') as HTMLInputElement,
  addDictionaryReplaceRule: document.getElementById('addDictionaryReplaceRule') as HTMLButtonElement,
  addDictionaryProtectRule: document.getElementById('addDictionaryProtectRule') as HTMLButtonElement,
  dictionaryReplaceTable: document.getElementById('dictionaryReplaceTable') as HTMLDivElement,
  dictionaryProtectTable: document.getElementById('dictionaryProtectTable') as HTMLDivElement,
  dictionaryStatus: document.getElementById('dictionaryStatus') as HTMLDivElement,
  result: document.getElementById('result') as HTMLTextAreaElement | null,
  copy: document.getElementById('copy') as HTMLButtonElement | null,
  clear: document.getElementById('clear') as HTMLButtonElement | null,
  historyMaxItems: document.getElementById('historyMaxItems') as HTMLInputElement,
  historyMaxItemsValue: document.getElementById('historyMaxItemsValue') as HTMLDivElement,
  clearUsage: document.getElementById('clearUsage') as HTMLButtonElement,
  usageMeta: document.getElementById('usageMeta') as HTMLDivElement,
  usageSummary: document.getElementById('usageSummary') as HTMLDivElement,
  usageTable: document.getElementById('usageTable') as HTMLDivElement,
  clearStats: document.getElementById('clearStats') as HTMLButtonElement,
  statsGroupBy: document.getElementById('statsGroupBy') as HTMLSelectElement,
  keyboardCharsPerMinute: document.getElementById('keyboardCharsPerMinute') as HTMLInputElement,
  statsIncludeWaitTime: document.getElementById('statsIncludeWaitTime') as HTMLInputElement,
  statsMeta: document.getElementById('statsMeta') as HTMLDivElement,
  statsSummary: document.getElementById('statsSummary') as HTMLDivElement,
  statsTable: document.getElementById('statsTable') as HTMLDivElement,
  appDataAppSettings: document.getElementById('appDataAppSettings') as HTMLInputElement,
  appDataDictionary: document.getElementById('appDataDictionary') as HTMLInputElement,
  appDataHistory: document.getElementById('appDataHistory') as HTMLInputElement,
  appDataStats: document.getElementById('appDataStats') as HTMLInputElement,
  appDataUsage: document.getElementById('appDataUsage') as HTMLInputElement,
  appDataExport: document.getElementById('appDataExport') as HTMLButtonElement,
  appDataImport: document.getElementById('appDataImport') as HTMLButtonElement,
  appDataStatus: document.getElementById('appDataStatus') as HTMLDivElement,
  appDataExportPasswordModal: document.getElementById('appDataExportPasswordModal') as HTMLDivElement,
  appDataExportPasswordChoice: document.getElementById('appDataExportPasswordChoice') as HTMLDivElement,
  appDataExportPasswordSet: document.getElementById('appDataExportPasswordSet') as HTMLDivElement,
  appDataExportPasswordNoPassword: document.getElementById('appDataExportPasswordNoPassword') as HTMLButtonElement,
  appDataExportPasswordSetPassword: document.getElementById('appDataExportPasswordSetPassword') as HTMLButtonElement,
  appDataExportPasswordCancel: document.getElementById('appDataExportPasswordCancel') as HTMLButtonElement,
  appDataExportPasswordInput: document.getElementById('appDataExportPasswordInput') as HTMLInputElement,
  appDataExportPasswordConfirmInput: document.getElementById('appDataExportPasswordConfirmInput') as HTMLInputElement,
  appDataExportPasswordError: document.getElementById('appDataExportPasswordError') as HTMLDivElement,
  appDataExportPasswordBack: document.getElementById('appDataExportPasswordBack') as HTMLButtonElement,
  appDataExportPasswordSubmit: document.getElementById('appDataExportPasswordSubmit') as HTMLButtonElement,
  appDataImportPasswordModal: document.getElementById('appDataImportPasswordModal') as HTMLDivElement,
  appDataImportPasswordInput: document.getElementById('appDataImportPasswordInput') as HTMLInputElement,
  appDataImportPasswordError: document.getElementById('appDataImportPasswordError') as HTMLDivElement,
  appDataImportPasswordCancel: document.getElementById('appDataImportPasswordCancel') as HTMLButtonElement,
  appDataImportPasswordSubmit: document.getElementById('appDataImportPasswordSubmit') as HTMLButtonElement
};

function syncAccentColorControls(accentColor: string | null): void {
  const fallback = '#007aff';
  const resolved = accentColor ?? getComputedAccentColorHex() ?? fallback;
  els.accentColor.value = resolved;
  els.accentColorReset.disabled = accentColor === null;
}

function listenForSystemThemeChanges(): void {
  const mq = window.matchMedia('(prefers-color-scheme: dark)');
  mq.addEventListener('change', () => {
    if (!lastSettingsSnapshot) return;
    if (lastSettingsSnapshot.accentColor !== null) return;
    syncAccentColorControls(null);
  });
}

let appStatus: AppStatus = 'idle';
let recordingMaxSeconds = 0;
let keyboardCharsPerMinute = 0;
let uiLanguage: UiLanguage = 'en';
let silenceAutoStopSeconds = 0;
let micDeviceId: string | null = null;
let micWarmGraceSeconds = 0;
let silenceProcessingMode: SilenceProcessingMode = 'none';
let activeSilenceProcessingMode: SilenceProcessingMode = 'none';
let isCapturingHotkey = false;
let hotkeyListener: ((event: KeyboardEvent) => void) | null = null;
let appPlatform = 'unknown';
let lastPermissions: PermissionsSnapshot | null = null;
let lastSettingsSnapshot: SettingsSnapshot | null = null;
let activeHotkeyAccelerator = 'CommandOrControl+F12';
let isPushToTalkMode = false;

type AviPage =
  | 'main'
  | 'pasteMemo'
  | 'appearance'
  | 'ai'
  | 'dictionary'
  | 'stats'
  | 'usage'
  | 'transfer'
  | 'about';

let activePage: AviPage = 'main';

const DEFAULT_HOTKEY = 'CommandOrControl+F12';

const MEMO_PAD_BUTTON_ID_SET = new Set<MemoPadButtonId>(MEMO_PAD_BUTTON_ORDER);

const MEMO_PAD_BUTTON_LABEL_KEYS: Record<MemoPadButtonId, UiStringKey> = {
  toggle: 'prefs.appearance.memoButtons.button.toggle',
  cancel: 'prefs.appearance.memoButtons.button.cancel',
  translate: 'prefs.appearance.memoButtons.button.translate',
  cut: 'common.cut',
  copy: 'prefs.appearance.memoButtons.button.copy',
  clear: 'prefs.appearance.memoButtons.button.clear',
  history: 'prefs.appearance.memoButtons.button.history',
  autoPaste: 'prefs.appearance.memoButtons.button.autoPaste',
  autoMemo: 'prefs.appearance.memoButtons.button.autoMemo',
  insertAtCursor: 'prefs.appearance.memoButtons.button.insertAtCursor',
  settings: 'prefs.appearance.memoButtons.button.settings'
};

let memoPadVisibleButtons: MemoPadButtonId[] = [...MEMO_PAD_BUTTON_ORDER];

function voidAsync<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    fn(...args).catch((error) => {
      console.error(error);
    });
  };
}

type PermissionsSnapshot = { platform: string; accessibilityTrusted: boolean };

function tr(key: UiStringKey, params?: Record<string, string | number>): string {
  return t(uiLanguage, key, params);
}

const statsUsage = setupStatsUsage({
  els: {
    clearUsage: els.clearUsage,
    clearStats: els.clearStats,
    usageSummary: els.usageSummary,
    usageMeta: els.usageMeta,
    usageTable: els.usageTable,
    statsSummary: els.statsSummary,
    statsMeta: els.statsMeta,
    statsTable: els.statsTable,
    statsGroupBy: els.statsGroupBy,
    statsIncludeWaitTime: els.statsIncludeWaitTime
  },
  tr,
  getUiLanguage: () => uiLanguage,
  getActivePage: () => activePage,
  getKeyboardCharsPerMinute: () => keyboardCharsPerMinute
});

const aboutSection = setupAboutSection({ els, tr });
const dictionaryEditor = setupDictionaryEditor({ els, tr, getUiLanguage: () => uiLanguage });
const recordingSession = (() => {
  let session: RecordingSession | null = null;

  const micLevelMeter = createMicLevelMeter({
    isActive: () => !!session && session.isRecording() && appStatus === 'recording',
    applyLevel: (level) => {
      applyMicLevelToDot(els.recordDot, level, { active: appStatus === 'recording' });
    },
    notifyLevel: (level) => {
      window.voiceInput.notifyRecordingLevel(level);
    }
  });

  const silenceAutoStop = createSilenceAutoStopController({
    getAutoStopSeconds: () => silenceAutoStopSeconds,
    resetSilenceProcessingMode: () => {
      activeSilenceProcessingMode = silenceProcessingMode;
    },
    isRecordingSession: () => !!session && session.isRecording(),
    stopRecording,
    tr
  });

  const warmAudioStreamManager = createWarmAudioStreamManager({ getGraceMs: getMicWarmGraceMs });
  const segmentResultsBuffer = createSegmentResultsBuffer({ appendText: appendResultText });

  session = createRecordingSession({
    getUiLanguage: () => uiLanguage,
    getSilenceProcessingMode: () => activeSilenceProcessingMode,
    getActivePage: () => activePage,
    tr,
    setStatus,
    getStatus: () => appStatus,
    getRecordingMaxSeconds: () => recordingMaxSeconds,
    getMicDeviceId: () => micDeviceId,
    setMicDeviceId: (deviceId) => {
      micDeviceId = deviceId;
    },
    getMicWarmGraceMs,
    micLevelMeter,
    silenceAutoStop,
    warmAudioStreamManager,
    segmentResultsBuffer,
    refreshUsage: () => statsUsage.refreshUsage(),
    refreshStats: () => statsUsage.refreshStats()
  });

  return session;
})();

function normalizeRecordingMaxSeconds(value: unknown): number {
  return normalizeRecordingMaxSecondsFromUi(value);
}

function normalizeSilenceAutoStopSeconds(value: unknown): number {
  return normalizeSilenceAutoStopSecondsFromUi(value);
}

function normalizeHistoryMaxItems(value: unknown): number {
  return normalizeHistoryMaxItemsFromUi(value);
}

function normalizeMemoPadEditorFontSizePx(value: unknown): number {
  return normalizeMemoPadEditorFontSizePxFromUi(value);
}

async function applyRecordingMaxSecondsFromUi(value: unknown): Promise<void> {
  const next = normalizeRecordingMaxSeconds(value);
  const res = await window.voiceInput.setRecordingMaxSeconds(next);
  if (!res.ok) return;
  recordingMaxSeconds = next;
  els.recordingMaxSeconds.value = String(recordingMaxSeconds);
  els.recordingMaxSecondsValue.textContent = String(recordingMaxSeconds);
  recordingSession.rescheduleLimitTimer();
}

async function applySilenceAutoStopSecondsFromUi(value: unknown): Promise<void> {
  const next = normalizeSilenceAutoStopSeconds(value);
  const res = await window.voiceInput.setSilenceAutoStopSeconds(next);
  if (!res.ok) return;
  silenceAutoStopSeconds = next;
  els.silenceAutoStopSeconds.value = String(silenceAutoStopSeconds);
  els.silenceAutoStopSecondsValue.textContent = String(silenceAutoStopSeconds);
  if (silenceAutoStopSeconds > 0) {
    LocalVadSession.preload();
  }
}

function applySettingsSnapshotToUi(settings: SettingsSnapshot, permissions: PermissionsSnapshot): void {
  lastSettingsSnapshot = settings;
  lastPermissions = permissions;
  appPlatform = permissions.platform;
  applyPlatformClasses(appPlatform);

  applyAccentColor(settings.accentColor);
  syncAccentColorControls(settings.accentColor);

  uiLanguage = settings.uiLanguage;
  els.uiLanguage.value = settings.uiLanguage;
  setUiLanguage(uiLanguage);
  applyI18n();
  document.title = `${tr('app.name')} - ${tr('prefs.title')}`;
  statsUsage.disarmResetButtons();

  const memoPadEditorFontSizePx = normalizeMemoPadEditorFontSizePx(settings.memoPadEditorFontSizePx);
  els.memoPadEditorFontSize.value = String(memoPadEditorFontSizePx);
  els.memoPadEditorFontSizeValue.textContent = String(memoPadEditorFontSizePx);

  els.themeMode.value = settings.themeMode;
  els.overlayPlacement.value = settings.overlayPlacement;
  els.overlayOffsetX.value = String(settings.overlayOffsetX);
  els.overlayOffsetY.value = String(settings.overlayOffsetY);
  setActiveHotkey(settings.hotkey);
  renderHotkeyDisplay(settings.hotkey);
  els.trayLeftClickAction.value = settings.trayLeftClickAction;
  els.updateCheckEnabled.checked = settings.updateCheckEnabled;

  els.language.value = settings.language;
  els.model.value = settings.model;

  recordingMaxSeconds = normalizeRecordingMaxSeconds(settings.recordingMaxSeconds);
  els.recordingMaxSeconds.value = String(recordingMaxSeconds);
  els.recordingMaxSecondsValue.textContent = String(recordingMaxSeconds);

  keyboardCharsPerMinute = settings.keyboardCharsPerMinute;
  els.keyboardCharsPerMinute.value = String(keyboardCharsPerMinute);

  silenceAutoStopSeconds = normalizeSilenceAutoStopSeconds(settings.silenceAutoStopSeconds);
  els.silenceAutoStopSeconds.value = String(silenceAutoStopSeconds);
  els.silenceAutoStopSecondsValue.textContent = String(silenceAutoStopSeconds);
  if (silenceAutoStopSeconds > 0) {
    LocalVadSession.preload();
  }

  micDeviceId = settings.micDeviceId;
  micWarmGraceSeconds = settings.micWarmGraceSeconds;
  silenceProcessingMode = settings.silenceProcessingMode;
  activeSilenceProcessingMode = silenceProcessingMode;

  setHotkeyStatus('');

  els.autoPaste.checked = settings.autoPaste;
  els.memoPadAutoMemo.checked = settings.memoPadAutoMemo;
  els.memoPadInsertAtCursor.checked = settings.memoPadInsertAtCursor;
  syncMemoPadInsertAtCursorAvailability(settings.memoPadAutoMemo);
  els.memoPadPersistText.checked = settings.memoPadPersistText;
  els.softStartOpenMemoPad.checked = settings.softStartOpenMemoPad;
  els.softStartOpenHistory.checked = settings.softStartOpenHistory;

  memoPadVisibleButtons = normalizeMemoPadVisibleButtons(settings.memoPadVisibleButtons);
  renderMemoPadButtonsEditor();

  els.translateEnabled.checked = settings.translationEnabled;
  els.translateTarget.value = settings.translationTarget;

  els.dictionaryEnabled.checked = settings.dictionaryEnabled;
  dictionaryEditor.init(settings.dictionaryRulesText);

  const historyMaxItems = normalizeHistoryMaxItems(settings.historyMaxItems);
  els.historyMaxItems.value = String(historyMaxItems);
  els.historyMaxItemsValue.textContent = String(historyMaxItems);

  renderApiKeyStatus(settings);

  if (permissions.platform === 'darwin') {
    els.accessibilityStatus.textContent = permissions.accessibilityTrusted ? tr('common.allowed') : tr('common.notAllowed');
    els.requestAccessibility.disabled = false;
    els.openAccessibility.disabled = false;
  } else {
    els.accessibilityStatus.textContent = tr('common.na');
    els.requestAccessibility.disabled = true;
    els.openAccessibility.disabled = true;
  }
}

function syncMemoPadInsertAtCursorAvailability(autoMemoEnabled: boolean): boolean {
  const shouldDisable = !autoMemoEnabled;
  els.memoPadInsertAtCursor.disabled = shouldDisable;
  els.memoPadInsertAtCursorRow.classList.toggle('avi-row-disabled', shouldDisable);
  if (shouldDisable && els.memoPadInsertAtCursor.checked) {
    els.memoPadInsertAtCursor.checked = false;
    return true;
  }
  return false;
}

function isAviPage(value: string): value is AviPage {
  return (
    value === 'main' ||
    value === 'pasteMemo' ||
    value === 'appearance' ||
    value === 'ai' ||
    value === 'dictionary' ||
    value === 'stats' ||
    value === 'usage' ||
    value === 'transfer' ||
    value === 'about'
  );
}

function normalizeAviPageFromHash(value: string): AviPage | null {
  if (value === 'history') return 'pasteMemo';
  if (value === 'voiceInput') return 'ai';
  if (value === 'shortcuts') return 'ai';
  if (value === 'language') return 'main';
  return isAviPage(value) ? value : null;
}

function setActivePage(page: AviPage, options: { updateHash?: boolean } = {}): void {
  // user-note: If we leave the current page while capturing a hotkey, the capture listener keeps swallowing
  // key events (preventDefault/stopPropagation) and breaks typing in other pages (e.g. dictionary inputs).
  if (isCapturingHotkey && page !== activePage) {
    stopHotkeyCapture(tr('prefs.shortcuts.capture.canceled'));
  }
  statsUsage.disarmResetButtons();
  const pages = Array.from(document.querySelectorAll<HTMLElement>('[data-avi-page]'));
  for (const pageEl of pages) {
    pageEl.classList.toggle('avi-page-active', pageEl.dataset.aviPage === page);
  }

  const navItems = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-avi-nav]'));
  for (const navEl of navItems) {
    navEl.classList.toggle('avi-nav-item-active', navEl.dataset.aviNav === page);
  }

  if (options.updateHash) {
    const desired = `#${page}`;
    if (location.hash !== desired) {
      location.hash = desired;
    }
  }

  activePage = page;
  if (page === 'dictionary') {
    void dictionaryEditor.refreshFromSettings();
  }
  if (page === 'stats') {
    void statsUsage.refreshStats();
  }
  if (page === 'about') {
    void aboutSection.refreshAbout();
  }
}

function setupPageNavigation(): void {
  const navItems = Array.from(document.querySelectorAll<HTMLButtonElement>('[data-avi-nav]'));
  for (const navEl of navItems) {
    navEl.addEventListener('click', () => {
      const page = navEl.dataset.aviNav;
      if (!page || !isAviPage(page)) return;
      setActivePage(page, { updateHash: true });
    });
  }

  window.addEventListener('hashchange', () => {
    const raw = location.hash.replace(/^#/, '');
    const next = normalizeAviPageFromHash(raw);
    if (!next) return;
    setActivePage(next, { updateHash: raw !== next });
  });

  const initial = location.hash.replace(/^#/, '');
  const normalized = normalizeAviPageFromHash(initial);
  if (normalized) {
    setActivePage(normalized, { updateHash: initial !== normalized });
  } else {
    setActivePage('main');
  }
}

function isMemoPadButtonId(value: string): value is MemoPadButtonId {
  return MEMO_PAD_BUTTON_ID_SET.has(value as MemoPadButtonId);
}

function normalizeMemoPadVisibleButtons(value: unknown): MemoPadButtonId[] {
  if (!Array.isArray(value)) return [...MEMO_PAD_BUTTON_ORDER];
  const next: MemoPadButtonId[] = [];
  for (const item of value) {
    if (typeof item !== 'string') continue;
    if (!isMemoPadButtonId(item)) continue;
    const id = item;
    if (next.includes(id)) continue;
    next.push(id);
  }
  return next;
}

function readSelectedMemoPadButtonIds(select: HTMLSelectElement): MemoPadButtonId[] {
  const ids: MemoPadButtonId[] = [];
  for (const option of Array.from(select.selectedOptions)) {
    const value = option.value;
    if (!isMemoPadButtonId(value)) continue;
    ids.push(value);
  }
  return ids;
}

function setSelectedMemoPadButtonIds(select: HTMLSelectElement, ids: MemoPadButtonId[]): void {
  const set = new Set(ids);
  for (const option of Array.from(select.options)) {
    option.selected = set.has(option.value as MemoPadButtonId);
  }
}

function updateMemoPadButtonsEditorControls(): void {
  const hiddenSelected = readSelectedMemoPadButtonIds(els.memoPadButtonsHidden);
  const visibleSelected = readSelectedMemoPadButtonIds(els.memoPadButtonsVisible);

  els.memoPadButtonsAdd.disabled = hiddenSelected.length === 0;
  els.memoPadButtonsRemove.disabled = visibleSelected.length === 0;

  if (visibleSelected.length === 0) {
    els.memoPadButtonsUp.disabled = true;
    els.memoPadButtonsDown.disabled = true;
    return;
  }

  const indices = visibleSelected
    .map((id) => memoPadVisibleButtons.indexOf(id))
    .filter((index) => index >= 0)
    .sort((a, b) => a - b);
  const minIndex = indices[0] ?? 0;
  const maxIndex = indices[indices.length - 1] ?? 0;
  els.memoPadButtonsUp.disabled = minIndex <= 0;
  els.memoPadButtonsDown.disabled = maxIndex >= memoPadVisibleButtons.length - 1;
}

function renderMemoPadButtonsEditor(): void {
  const selectedHidden = readSelectedMemoPadButtonIds(els.memoPadButtonsHidden);
  const selectedVisible = readSelectedMemoPadButtonIds(els.memoPadButtonsVisible);

  const hiddenButtons = MEMO_PAD_BUTTON_ORDER.filter((id) => !memoPadVisibleButtons.includes(id));

  els.memoPadButtonsHidden.innerHTML = '';
  for (const id of hiddenButtons) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = tr(MEMO_PAD_BUTTON_LABEL_KEYS[id] ?? 'common.settings');
    option.selected = selectedHidden.includes(id);
    els.memoPadButtonsHidden.appendChild(option);
  }

  els.memoPadButtonsVisible.innerHTML = '';
  for (const id of memoPadVisibleButtons) {
    const option = document.createElement('option');
    option.value = id;
    option.textContent = tr(MEMO_PAD_BUTTON_LABEL_KEYS[id] ?? 'common.settings');
    option.selected = selectedVisible.includes(id);
    els.memoPadButtonsVisible.appendChild(option);
  }

  updateMemoPadButtonsEditorControls();
}

async function persistMemoPadVisibleButtons(): Promise<void> {
  const res = await window.voiceInput.setMemoPadVisibleButtons(memoPadVisibleButtons);
  if (!res.ok) {
    console.error(res.error ?? 'Failed to save memo buttons');
  }
}

function setActiveHotkey(accelerator: string): void {
  activeHotkeyAccelerator = normalizeAccelerator(accelerator);
}

function getModifierKeysHint(platform: string): string {
  return platform === 'darwin' ? '⌘/⌥/⇧' : 'Ctrl/Alt/Shift';
}

function renderHotkeyDisplayTo(displayEl: HTMLElement, accelerator: string): string {
  displayEl.replaceChildren();

  const keycaps = getAcceleratorKeycaps(accelerator, appPlatform);
  if (keycaps.length === 0) {
    const empty = document.createElement('span');
    empty.className = 'avi-hotkey-empty';
    empty.textContent = '-';
    displayEl.appendChild(empty);
    return '-';
  }

  for (const label of keycaps) {
    const cap = document.createElement('span');
    cap.className = 'avi-keycap';
    cap.textContent = label;
    displayEl.appendChild(cap);
  }
  return keycaps.join('+');
}

function renderHotkeyDisplay(accelerator: string): void {
  renderHotkeyDisplayTo(els.hotkeyDisplay, accelerator);
}

function getUnsafeHotkeyReason(accelerator: string): string | null {
  const normalized = normalizeAccelerator(accelerator).toLowerCase();
  const common = new Set([
    'commandorcontrol+c',
    'commandorcontrol+v',
    'commandorcontrol+x',
    'commandorcontrol+z',
    'commandorcontrol+shift+z',
    'commandorcontrol+a',
    'commandorcontrol+s',
    'commandorcontrol+w',
    'commandorcontrol+q',
    'commandorcontrol+f',
    'commandorcontrol+space',
    'alt+tab',
    'commandorcontrol+tab'
  ]);
  if (common.has(normalized)) return tr('prefs.shortcuts.hotkey.unsafeCommon');
  return null;
}

type ShortcutStatusOptions = { autoClear?: boolean };

let hotkeyStatusTimer: number | null = null;
function setHotkeyStatus(message: string, options: ShortcutStatusOptions = {}): void {
  els.hotkeyStatus.textContent = message;
  if (hotkeyStatusTimer !== null) {
    window.clearTimeout(hotkeyStatusTimer);
    hotkeyStatusTimer = null;
  }
  if (!message || !options.autoClear) return;
  hotkeyStatusTimer = window.setTimeout(() => {
    hotkeyStatusTimer = null;
    els.hotkeyStatus.textContent = '';
  }, SHORTCUT_STATUS_AUTO_CLEAR_MS);
}

function renderApiKeyStatus(settings: SettingsSnapshot): void {
  if (!settings.hasApiKey) {
    els.keyStatus.textContent = tr('prefs.ai.apiKey.status.notSet');
    return;
  }
  if (settings.apiKeyStorage === 'plain' || !settings.secureStorageAvailable) {
    els.keyStatus.textContent = tr('prefs.ai.apiKey.status.savedInsecure');
    return;
  }
  els.keyStatus.textContent = tr('prefs.ai.apiKey.status.saved');
}

async function applyHotkey(accelerator: string): Promise<void> {
  const normalized = normalizeAccelerator(accelerator);
  if (!isUserConfigurableHotkeyAccelerator(normalized)) {
    setHotkeyStatus(tr('error.hotkey.invalid'));
    return;
  }
  if (isHotkeyConflictingWithFixedShortcuts(normalized)) {
    setHotkeyStatus(tr('error.hotkey.conflict'));
    return;
  }

  const unsafe = getUnsafeHotkeyReason(normalized);
  if (unsafe) {
    const display = formatAcceleratorForDisplay(normalized, appPlatform) || normalized;
    const ok = window.confirm(tr('prefs.shortcuts.hotkey.confirmUnsafe', { reason: unsafe, accelerator: display }));
    if (!ok) return;
  }

  const res = await window.voiceInput.setHotkey(normalized);
  if (!res.ok) {
    setHotkeyStatus(formatApiError(uiLanguage, res, 'prefs.shortcuts.status.cannotRegister'));
    return;
  }
  setActiveHotkey(normalized);
  renderHotkeyDisplay(normalized);
  setHotkeyStatus(tr('prefs.shortcuts.status.saved'), { autoClear: true });
}

function startHotkeyCapture(): void {
  if (isCapturingHotkey) return;
  isCapturingHotkey = true;

  els.changeHotkey.disabled = true;
  els.resetHotkey.disabled = true;
  els.hotkeyDisplay.classList.add('avi-hotkey-display-capturing');
  setHotkeyStatus(tr('prefs.shortcuts.capture.prompt'));

  hotkeyListener = (event: KeyboardEvent) => {
    event.preventDefault();
    event.stopPropagation();
    if (event.key === 'Escape') {
      stopHotkeyCapture(tr('prefs.shortcuts.capture.canceled'));
      return;
    }
    const accel = keyEventToAccelerator(event);
    if (!accel) {
      setHotkeyStatus(tr('prefs.shortcuts.capture.requireModifier', { keys: getModifierKeysHint(appPlatform) }));
      return;
    }
    const normalized = normalizeAccelerator(accel);
    if (!isUserConfigurableHotkeyAccelerator(normalized)) {
      setHotkeyStatus(tr('error.hotkey.invalid'));
      return;
    }
    if (isHotkeyConflictingWithFixedShortcuts(normalized)) {
      setHotkeyStatus(tr('error.hotkey.conflict'));
      return;
    }
    stopHotkeyCapture(tr('prefs.shortcuts.capture.setting'));
    void applyHotkey(normalized);
  };

  window.addEventListener('keydown', hotkeyListener, true);
}

function stopHotkeyCapture(message?: string): void {
  if (!isCapturingHotkey) return;
  isCapturingHotkey = false;
  els.changeHotkey.disabled = false;
  els.resetHotkey.disabled = false;
  els.hotkeyDisplay.classList.remove('avi-hotkey-display-capturing');
  if (hotkeyListener) {
    window.removeEventListener('keydown', hotkeyListener, true);
    hotkeyListener = null;
  }
  if (message) setHotkeyStatus(message);
}

function setStatus(next: AppStatus, message?: string): void {
  appStatus = next;
  if (next !== 'recording') {
    isPushToTalkMode = false;
  }
  switch (next) {
    case 'idle':
      if (els.status) els.status.textContent = message ?? tr('memo.status.idle');
      if (els.recordDot) els.recordDot.classList.remove('avi-dot-recording');
      if (els.recordLabel) els.recordLabel.textContent = tr('memo.record.start');
      break;
    case 'recording':
      if (els.status) els.status.textContent = message ?? tr('memo.status.recording');
      if (els.recordDot) els.recordDot.classList.add('avi-dot-recording');
      if (els.recordLabel) {
        els.recordLabel.textContent = isPushToTalkMode ? tr('memo.record.releaseToStop') : tr('memo.record.stop');
      }
      break;
    case 'transcribing':
      if (els.status) els.status.textContent = message ?? tr('memo.status.transcribing');
      if (els.recordDot) els.recordDot.classList.remove('avi-dot-recording');
      if (els.recordLabel) els.recordLabel.textContent = tr('memo.record.start');
      break;
    case 'error':
      if (els.status) els.status.textContent = message ?? tr('memo.status.error');
      if (els.recordDot) els.recordDot.classList.remove('avi-dot-recording');
      if (els.recordLabel) els.recordLabel.textContent = tr('memo.record.start');
      break;
  }

  if (els.cancel) els.cancel.disabled = !(next === 'recording' || next === 'transcribing');
  if (els.toggle) els.toggle.disabled = false;

  try {
    window.voiceInput.notifyRecordingState(next, next === 'error' ? message : undefined);
  } catch {
    // ignore
  }

  if (next !== 'recording') {
    notifyActiveMicrophone(null);
  }
}

function getMicWarmGraceMs(): number {
  const normalized = Number.isFinite(micWarmGraceSeconds) ? Math.max(0, Math.floor(micWarmGraceSeconds)) : 0;
  return normalized * 1000;
}

function appendResultText(text: string): void {
  if (!els.result) return;
  const trimmed = text.trim();
  if (!trimmed) return;
  const existing = els.result.value;
  if (!existing.trim()) {
    els.result.value = trimmed;
    return;
  }
  els.result.value = `${existing.trimEnd()}\n${trimmed}`;
}

async function startRecording(): Promise<void> {
  await recordingSession.start();
}

function stopRecording(message?: string): void {
  recordingSession.stop(message);
}

function cancelCurrent(): void {
  recordingSession.cancel();
}

async function toggleRecording(): Promise<void> {
  await recordingSession.toggle();
}

function setupRecordButtonHandlers(): void {
  if (!els.toggle) return;
  let longPressTimer: number | null = null;
  let isPushToTalk = false;

  const clickHandler = () => {
    if (isPushToTalk || longPressTimer !== null) return;
    void toggleRecording();
  };

  const startLongPress = () => {
    if (longPressTimer !== null) return;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      if (recordingSession.isRecording()) return;

      isPushToTalk = true;
      isPushToTalkMode = true;

      void (async () => {
        await startRecording();
        if (!recordingSession.isRecording()) {
          isPushToTalkMode = false;
          isPushToTalk = false;
        }
      })();
    }, PUSH_TO_TALK_THRESHOLD_MS);
  };

  const endLongPress = () => {
    if (longPressTimer !== null) {
      window.clearTimeout(longPressTimer);
      longPressTimer = null;
      return;
    }

    if (isPushToTalk && recordingSession.isRecording()) {
      isPushToTalkMode = false;
      stopRecording();
      window.setTimeout(() => {
        isPushToTalk = false;
      }, PUSH_TO_TALK_RESET_DELAY_MS);
    }
  };

  els.toggle.addEventListener('click', clickHandler);
  els.toggle.addEventListener('mousedown', (event) => {
    event.preventDefault();
    startLongPress();
  });
  els.toggle.addEventListener('mouseup', () => endLongPress());
  els.toggle.addEventListener('mouseleave', () => endLongPress());
  els.toggle.addEventListener('touchstart', (event) => {
    event.preventDefault();
    startLongPress();
  });
  els.toggle.addEventListener('touchend', (event) => {
    event.preventDefault();
    endLongPress();
  });
}

export async function initPreferences(): Promise<void> {
  setupPageNavigation();
  window.addEventListener('focus', () => {
    if (activePage !== 'dictionary') return;
    void dictionaryEditor.refreshFromSettings();
  });

  const settings = await window.voiceInput.getSettings();
  const permissions = await window.voiceInput.getPermissions();
  applySettingsSnapshotToUi(settings, permissions);
  listenForSystemThemeChanges();
  statsUsage.syncStatsControlsFromPreferences();
  statsUsage.setupEventListeners();
  if (activePage === 'stats') {
    void statsUsage.refreshStats();
  }
  void aboutSection.refreshAbout();

  window.voiceInput.onUiLanguageChanged((language) => {
    uiLanguage = language;
    els.uiLanguage.value = language;
    setUiLanguage(uiLanguage);
    applyI18n();
    document.title = `${tr('app.name')} - ${tr('prefs.title')}`;
    statsUsage.disarmResetButtons();
    renderMemoPadButtonsEditor();
    dictionaryEditor.render();

    if (lastSettingsSnapshot) {
      renderApiKeyStatus(lastSettingsSnapshot);
    }
    if (lastPermissions?.platform === 'darwin') {
      els.accessibilityStatus.textContent = lastPermissions.accessibilityTrusted ? tr('common.allowed') : tr('common.notAllowed');
    } else if (lastPermissions) {
      els.accessibilityStatus.textContent = tr('common.na');
    }

    if (activePage === 'usage') void statsUsage.refreshUsage();
    if (activePage === 'stats') void statsUsage.refreshStats();
  });

  window.voiceInput.onAccentColorChanged((accentColor) => {
    applyAccentColor(accentColor);
    if (lastSettingsSnapshot) {
      lastSettingsSnapshot = { ...lastSettingsSnapshot, accentColor };
    }
    syncAccentColorControls(accentColor);
  });

  setupApiKeyPreferences({ els, getUiLanguage: () => uiLanguage, renderApiKeyStatus });

  setupLanguagePreferences({ els });
  setupAppearancePreferences({ els, applyAccentColor, syncAccentColorControls });
  aboutSection.setupExternalLinkHandlers();
  aboutSection.setupUpdateCheckHandler();
  setupRecordingPreferences({
    els,
    defaultRecordingMaxSeconds: DEFAULT_RECORDING_MAX_SECONDS,
    getActivePage: () => activePage,
    refreshStats: statsUsage.refreshStats,
    normalizeRecordingMaxSeconds,
    applyRecordingMaxSecondsFromUi,
    applySilenceAutoStopSecondsFromUi,
    setKeyboardCharsPerMinute: (next) => {
      keyboardCharsPerMinute = next;
    }
  });
  setupShortcutPreferences({
    els,
    defaultHotkey: DEFAULT_HOTKEY,
    startHotkeyCapture,
    stopHotkeyCapture: () => stopHotkeyCapture(),
    applyHotkey
  });
  setupMemoPadPreferences({
    els,
    syncMemoPadInsertAtCursorAvailability: (autoMemoEnabled) => {
      syncMemoPadInsertAtCursorAvailability(autoMemoEnabled);
    }
  });
  setupMemoPadButtonsPreferences({
    els,
    defaultMemoPadVisibleButtons: MEMO_PAD_BUTTON_ORDER,
    getMemoPadVisibleButtons: () => memoPadVisibleButtons,
    setMemoPadVisibleButtons: (next) => {
      memoPadVisibleButtons = next;
    },
    readSelectedMemoPadButtonIds,
    setSelectedMemoPadButtonIds,
    renderMemoPadButtonsEditor,
    updateMemoPadButtonsEditorControls,
    persistMemoPadVisibleButtons
  });

  setupAccessibilityPreferences({ els, getUiLanguage: () => uiLanguage, tr });
  setupTranslationPreferences({ els });
  setupDictionaryPreferences({
    els,
    getUiLanguage: () => uiLanguage,
    tr,
    setDictionaryStatus: dictionaryEditor.setStatus,
    addDictionaryReplaceRule: dictionaryEditor.addReplaceRule,
    addDictionaryProtectRule: dictionaryEditor.addProtectRule
  });

  setupHistoryPreferences({ els });

  setupAppDataTransfer({
    els,
    getUiLanguage: () => uiLanguage,
    tr,
    getActivePage: () => activePage,
    refreshUsage: statsUsage.refreshUsage,
    refreshStats: statsUsage.refreshStats,
    applySettingsSnapshotToUi
  });

  setupRecordButtonHandlers();

  if (els.cancel) {
    els.cancel.addEventListener('click', () => {
      cancelCurrent();
    });
  }

  window.voiceInput.onSettingsChanged((next) => {
    els.autoPaste.checked = next.autoPaste;
    els.memoPadAutoMemo.checked = next.memoPadAutoMemo;
    els.memoPadInsertAtCursor.checked = next.memoPadInsertAtCursor;
    syncMemoPadInsertAtCursorAvailability(next.memoPadAutoMemo);
    els.translateEnabled.checked = next.translationEnabled;
    els.translateTarget.value = next.translationTarget;

    const memoPadEditorFontSizePx = normalizeMemoPadEditorFontSizePx(next.memoPadEditorFontSizePx);
    els.memoPadEditorFontSize.value = String(memoPadEditorFontSizePx);
    els.memoPadEditorFontSizeValue.textContent = String(memoPadEditorFontSizePx);
  });

  window.voiceInput.onToggleRecording(() => {
    void toggleRecording();
  });

  window.voiceInput.onStartRecording(() => {
    void startRecording();
  });

  window.voiceInput.onStopRecording(() => {
    stopRecording();
  });

  window.voiceInput.onCancelRecording(() => {
    cancelCurrent();
  });

  window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (isCapturingHotkey) return;

      const accel = keyEventToAccelerator(event);
      if (!accel) return;
      if (normalizeAccelerator(accel).toLowerCase() !== activeHotkeyAccelerator.toLowerCase()) return;
      if (event.repeat) return;

      event.preventDefault();
      isPushToTalkMode = false;
      if (recordingSession.isRecording()) {
        stopRecording();
        return;
      }
      void startRecording();
    },
    true
  );

  window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (isCapturingHotkey) return;
      if (appStatus !== 'recording' && appStatus !== 'transcribing') return;
      if (event.isComposing) return;
      const accel = keyEventToAccelerator(event);
      if (!accel) return;
      if (normalizeAccelerator(accel).toLowerCase() !== FIXED_CANCEL_HOTKEY.toLowerCase()) return;
      if (event.repeat) return;
      event.preventDefault();
      cancelCurrent();
    },
    true
  );

  if (els.copy) {
    els.copy.addEventListener(
      'click',
      voidAsync(async () => {
        if (!els.result) return;
        const text = els.result.value;
        if (!text) return;
        await navigator.clipboard.writeText(text);
      })
    );
  }

  if (els.clear) {
    els.clear.addEventListener('click', () => {
      if (!els.result) return;
      els.result.value = '';
    });
  }

  navigator.mediaDevices?.addEventListener?.('devicechange', () => {
    void refreshAudioInputDevices();
  });
  await refreshAudioInputDevices();

  await statsUsage.refreshUsage();
  setStatus('idle');
}
