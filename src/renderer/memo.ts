import { type TranscriptionLanguage, type UiLanguage } from '../shared/types';
import { getTranscriptionLanguageLabel, t, type UiStringKey } from '../shared/i18n';
import { formatApiError } from '../shared/apiError';
import {
  FIXED_MEMO_FIND_HOTKEY,
  FIXED_MEMO_REPLACE_HOTKEY,
  keyEventToAccelerator,
  normalizeAccelerator,
  PUSH_TO_TALK_THRESHOLD_MS
} from '../shared/hotkey';
import {
  DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX,
  normalizeMemoPadEditorFontSizePxFromUi
} from '../shared/settingsConstraints';
import { applyMicLevelToDot, clamp01 } from './micLevel';
import { applyAccentColor } from './accentColor';
import { applyI18n, setUiLanguage } from './i18n';
import { setupMemoButtons } from './memo/buttons';
import { setupMemoFindReplace } from './memo/findReplace';
import { setupMemoState } from './memo/state';
import { setupMemoUndo } from './memo/undo';
import type { SettingsChangedPayload } from './voiceInputApi';

type RecordingState = 'idle' | 'recording' | 'transcribing' | 'error';

type MemoTextState = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
};

const RECORD_BUTTON_LABEL_CANDIDATES = Array.from(
  new Set(
    (['ja', 'en', 'zh-hans', 'zh-hant', 'ko'] as const).flatMap((language) => [
      t(language, 'memo.record.start'),
      t(language, 'memo.record.stop'),
      t(language, 'memo.record.releaseToStop')
    ])
  )
);
const MEMO_TRANSLATE_MENU_LANGUAGES: TranscriptionLanguage[] = [
  'en',
  'es',
  'pt',
  'fr',
  'de',
  'it',
  'pl',
  'nl',
  'sv',
  'da',
  'no',
  'id',
  'ms',
  'ro',
  'ru',
  'uk',
  'vi',
  'tr',
  'th',
  'ko',
  'ja',
  'zh-hans',
  'zh-hant'
];

const IS_MAC = /Mac/.test(navigator.platform);
const IS_WINDOWS = /Win/.test(navigator.platform);
const HAS_NATIVE_TITLEBAR = IS_MAC || IS_WINDOWS;
if (IS_MAC) {
  document.documentElement.classList.add('avi-platform-mac');
}
if (IS_WINDOWS) {
  document.documentElement.classList.add('avi-platform-windows');
}
if (HAS_NATIVE_TITLEBAR) {
  document.documentElement.classList.add('avi-has-native-titlebar');
}

const els = {
  actions: document.querySelector('.avi-memo-actions') as HTMLDivElement,
  toggle: document.getElementById('toggle') as HTMLButtonElement,
  cancel: document.getElementById('cancel') as HTMLButtonElement,
  translate: document.getElementById('translate') as HTMLButtonElement,
  cut: document.getElementById('cut') as HTMLButtonElement,
  copy: document.getElementById('copy') as HTMLButtonElement,
  clear: document.getElementById('clear') as HTMLButtonElement,
  history: document.getElementById('history') as HTMLButtonElement,
  settings: document.getElementById('settings') as HTMLButtonElement,
  overflow: document.getElementById('memoOverflow') as HTMLButtonElement,
  overflowMenu: document.getElementById('memoOverflowMenu') as HTMLDivElement,
  translateMenu: document.getElementById('memoTranslateMenu') as HTMLDivElement,
  memoButtons: document.getElementById('memoButtons') as HTMLDivElement,
  autoPasteWrap: document.getElementById('autoPasteWrap') as HTMLLabelElement,
  autoPaste: document.getElementById('autoPaste') as HTMLInputElement,
  autoMemoWrap: document.getElementById('autoMemoWrap') as HTMLLabelElement,
  autoMemo: document.getElementById('autoMemo') as HTMLInputElement,
  insertAtCursorWrap: document.getElementById('insertAtCursorWrap') as HTMLLabelElement,
  insertAtCursor: document.getElementById('insertAtCursor') as HTMLInputElement,
  pinWrap: document.getElementById('pinWrap') as HTMLLabelElement,
  pin: document.getElementById('pin') as HTMLInputElement,
  gutter: document.getElementById('memoGutter') as HTMLDivElement,
  lineNumbers: document.getElementById('memoLineNumbers') as HTMLDivElement,
  text: document.getElementById('memoText') as HTMLTextAreaElement,
  hint: document.getElementById('memoHint') as HTMLDivElement,
  status: document.getElementById('status') as HTMLDivElement,
  recordDot: document.getElementById('recordDot') as HTMLSpanElement,
  recordLabel: document.getElementById('recordLabel') as HTMLSpanElement,
  findBar: document.getElementById('memoFindBar') as HTMLDivElement,
  findQuery: document.getElementById('memoFindQuery') as HTMLInputElement,
  findPrev: document.getElementById('memoFindPrev') as HTMLButtonElement,
  findNext: document.getElementById('memoFindNext') as HTMLButtonElement,
  findClose: document.getElementById('memoFindClose') as HTMLButtonElement,
  replaceRow: document.getElementById('memoReplaceRow') as HTMLDivElement,
  replaceText: document.getElementById('memoReplaceText') as HTMLInputElement,
  replaceOne: document.getElementById('memoReplaceOne') as HTMLButtonElement,
  replaceAll: document.getElementById('memoReplaceAll') as HTMLButtonElement,
  findStatus: document.getElementById('memoFindStatus') as HTMLDivElement
};


let uiLanguage: UiLanguage = 'en';
let didApplyUiLanguage = false;
let recordingState: RecordingState = 'idle';
let recordingErrorMessage: string | undefined;
let isTranslating = false;
let translationEnabled = false;
let isPushToTalkMode = false;
let memoPadInsertAtCursor = false;
let activeHotkeyAccelerator = 'CommandOrControl+F12';
const activeMemoFindHotkeyAccelerator = FIXED_MEMO_FIND_HOTKEY;
const activeMemoReplaceHotkeyAccelerator = FIXED_MEMO_REPLACE_HOTKEY;
let memoSaveTimer: number | null = null;
let memoSaveLastSentText: string | null = null;
let recordingLevel = 0;
let gutterSelecting = false;
let gutterSelectionStartLine: number | null = null;
let gutterLineEndOffsets: number[] = [];
let measureEl: HTMLDivElement | null = null;
let measureStyleKey: string | null = null;
let lastKnownTextState: MemoTextState | null = null;
let lineNumbersUpdateTimer: number | null = null;
let isPointerDown = false;
let lastPointerDownAt = 0;
let lastPointerDownButton: number | null = null;
let pendingFocusRefresh = false;
let focusRefreshTimer: number | null = null;
let settingsMutationChain: Promise<void> = Promise.resolve();
let lastTranslateTarget: TranscriptionLanguage = 'en';
let baseWindowTitle = document.title || t('en', 'app.name');
let isMemoTranslateMenuOpen = false;
let memoTranslateMenuOpenPoint: { x: number; y: number } | null = null;
let memoTranslateMenuRestoreFocusTarget: HTMLElement | null = null;
let memoPadEditorFontSizePx = DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX;
let memoPadEditorFontSizeFrame: number | null = null;

function tr(key: UiStringKey, params?: Record<string, string | number>): string {
  return t(uiLanguage, key, params);
}

const memoButtons = setupMemoButtons({
  els: {
    memoButtons: els.memoButtons,
    toggle: els.toggle,
    cancel: els.cancel,
    translate: els.translate,
    cut: els.cut,
    copy: els.copy,
    clear: els.clear,
    history: els.history,
    settings: els.settings,
    overflow: els.overflow,
    overflowMenu: els.overflowMenu,
    autoPasteWrap: els.autoPasteWrap,
    autoPaste: els.autoPaste,
    autoMemoWrap: els.autoMemoWrap,
    autoMemo: els.autoMemo,
    insertAtCursorWrap: els.insertAtCursorWrap,
    insertAtCursor: els.insertAtCursor,
    pinWrap: els.pinWrap
  },
  tr,
  setupPointerClickButton,
  toggleCheckboxInput
});

const memoUndo = setupMemoUndo({
  text: els.text,
  getMemoTextState,
  getLastKnownTextState: () => lastKnownTextState,
  setLastKnownTextState: (value) => {
    lastKnownTextState = value;
  },
  afterUndoRedo: () => {
    scheduleLineNumbersUpdate();
    scheduleMemoSave();
    setRecordingState(recordingState);
  }
});

const memoState = setupMemoState({
  els: {
    autoMemo: els.autoMemo,
    insertAtCursor: els.insertAtCursor
  },
  applyAutoPasteSettings,
  updateAutoMemoUi,
  setMemoPadInsertAtCursor: (value) => {
    memoPadInsertAtCursor = value;
  },
  setMemoPadUndoMaxSteps: memoUndo.setMemoPadUndoMaxSteps,
  setTranslationEnabled: (value) => {
    translationEnabled = value;
  },
  setLastTranslateTarget: (value) => {
    lastTranslateTarget = value;
  },
  setTranslateButtonLabel,
  updateTranslateUi,
  updateAutoMemoHint
});

function updateTranslateUi(): void {
  els.translate.classList.toggle('avi-memo-icon-active', translationEnabled);
}

function setStatusText(text: string): void {
  els.status.textContent = text;
  const normalized = text.trim();
  document.title = normalized ? `${baseWindowTitle} - ${normalized}` : baseWindowTitle;
}

function applyUiLanguage(language: UiLanguage): void {
  if (uiLanguage === language && didApplyUiLanguage) return;
  uiLanguage = language;
  didApplyUiLanguage = true;
  setUiLanguage(uiLanguage);
  applyI18n();
  baseWindowTitle = tr('app.name');
  setTranslateButtonLabel(lastTranslateTarget);
  setRecordingState(recordingState);
  updateAutoMemoHint();
  memoButtons.scheduleMemoButtonsOverflowUpdate();
}

function setTranslateButtonLabel(target: TranscriptionLanguage): void {
  const language = getTranscriptionLanguageLabel(uiLanguage, target);
  els.translate.textContent = tr('memo.translateTo', { language });
}

function schedulePendingFocusRefresh(): void {
  if (!pendingFocusRefresh) return;
  if (focusRefreshTimer !== null) return;
  focusRefreshTimer = window.setTimeout(() => {
    focusRefreshTimer = null;
    if (!pendingFocusRefresh) return;
    if (isPointerDown) return;
    pendingFocusRefresh = false;
    void refreshControlsFromSettings();
  }, 0);
}

function enqueueSettingsMutation(promise: Promise<unknown>): void {
  settingsMutationChain = settingsMutationChain.then(() => promise).then(
    () => {},
    () => {}
  );
}

function ensureMeasureElement(): HTMLDivElement {
  if (measureEl) return measureEl;
  const el = document.createElement('div');
  el.setAttribute('aria-hidden', 'true');
  el.style.position = 'absolute';
  el.style.visibility = 'hidden';
  el.style.pointerEvents = 'none';
  el.style.top = '0';
  el.style.left = '-99999px';
  el.style.whiteSpace = 'pre-wrap';
  el.style.wordBreak = 'break-word';
  el.style.overflowWrap = 'anywhere';
  el.style.padding = '0';
  el.style.margin = '0';
  el.style.border = '0';
  el.style.boxSizing = 'border-box';
  document.body.appendChild(el);
  measureEl = el;
  return el;
}

function getLineCount(text: string): number {
  let count = 1;
  for (let i = 0; i < text.length; i++) {
    if (text.charCodeAt(i) === 10) count += 1;
  }
  return count;
}

function getLineHeightPx(): number {
  const computed = getComputedStyle(els.text);
  const raw = computed.lineHeight;
  if (raw.endsWith('px')) {
    const parsed = Number.parseFloat(raw);
    if (Number.isFinite(parsed) && parsed > 0) return parsed;
  }
  const fontSize = Number.parseFloat(computed.fontSize);
  if (Number.isFinite(fontSize) && fontSize > 0) return fontSize * 1.4;
  return 18;
}

function configureMeasureElement(innerWidthPx: number): HTMLDivElement {
  const el = ensureMeasureElement();
  const computed = getComputedStyle(els.text);
  const nextKey = `${Math.round(innerWidthPx)}|${computed.fontFamily}|${computed.fontSize}|${computed.fontWeight}|${computed.fontStyle}|${computed.letterSpacing}|${computed.lineHeight}`;
  if (nextKey !== measureStyleKey) {
    measureStyleKey = nextKey;
    el.style.width = `${Math.max(1, Math.floor(innerWidthPx))}px`;
    el.style.fontFamily = computed.fontFamily;
    el.style.fontSize = computed.fontSize;
    el.style.fontWeight = computed.fontWeight;
    el.style.fontStyle = computed.fontStyle;
    el.style.letterSpacing = computed.letterSpacing;
    el.style.lineHeight = computed.lineHeight;
  }
  return el;
}

function getTextareaInnerWidthPx(): number {
  const computed = getComputedStyle(els.text);
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const paddingRight = Number.parseFloat(computed.paddingRight) || 0;
  return Math.max(1, els.text.clientWidth - paddingLeft - paddingRight);
}

function measureVisualLineCount(text: string, lineHeightPx: number, measure: HTMLDivElement): number {
  measure.textContent = text.length > 0 ? text : ' ';
  const rect = measure.getBoundingClientRect();
  const height = rect.height;
  if (!Number.isFinite(height) || height <= 0) return 1;
  return Math.max(1, Math.ceil(height / lineHeightPx - 0.01));
}

function getLineFromGutterPoint(clientX: number, clientY: number): number | null {
  const rect = els.gutter.getBoundingClientRect();
  if (clientX < rect.left || clientX > rect.right) return null;

  const paddingTop = Number.parseFloat(getComputedStyle(els.gutter).paddingTop) || 0;
  const y = clientY - rect.top + els.gutter.scrollTop - paddingTop;
  const normalizedY = Number.isFinite(y) ? Math.max(0, y) : 0;

  const ends = gutterLineEndOffsets;
  const lineCount = ends.length > 1 ? ends.length - 1 : getLineCount(els.text.value);
  if (lineCount <= 1) return 1;

  if (ends.length > 1) {
    const maxY = ends[lineCount] ?? 0;
    if (normalizedY >= maxY) return lineCount;

    let lo = 1;
    let hi = lineCount;
    while (lo < hi) {
      const mid = Math.floor((lo + hi) / 2);
      if (normalizedY < (ends[mid] ?? 0)) {
        hi = mid;
      } else {
        lo = mid + 1;
      }
    }
    return lo;
  }

  const lineHeight = getLineHeightPx();
  const candidate = Math.floor(normalizedY / lineHeight) + 1;
  return Math.max(1, Math.min(lineCount, candidate));
}

function getLineStartIndex(text: string, lineNumber: number): number {
  if (lineNumber <= 1) return 0;
  let index = 0;
  let current = 1;
  while (current < lineNumber) {
    const next = text.indexOf('\n', index);
    if (next === -1) return text.length;
    index = next + 1;
    current += 1;
  }
  return index;
}

function getLineEndIndex(text: string, lineNumber: number): number {
  const start = getLineStartIndex(text, lineNumber);
  const next = text.indexOf('\n', start);
  if (next === -1) return text.length;
  return next + 1;
}

function selectLineRange(lineA: number, lineB: number): void {
  const startLine = Math.min(lineA, lineB);
  const endLine = Math.max(lineA, lineB);
  const text = els.text.value;
  const start = getLineStartIndex(text, startLine);
  const end = getLineEndIndex(text, endLine);
  els.text.focus();
  els.text.setSelectionRange(start, end);
}

function syncGutterScroll(): void {
  els.gutter.scrollTop = els.text.scrollTop;
}

function updateLineNumbers(): void {
  const raw = els.text.value;
  const lines = raw.split('\n');
  const lineCount = lines.length;

  const digits = Math.max(2, String(lineCount).length);
  els.gutter.style.setProperty('--avi-memo-gutter-width', `calc(${digits}ch + 18px)`);

  const lineHeightPx = getLineHeightPx();
  const innerWidthPx = getTextareaInnerWidthPx();
  const measure = configureMeasureElement(innerWidthPx);

  const frag = document.createDocumentFragment();
  const ends = new Array<number>(lineCount + 1);
  ends[0] = 0;
  let y = 0;

  for (let i = 0; i < lineCount; i++) {
    const lineNumber = i + 1;
    const text = lines[i] ?? '';
    const visualLines = measureVisualLineCount(text, lineHeightPx, measure);
    const heightPx = visualLines * lineHeightPx;
    y += heightPx;
    ends[lineNumber] = y;

    const btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'avi-memo-line-number';
    btn.textContent = String(lineNumber);
    btn.tabIndex = -1;
    btn.style.height = `${heightPx}px`;
    btn.style.lineHeight = `${lineHeightPx}px`;
    frag.appendChild(btn);
  }

  gutterLineEndOffsets = ends;
  els.lineNumbers.replaceChildren(frag);
  syncGutterScroll();
  positionAutoMemoHint();
}

function scheduleLineNumbersUpdate(): void {
  if (lineNumbersUpdateTimer !== null) return;
  lineNumbersUpdateTimer = window.setTimeout(() => {
    lineNumbersUpdateTimer = null;
    updateLineNumbers();
  }, 50);
}

function stopGutterSelection(): void {
  if (!gutterSelecting) return;
  gutterSelecting = false;
  gutterSelectionStartLine = null;
  window.removeEventListener('mousemove', handleGutterMouseMove);
}

function handleGutterMouseMove(event: MouseEvent): void {
  if (!gutterSelecting || gutterSelectionStartLine === null) return;
  const line = getLineFromGutterPoint(event.clientX, event.clientY);
  if (!line) return;
  selectLineRange(gutterSelectionStartLine, line);
}

function updateRecordingDot(): void {
  applyMicLevelToDot(els.recordDot, recordingLevel, { active: recordingState === 'recording' });
}

function lockRecordButtonWidth(): void {
  const button = els.toggle;
  const parent = button.parentElement;
  if (!parent) return;

  const widths: number[] = [];

  for (const label of RECORD_BUTTON_LABEL_CANDIDATES) {
    const cloneNode = button.cloneNode(true);
    if (!(cloneNode instanceof HTMLButtonElement)) continue;
    const clone = cloneNode;
    const cloneLabel = clone.querySelector<HTMLSpanElement>('#recordLabel');
    if (cloneLabel) cloneLabel.textContent = label;

    clone.removeAttribute('id');
    for (const el of Array.from(clone.querySelectorAll('[id]'))) {
      el.removeAttribute('id');
    }

    clone.classList.add('avi-offscreen-measure');

    parent.appendChild(clone);
    widths.push(clone.getBoundingClientRect().width);
    clone.remove();
  }

  const maxWidth = Math.max(...widths);
  if (!Number.isFinite(maxWidth) || maxWidth <= 0) return;
  button.style.minWidth = `${Math.ceil(maxWidth)}px`;
}

function scheduleMemoSave(): void {
  if (memoSaveTimer !== null) {
    window.clearTimeout(memoSaveTimer);
  }
  memoSaveTimer = window.setTimeout(() => {
    memoSaveTimer = null;
    const next = els.text.value;
    if (memoSaveLastSentText === next) return;
    memoSaveLastSentText = next;
    void window.voiceInput.setMemoPadText(next);
  }, 300);
}

function flushMemoSave(force = false): void {
  if (memoSaveTimer !== null) {
    window.clearTimeout(memoSaveTimer);
    memoSaveTimer = null;
  }
  if (force) memoSaveLastSentText = null;
  const next = els.text.value;
  if (memoSaveLastSentText === next) return;
  memoSaveLastSentText = next;
  void window.voiceInput.setMemoPadText(next);
}

function getMemoTextState(): MemoTextState {
  const value = els.text.value;
  const selectionStart = typeof els.text.selectionStart === 'number' ? els.text.selectionStart : 0;
  const selectionEnd = typeof els.text.selectionEnd === 'number' ? els.text.selectionEnd : selectionStart;
  return {
    value,
    selectionStart,
    selectionEnd,
    scrollTop: els.text.scrollTop
  };
}

function syncLastKnownCursorAndScroll(): void {
  if (!lastKnownTextState) {
    lastKnownTextState = getMemoTextState();
    return;
  }
  const selectionStart = typeof els.text.selectionStart === 'number' ? els.text.selectionStart : 0;
  const selectionEnd = typeof els.text.selectionEnd === 'number' ? els.text.selectionEnd : selectionStart;
  lastKnownTextState = {
    ...lastKnownTextState,
    selectionStart,
    selectionEnd,
    scrollTop: els.text.scrollTop
  };
}

function dispatchTextInputEvent(): void {
  memoUndo.beforeDispatchTextInputEvent();
  els.text.dispatchEvent(new Event('input', { bubbles: true }));
}

function setRecordingState(next: RecordingState, message?: string): void {
  recordingState = next;
  els.toggle.classList.toggle('avi-record-recording', next === 'recording');
  els.toggle.classList.toggle('avi-record-transcribing', next === 'transcribing');
  if (next === 'error') {
    const trimmed = typeof message === 'string' ? message.trim() : '';
    if (trimmed) {
      recordingErrorMessage = trimmed.length > 200 ? `${trimmed.slice(0, 200).trimEnd()}…` : trimmed;
    }
  } else {
    recordingErrorMessage = undefined;
  }
  if (next !== 'recording') {
    isPushToTalkMode = false;
  }
  switch (next) {
    case 'idle':
      setStatusText(tr('memo.status.idle'));
      els.recordDot.classList.remove('avi-dot-recording', 'avi-dot-transcribing');
      els.recordLabel.textContent = tr('memo.record.start');
      break;
    case 'recording':
      setStatusText(tr('memo.status.recording'));
      els.recordDot.classList.add('avi-dot-recording');
      els.recordDot.classList.remove('avi-dot-transcribing');
      els.recordLabel.textContent = isPushToTalkMode ? tr('memo.record.releaseToStop') : tr('memo.record.stop');
      break;
    case 'transcribing':
      setStatusText(tr('memo.status.transcribing'));
      els.recordDot.classList.remove('avi-dot-recording');
      els.recordDot.classList.add('avi-dot-transcribing');
      els.recordLabel.textContent = tr('memo.record.start');
      break;
    case 'error':
      setStatusText(recordingErrorMessage ?? tr('memo.status.error'));
      els.recordDot.classList.remove('avi-dot-recording', 'avi-dot-transcribing');
      els.recordLabel.textContent = tr('memo.record.start');
      break;
  }

  updateRecordingDot();
  els.toggle.disabled = isTranslating;
  els.cancel.disabled = !(next === 'recording' || next === 'transcribing') || isTranslating;
  els.translate.disabled = !els.text.value.trim() || isTranslating;
}

function setupRecordButtonHandlers(): void {
  let longPressTimer: number | null = null;
  let isPushToTalk = false;
  let activePointerId: number | null = null;
  let ignoreClick = false;

  const resetIgnoreClickSoon = () => {
    window.setTimeout(() => {
      ignoreClick = false;
    }, 0);
  };

  const clearLongPressTimer = () => {
    if (longPressTimer === null) return;
    window.clearTimeout(longPressTimer);
    longPressTimer = null;
  };

  const clickHandler = () => {
    if (ignoreClick) return;
    if (isPushToTalk || longPressTimer !== null) return;
    void window.voiceInput.toggleRecording();
  };

  const startLongPress = () => {
    if (longPressTimer !== null) return;
    longPressTimer = window.setTimeout(() => {
      longPressTimer = null;
      if (recordingState === 'recording') return;

      isPushToTalk = true;
      isPushToTalkMode = true;
      void window.voiceInput.startRecording();
    }, PUSH_TO_TALK_THRESHOLD_MS);
  };

  const stopPushToTalkIfNeeded = () => {
    if (!isPushToTalk) return false;
    isPushToTalk = false;
    isPushToTalkMode = false;
    void window.voiceInput.stopRecording();
    return true;
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (event.button !== 0) return;
    if (!event.isPrimary) return;
    if (activePointerId !== null) return;
    // user-note: Keep focus on the memo textarea so the caret stays visible and insert-at-cursor keeps working.
    event.preventDefault();
    activePointerId = event.pointerId;
    ignoreClick = true;
    try {
      els.toggle.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
    startLongPress();
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    clearLongPressTimer();
    const didStopPushToTalk = stopPushToTalkIfNeeded();
    if (!didStopPushToTalk) {
      void window.voiceInput.toggleRecording();
    }
    resetIgnoreClickSoon();
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    clearLongPressTimer();
    stopPushToTalkIfNeeded();
    ignoreClick = false;
  };

  els.toggle.addEventListener('click', clickHandler);
  els.toggle.addEventListener('pointerdown', handlePointerDown);
  els.toggle.addEventListener('pointerup', handlePointerUp);
  els.toggle.addEventListener('pointercancel', handlePointerCancel);
  els.toggle.addEventListener('lostpointercapture', handlePointerCancel);
}

function setupPointerClickButton(button: HTMLButtonElement, onActivate: () => void): void {
  let activePointerId: number | null = null;
  let ignoreClick = false;

  const resetIgnoreClickSoon = () => {
    window.setTimeout(() => {
      ignoreClick = false;
    }, 0);
  };

  const clickHandler = () => {
    if (ignoreClick) return;
    if (button.disabled) return;
    onActivate();
  };

  const handlePointerDown = (event: PointerEvent) => {
    if (button.disabled) return;
    if (event.button !== 0) return;
    if (!event.isPrimary) return;
    if (activePointerId !== null) return;
    // user-note: Keep focus on the memo textarea so the caret stays visible and insert-at-cursor keeps working.
    event.preventDefault();
    activePointerId = event.pointerId;
    ignoreClick = true;
    try {
      button.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    if (!button.disabled) onActivate();
    resetIgnoreClickSoon();
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    ignoreClick = false;
  };

  button.addEventListener('click', clickHandler);
  button.addEventListener('pointerdown', handlePointerDown);
  button.addEventListener('pointerup', handlePointerUp);
  button.addEventListener('pointercancel', handlePointerCancel);
  button.addEventListener('lostpointercapture', handlePointerCancel);
}

function setupPointerToggleLabel(label: HTMLLabelElement, input: HTMLInputElement): void {
  let activePointerId: number | null = null;

  label.addEventListener('click', (event) => {
    event.preventDefault();
  });

  const handlePointerDown = (event: PointerEvent) => {
    if (input.disabled) return;
    if (event.button !== 0) return;
    if (!event.isPrimary) return;
    if (activePointerId !== null) return;
    // user-note: Keep focus on the memo textarea so the caret stays visible and insert-at-cursor keeps working.
    event.preventDefault();
    activePointerId = event.pointerId;
    try {
      label.setPointerCapture(event.pointerId);
    } catch {
      // ignore
    }
  };

  const handlePointerUp = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
    if (input.disabled) return;
    input.checked = !input.checked;
    input.dispatchEvent(new Event('change', { bubbles: true }));
  };

  const handlePointerCancel = (event: PointerEvent) => {
    if (activePointerId !== event.pointerId) return;
    activePointerId = null;
  };

  label.addEventListener('pointerdown', handlePointerDown);
  label.addEventListener('pointerup', handlePointerUp);
  label.addEventListener('pointercancel', handlePointerCancel);
  label.addEventListener('lostpointercapture', handlePointerCancel);
}

function toggleCheckboxInput(input: HTMLInputElement): void {
  if (input.disabled) return;
  input.checked = !input.checked;
  input.dispatchEvent(new Event('change', { bubbles: true }));
}

function appendText(text: string): void {
  const trimmed = text.trim();
  if (!trimmed) return;
  syncLastKnownCursorAndScroll();
  const existing = els.text.value;
  if (!existing.trim()) {
    els.text.value = trimmed;
    els.text.scrollTop = els.text.scrollHeight;
    dispatchTextInputEvent();
    setRecordingState(recordingState);
    return;
  }
  els.text.value = `${existing.trimEnd()}\n${trimmed}`;
  els.text.scrollTop = els.text.scrollHeight;
  dispatchTextInputEvent();
  setRecordingState(recordingState);
}

function insertTextAtCursor(text: string): boolean {
  const trimmed = text.trim();
  if (!trimmed) return true;
  if (!memoPadInsertAtCursor) return false;
  if (!document.hasFocus()) return false;
  if (document.activeElement !== els.text) return false;

  syncLastKnownCursorAndScroll();
  const existing = els.text.value;
  const selectionStart = els.text.selectionStart;
  const selectionEnd = els.text.selectionEnd;
  if (typeof selectionStart !== 'number' || typeof selectionEnd !== 'number') return false;

  let insertion = trimmed;
  if (selectionStart === selectionEnd && selectionStart === existing.length && existing.trim().length > 0) {
    if (!existing.endsWith('\n')) insertion = `\n${trimmed}`;
  }

  if (typeof els.text.setRangeText === 'function') {
    els.text.setRangeText(insertion, selectionStart, selectionEnd, 'end');
  } else {
    const next = `${existing.slice(0, selectionStart)}${insertion}${existing.slice(selectionEnd)}`;
    els.text.value = next;
    const caret = selectionStart + insertion.length;
    els.text.setSelectionRange(caret, caret);
  }

  dispatchTextInputEvent();
  setRecordingState(recordingState);
  return true;
}

function replaceSelectionText(replacementText: string): void {
  const selectionStart = els.text.selectionStart;
  const selectionEnd = els.text.selectionEnd;
  if (typeof selectionStart !== 'number' || typeof selectionEnd !== 'number') return;
  let start = selectionStart;
  let end = selectionEnd;
  if (start === end && lastKnownTextState && lastKnownTextState.selectionStart !== lastKnownTextState.selectionEnd) {
    start = lastKnownTextState.selectionStart;
    end = lastKnownTextState.selectionEnd;
  }
  if (start === end) return;

  syncLastKnownCursorAndScroll();
  const existing = els.text.value;
  const query = existing.slice(start, end);
  if (!query) return;

  const parts = existing.split(query);
  if (parts.length <= 1) return;
  const next = parts.join(replacementText);
  if (next === existing) return;

  const prefix = existing.slice(0, start);
  const prefixParts = prefix.split(query);
  const prefixMatchCount = Math.max(0, prefixParts.length - 1);
  const delta = prefixMatchCount * (replacementText.length - query.length);
  const nextStart = Math.min(next.length, Math.max(0, start + delta));
  const caret = Math.min(next.length, nextStart + replacementText.length);

  const beforeScrollTop = els.text.scrollTop;
  els.text.value = next;
  els.text.scrollTop = beforeScrollTop;
  els.text.setSelectionRange(caret, caret);

  dispatchTextInputEvent();
  setRecordingState(recordingState);
}

function updateAutoPasteUi(): void {
  els.autoPasteWrap.classList.toggle('avi-memo-icon-active', els.autoPaste.checked);
  els.autoPasteWrap.classList.toggle('avi-memo-icon-disabled', els.autoPaste.disabled);
}

function updateInsertAtCursorUi(): void {
  const shouldDisable = !els.autoMemo.checked;
  els.insertAtCursor.disabled = shouldDisable;
  if (shouldDisable && els.insertAtCursor.checked) {
    els.insertAtCursor.checked = false;
    memoPadInsertAtCursor = false;
  }
  els.insertAtCursorWrap.classList.toggle('avi-memo-icon-active', els.insertAtCursor.checked);
  els.insertAtCursorWrap.classList.toggle('avi-memo-icon-disabled', shouldDisable);
}

function updateAutoMemoUi(): void {
  els.autoMemoWrap.classList.toggle('avi-memo-icon-active', els.autoMemo.checked);
  updateInsertAtCursorUi();
}

function getAutoMemoHintText(): string {
  if (!els.autoMemo.checked) return '';
  return memoPadInsertAtCursor ? tr('memo.hint.autoMemo.insertAtCursor') : tr('memo.hint.autoMemo.append');
}

function getAutoMemoHintLineCount(): number {
  const trimmed = els.text.value.trimEnd();
  if (!trimmed) return 0;
  return trimmed.split('\n').length;
}

function positionAutoMemoHint(): void {
  if (els.hint.classList.contains('avi-hidden')) return;
  if (gutterLineEndOffsets.length === 0) updateLineNumbers();
  const ends = gutterLineEndOffsets;
  const lineCount = getAutoMemoHintLineCount();
  const y = ends[Math.min(lineCount, ends.length - 1)] ?? 0;
  const computed = getComputedStyle(els.text);
  const paddingTop = Number.parseFloat(computed.paddingTop) || 0;
  const paddingLeft = Number.parseFloat(computed.paddingLeft) || 0;
  const leftPx = Math.round(els.gutter.getBoundingClientRect().width + paddingLeft);
  const topPx = Math.round(paddingTop + y - els.text.scrollTop);
  const widthPx = Math.max(1, Math.floor(getTextareaInnerWidthPx()));
  els.hint.style.left = `${leftPx}px`;
  els.hint.style.top = `${topPx}px`;
  els.hint.style.width = `${widthPx}px`;
}

function updateAutoMemoHint(): void {
  const text = getAutoMemoHintText();
  els.hint.textContent = text;
  els.hint.classList.toggle('avi-hidden', !text);
  positionAutoMemoHint();
}

function applyAutoPasteSettings(settings: SettingsChangedPayload): void {
  els.autoPaste.checked = settings.autoPaste;
  updateAutoPasteUi();
}

function updatePinUi(): void {
  els.pinWrap.classList.toggle('avi-memo-icon-active', els.pin.checked);
}

function setActiveHotkey(accelerator: string): void {
  activeHotkeyAccelerator = normalizeAccelerator(accelerator);
}

function applyMemoPadEditorFontSize(value: unknown): void {
  const next = normalizeMemoPadEditorFontSizePxFromUi(value);
  // user-note: Ensure the first settings sync applies the inline CSS variable even when the
  // stored value equals the in-memory default, otherwise the memo stays at the CSS fallback size.
  const expectedCssValue = `${next}px`;
  const inlineCssValue = document.documentElement.style.getPropertyValue('--avi-memo-editor-font-size').trim();
  if (next === memoPadEditorFontSizePx && inlineCssValue === expectedCssValue) return;
  memoPadEditorFontSizePx = next;

  const selectionStart = typeof els.text.selectionStart === 'number' ? els.text.selectionStart : 0;
  const selectionEnd = typeof els.text.selectionEnd === 'number' ? els.text.selectionEnd : selectionStart;
  const hadFocus = document.activeElement === els.text;

  const beforeScrollTop = els.text.scrollTop;
  const beforeMaxScrollTop = Math.max(0, els.text.scrollHeight - els.text.clientHeight);
  const scrollRatio = beforeMaxScrollTop > 0 ? beforeScrollTop / beforeMaxScrollTop : 0;

  document.documentElement.style.setProperty('--avi-memo-editor-font-size', expectedCssValue);

  if (memoPadEditorFontSizeFrame !== null) {
    window.cancelAnimationFrame(memoPadEditorFontSizeFrame);
  }
  memoPadEditorFontSizeFrame = window.requestAnimationFrame(() => {
    memoPadEditorFontSizeFrame = null;
    updateLineNumbers();

    const afterMaxScrollTop = Math.max(0, els.text.scrollHeight - els.text.clientHeight);
    els.text.scrollTop = afterMaxScrollTop > 0 ? scrollRatio * afterMaxScrollTop : 0;
    syncGutterScroll();
    positionAutoMemoHint();

    const maxLen = els.text.value.length;
    const start = clampNumber(selectionStart, 0, maxLen);
    const end = clampNumber(selectionEnd, 0, maxLen);
    els.text.setSelectionRange(start, end);
    if (hadFocus) {
      els.text.focus({ preventScroll: true });
    }
  });
}

function clampNumber(value: number, min: number, max: number): number {
  return Math.min(max, Math.max(min, value));
}

function positionMemoTranslateMenu(): void {
  if (els.translateMenu.classList.contains('avi-hidden')) return;
  const point = memoTranslateMenuOpenPoint;
  if (!point) return;
  const menuRect = els.translateMenu.getBoundingClientRect();
  const margin = 8;

  const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
  const left = clampNumber(Math.round(point.x), margin, maxLeft);

  const maxTop = Math.max(margin, window.innerHeight - menuRect.height - margin);
  const top = clampNumber(Math.round(point.y), margin, maxTop);

  els.translateMenu.style.left = `${left}px`;
  els.translateMenu.style.top = `${top}px`;
}

function closeMemoTranslateMenu(options: { restoreFocus?: boolean } = {}): void {
  if (!isMemoTranslateMenuOpen) return;
  isMemoTranslateMenuOpen = false;
  memoTranslateMenuOpenPoint = null;
  const restoreTarget = memoTranslateMenuRestoreFocusTarget;
  memoTranslateMenuRestoreFocusTarget = null;
  els.translateMenu.classList.add('avi-hidden');
  els.translateMenu.setAttribute('aria-hidden', 'true');
  els.translate.setAttribute('aria-expanded', 'false');
  if (options.restoreFocus !== false) {
    if (restoreTarget?.isConnected && typeof restoreTarget.focus === 'function') {
      restoreTarget.focus({ preventScroll: true });
    } else {
      els.translate.focus({ preventScroll: true });
    }
  }
}

function renderMemoTranslateMenu(): void {
  els.translateMenu.replaceChildren();

  const autoTranslateItem = document.createElement('button');
  autoTranslateItem.type = 'button';
  autoTranslateItem.className = 'avi-memo-overflow-item';
  autoTranslateItem.textContent = tr('prefs.language.autoTranslate.label');
  autoTranslateItem.setAttribute('role', 'menuitemcheckbox');
  autoTranslateItem.dataset.checked = translationEnabled ? 'true' : 'false';
  autoTranslateItem.setAttribute('aria-checked', translationEnabled ? 'true' : 'false');
  setupPointerClickButton(autoTranslateItem, () => {
    closeMemoTranslateMenu();
    const next = !translationEnabled;
    translationEnabled = next;
    updateTranslateUi();
    enqueueSettingsMutation(window.voiceInput.setTranslationEnabled(next));
  });
  els.translateMenu.appendChild(autoTranslateItem);

  const divider = document.createElement('div');
  divider.className = 'avi-memo-menu-divider';
  divider.setAttribute('role', 'separator');
  els.translateMenu.appendChild(divider);

  for (const language of MEMO_TRANSLATE_MENU_LANGUAGES) {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'avi-memo-overflow-item';
    item.textContent = getTranscriptionLanguageLabel(uiLanguage, language);
    item.setAttribute('role', 'menuitemcheckbox');
    item.dataset.checked = language === lastTranslateTarget ? 'true' : 'false';
    item.setAttribute('aria-checked', language === lastTranslateTarget ? 'true' : 'false');
    setupPointerClickButton(item, () => {
      closeMemoTranslateMenu();
      lastTranslateTarget = language;
      setTranslateButtonLabel(language);
      enqueueSettingsMutation(window.voiceInput.setTranslationTarget(language));
    });
    els.translateMenu.appendChild(item);
  }
}

function openMemoTranslateMenu(point: { x: number; y: number }): void {
  if (isMemoTranslateMenuOpen) return;
  memoTranslateMenuRestoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
  const shouldFocusMenu =
    document.activeElement === els.translate || (memoTranslateMenuRestoreFocusTarget === els.translate && document.hasFocus());
  memoButtons.closeMemoOverflowMenu({ restoreFocus: false });
  renderMemoTranslateMenu();
  if (!els.translateMenu.firstElementChild) return;

  isMemoTranslateMenuOpen = true;
  memoTranslateMenuOpenPoint = point;
  els.translateMenu.classList.remove('avi-hidden');
  els.translateMenu.setAttribute('aria-hidden', 'false');
  els.translate.setAttribute('aria-expanded', 'true');
  positionMemoTranslateMenu();
  if (shouldFocusMenu) {
    const firstItem = els.translateMenu.querySelector<HTMLButtonElement>('button:not(:disabled)');
    firstItem?.focus({ preventScroll: true });
  }
}

async function refreshControlsFromSettings(): Promise<void> {
  await settingsMutationChain;
  const settings = await window.voiceInput.getSettings();
  applyAccentColor(settings.accentColor);
  translationEnabled = settings.translationEnabled;
  lastTranslateTarget = settings.translationTarget;
  applyUiLanguage(settings.uiLanguage);
  setTranslateButtonLabel(lastTranslateTarget);
  updateTranslateUi();
  els.translate.disabled = !els.text.value.trim() || isTranslating;
  applyAutoPasteSettings(settings);
  els.autoMemo.checked = settings.memoPadAutoMemo;
  els.insertAtCursor.checked = settings.memoPadInsertAtCursor;
  memoPadInsertAtCursor = settings.memoPadInsertAtCursor;
  updateAutoMemoUi();
  els.pin.checked = settings.memoPadAlwaysOnTop;
  updatePinUi();
  setActiveHotkey(settings.hotkey);
  applyMemoPadEditorFontSize(settings.memoPadEditorFontSizePx);
  memoUndo.setMemoPadUndoMaxSteps(settings.memoPadUndoMaxSteps);
  memoButtons.applyMemoButtonLayout(settings.memoPadVisibleButtons);
  updateAutoMemoHint();
}

async function runTranslate(): Promise<void> {
  const inputText = els.text.value;
  if (!inputText.trim()) return;

  const selectionStart = typeof els.text.selectionStart === 'number' ? els.text.selectionStart : 0;
  const selectionEnd = typeof els.text.selectionEnd === 'number' ? els.text.selectionEnd : selectionStart;
  let start = selectionStart;
  let end = selectionEnd;
  if (start === end && lastKnownTextState && lastKnownTextState.selectionStart !== lastKnownTextState.selectionEnd) {
    start = lastKnownTextState.selectionStart;
    end = lastKnownTextState.selectionEnd;
  }
  const hasSelection = end > start;

  const rawSelectedText = hasSelection ? inputText.slice(start, end) : inputText;
  let translationInputText = rawSelectedText;
  let selectionPrefix = '';
  let selectionSuffix = '';
  if (hasSelection) {
    selectionPrefix = rawSelectedText.match(/^\s*/)?.[0] ?? '';
    selectionSuffix = rawSelectedText.match(/\s*$/)?.[0] ?? '';
    translationInputText = rawSelectedText.slice(
      selectionPrefix.length,
      Math.max(selectionPrefix.length, rawSelectedText.length - selectionSuffix.length)
    );
    if (!translationInputText.trim()) return;
  }

  isTranslating = true;
  els.translate.disabled = true;
  els.toggle.disabled = true;
  els.cancel.disabled = true;
  setStatusText(tr('memo.status.translating'));

  try {
    const res = await window.voiceInput.manualTranslate(translationInputText);
    if (!res.ok) {
      window.alert(formatApiError(uiLanguage, res, 'memo.alert.translationFailed'));
      return;
    }
    syncLastKnownCursorAndScroll();
    if (hasSelection) {
      const replacementText = `${selectionPrefix}${res.text ?? ''}${selectionSuffix}`;
      const beforeScrollTop = els.text.scrollTop;
      const maxLen = els.text.value.length;
      const startIndex = Math.max(0, Math.min(maxLen, start));
      const endIndex = Math.max(startIndex, Math.min(maxLen, end));
      if (typeof els.text.setRangeText === 'function') {
        els.text.setRangeText(replacementText, startIndex, endIndex, 'end');
      } else {
        const next = `${inputText.slice(0, startIndex)}${replacementText}${inputText.slice(endIndex)}`;
        els.text.value = next;
        const caret = Math.min(next.length, startIndex + replacementText.length);
        els.text.setSelectionRange(caret, caret);
      }
      els.text.scrollTop = beforeScrollTop;
    } else {
      els.text.value = res.text ?? '';
      els.text.scrollTop = els.text.scrollHeight;
    }
    dispatchTextInputEvent();
  } finally {
    isTranslating = false;
    setRecordingState(recordingState);
    await refreshControlsFromSettings();
  }
}

export async function initMemo(): Promise<void> {
  await refreshControlsFromSettings();
  updateLineNumbers();
  memoUndo.resetMemoUndoHistory();

  setupRecordButtonHandlers();
  lockRecordButtonWidth();
  setupPointerToggleLabel(els.autoPasteWrap, els.autoPaste);
  setupPointerToggleLabel(els.autoMemoWrap, els.autoMemo);
  setupPointerToggleLabel(els.insertAtCursorWrap, els.insertAtCursor);
  setupPointerToggleLabel(els.pinWrap, els.pin);
  els.overflow.setAttribute('aria-haspopup', 'menu');
  els.overflow.setAttribute('aria-expanded', 'false');
  setupPointerClickButton(els.overflow, () => memoButtons.toggleMemoOverflowMenu());
  els.translate.setAttribute('aria-haspopup', 'menu');
  els.translate.setAttribute('aria-expanded', 'false');
  els.translate.addEventListener('contextmenu', (event: MouseEvent) => {
    event.preventDefault();
    const now = Date.now();
    const wasPointerContextMenu = lastPointerDownButton === 2 && now - lastPointerDownAt < 500;
    if (wasPointerContextMenu) {
      // user-note: Keep focus on the memo textarea so the caret stays visible and insert-at-cursor keeps working.
      syncLastKnownCursorAndScroll();
      els.text.focus({ preventScroll: true });
    }
    openMemoTranslateMenu({ x: event.clientX, y: event.clientY });
  });

  els.actions.addEventListener('contextmenu', (event: MouseEvent) => {
    const target = event.target;
    if (!(target instanceof HTMLElement)) return;
    if (target.closest('button, label, input')) return;
    event.preventDefault();
    void window.voiceInput.popupTrayMenu({ x: event.clientX, y: event.clientY });
  });

  // user-note: Memo find/replace logic is extracted into a dedicated module to keep memo.ts maintainable.
  const findReplace = setupMemoFindReplace({
    els: {
      text: els.text,
      findBar: els.findBar,
      findQuery: els.findQuery,
      findPrev: els.findPrev,
      findNext: els.findNext,
      findClose: els.findClose,
      replaceRow: els.replaceRow,
      replaceText: els.replaceText,
      replaceOne: els.replaceOne,
      replaceAll: els.replaceAll,
      findStatus: els.findStatus
    },
    getLastKnownSelectionRange: () => {
      if (!lastKnownTextState) return null;
      return { start: lastKnownTextState.selectionStart, end: lastKnownTextState.selectionEnd };
    },
    getGutterLineEndOffsets: () => gutterLineEndOffsets,
    updateLineNumbers,
    syncGutterScroll,
    syncLastKnownCursorAndScroll,
    afterTextMutated: () => {
      dispatchTextInputEvent();
      setRecordingState(recordingState);
    }
  });

  window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      if (event.isComposing) return;
      if (event.key === 'Escape' && isMemoTranslateMenuOpen) {
        event.preventDefault();
        closeMemoTranslateMenu();
        return;
      }
      if (event.key === 'Escape' && memoButtons.isMemoOverflowMenuOpen()) {
        event.preventDefault();
        memoButtons.closeMemoOverflowMenu();
        return;
      }
      if (event.key === 'Escape' && !els.findBar.classList.contains('avi-hidden')) {
        event.preventDefault();
        findReplace.closeFindBar();
        return;
      }
      if (event.repeat) return;

      const accel = keyEventToAccelerator(event);
      if (!accel) return;
      const normalized = normalizeAccelerator(accel).toLowerCase();
      if (normalized === activeMemoFindHotkeyAccelerator.toLowerCase()) {
        event.preventDefault();
        findReplace.openFindBar('find');
        return;
      }
      if (normalized === activeMemoReplaceHotkeyAccelerator.toLowerCase()) {
        event.preventDefault();
        findReplace.openFindBar('replace');
      }
    },
    true
  );

  setupPointerClickButton(els.cancel, () => {
    void window.voiceInput.cancelRecording();
  });

  setupPointerClickButton(els.translate, () => {
    void runTranslate();
  });

  setupPointerClickButton(els.cut, () => {
    void (async () => {
      const text = els.text.value;
      if (!text) return;

      const selectionStart = typeof els.text.selectionStart === 'number' ? els.text.selectionStart : 0;
      const selectionEnd = typeof els.text.selectionEnd === 'number' ? els.text.selectionEnd : selectionStart;
      const hasSelection = selectionEnd > selectionStart;
      const start = hasSelection ? selectionStart : 0;
      const end = hasSelection ? selectionEnd : text.length;
      const selected = text.slice(start, end);
      if (!selected) return;

      await navigator.clipboard.writeText(selected);

      syncLastKnownCursorAndScroll();
      if (typeof els.text.setRangeText === 'function') {
        els.text.setRangeText('', start, end, 'start');
      } else {
        const next = `${text.slice(0, start)}${text.slice(end)}`;
        els.text.value = next;
        els.text.setSelectionRange(start, start);
      }
      dispatchTextInputEvent();
      setRecordingState(recordingState);
      flushMemoSave();
    })();
  });

  setupPointerClickButton(els.copy, () => {
    void (async () => {
      const text = els.text.value;
      if (!text) return;

      const selectionStart = typeof els.text.selectionStart === 'number' ? els.text.selectionStart : 0;
      const selectionEnd = typeof els.text.selectionEnd === 'number' ? els.text.selectionEnd : selectionStart;
      const hasSelection = selectionEnd > selectionStart;
      const start = hasSelection ? selectionStart : 0;
      const end = hasSelection ? selectionEnd : text.length;
      const selected = text.slice(start, end);
      if (!selected) return;

      await navigator.clipboard.writeText(selected);
    })();
  });

  setupPointerClickButton(els.clear, () => {
    syncLastKnownCursorAndScroll();
    els.text.value = '';
    dispatchTextInputEvent();
    setRecordingState(recordingState);
    flushMemoSave();
  });

  els.text.addEventListener('beforeinput', memoUndo.handleBeforeInput);
  els.text.addEventListener('keydown', memoUndo.handleKeyDown);

  els.text.addEventListener('select', () => syncLastKnownCursorAndScroll());
  els.text.addEventListener('keyup', () => syncLastKnownCursorAndScroll());
  els.text.addEventListener('mouseup', () => syncLastKnownCursorAndScroll());
  els.text.addEventListener('focus', () => syncLastKnownCursorAndScroll());

  els.text.addEventListener('input', () => {
    memoUndo.handleTextInput();

    els.translate.disabled = !els.text.value.trim() || isTranslating;
    scheduleLineNumbersUpdate();
    scheduleMemoSave();
  });

  els.text.addEventListener('scroll', () => {
    syncGutterScroll();
    syncLastKnownCursorAndScroll();
    positionAutoMemoHint();
  });

  let resizeObserver: ResizeObserver | null = null;
  if (typeof ResizeObserver === 'function') {
	    resizeObserver = new ResizeObserver((entries) => {
	      for (const entry of entries) {
	        if (entry.target === els.text) scheduleLineNumbersUpdate();
	        if (entry.target === els.memoButtons) memoButtons.scheduleMemoButtonsOverflowUpdate();
	      }
	    });
    resizeObserver.observe(els.text);
    resizeObserver.observe(els.memoButtons);
  }

  els.gutter.addEventListener('mousedown', (event) => {
    if (event.button !== 0) return;
    const line = getLineFromGutterPoint(event.clientX, event.clientY);
    if (!line) return;
    event.preventDefault();
    gutterSelecting = true;
    gutterSelectionStartLine = line;
    selectLineRange(line, line);
    window.addEventListener('mousemove', handleGutterMouseMove);
    window.addEventListener(
      'mouseup',
      () => {
        stopGutterSelection();
      },
      { once: true }
    );
  });

  els.gutter.addEventListener(
    'wheel',
    (event) => {
      const deltaY = event.deltaY;
      if (!Number.isFinite(deltaY) || deltaY === 0) return;
      els.text.scrollTop += deltaY;
      syncGutterScroll();
      event.preventDefault();
    },
    { passive: false }
  );

  els.autoPaste.addEventListener('change', () => {
    if (els.autoPaste.disabled) return;
    updateAutoPasteUi();
    enqueueSettingsMutation(window.voiceInput.setAutoPaste(els.autoPaste.checked));
  });

  els.autoMemo.addEventListener('change', () => {
    updateAutoMemoUi();
    enqueueSettingsMutation(window.voiceInput.setMemoPadAutoMemo(els.autoMemo.checked));
    updateAutoMemoHint();
  });

  els.insertAtCursor.addEventListener('change', () => {
    if (els.insertAtCursor.disabled) return;
    memoPadInsertAtCursor = els.insertAtCursor.checked;
    updateInsertAtCursorUi();
    enqueueSettingsMutation(window.voiceInput.setMemoPadInsertAtCursor(els.insertAtCursor.checked));
    updateAutoMemoHint();
  });

  els.pin.addEventListener('change', () => {
    updatePinUi();
    enqueueSettingsMutation(window.voiceInput.setMemoPadAlwaysOnTop(els.pin.checked));
  });

  setupPointerClickButton(els.history, () => {
    void (async () => {
      const res = await window.voiceInput.openHistoryWindow();
      if (res.ok) return;
      window.alert(formatApiError(uiLanguage, res, 'memo.alert.failedToOpenHistory'));
    })();
  });

  setupPointerClickButton(els.settings, () => {
    void window.voiceInput.openPreferences();
  });

  window.addEventListener(
    'pointerdown',
    (event: PointerEvent) => {
      isPointerDown = true;
      lastPointerDownAt = Date.now();
      lastPointerDownButton = event.button;
    },
    true
  );
  window.addEventListener(
    'pointerdown',
    (event) => {
      const target = event.target;
      if (!(target instanceof Node)) return;
      if (isMemoTranslateMenuOpen) {
        if (els.translateMenu.contains(target)) return;
        closeMemoTranslateMenu({ restoreFocus: false });
      }
      if (memoButtons.isMemoOverflowMenuOpen()) {
        if (els.overflow.contains(target)) return;
        if (els.overflowMenu.contains(target)) return;
        memoButtons.closeMemoOverflowMenu({ restoreFocus: false });
      }
    },
    true
  );
  window.addEventListener(
    'pointerup',
    () => {
      isPointerDown = false;
      schedulePendingFocusRefresh();
    },
    true
  );
  window.addEventListener(
    'pointercancel',
    () => {
      isPointerDown = false;
      schedulePendingFocusRefresh();
    },
    true
  );

  window.addEventListener('focus', () => {
    pendingFocusRefresh = true;
    schedulePendingFocusRefresh();
  });

  window.voiceInput.onRecordingStateChanged((state, message) => {
    setRecordingState(state, message);
  });

  window.voiceInput.onRecordingLevel((level) => {
    recordingLevel = clamp01(level);
    updateRecordingDot();
  });

  window.voiceInput.onMemoRestoreText((text) => {
    els.text.value = text;
    els.text.scrollTop = els.text.scrollHeight;
    updateLineNumbers();
    memoSaveLastSentText = text;
    memoUndo.resetMemoUndoHistory();
    setRecordingState(recordingState);
  });

  window.voiceInput.onMemoRequestText(() => {
    flushMemoSave(true);
  });

  window.voiceInput.onMemoUndo(() => {
    memoUndo.applyUndo();
  });

  window.voiceInput.onMemoRedo(() => {
    memoUndo.applyRedo();
  });

  window.voiceInput.onMemoAppendText((text) => {
    if (insertTextAtCursor(text)) return;
    appendText(text);
  });

  window.voiceInput.onMemoReplaceSelection((payload) => {
    replaceSelectionText(payload.replacementText);
  });

  window.voiceInput.onMemoOpenFindBar((payload) => {
    findReplace.openFindBar(payload.mode, payload.seed);
  });

  window.voiceInput.onMemoButtonLayout((buttons) => {
    memoButtons.applyMemoButtonLayout(buttons);
  });

  window.voiceInput.onSettingsChanged((settings) => {
    memoState.applySettingsChanged(settings);
    applyMemoPadEditorFontSize(settings.memoPadEditorFontSizePx);
  });

  window.voiceInput.onAccentColorChanged((accentColor) => {
    applyAccentColor(accentColor);
  });

  window.voiceInput.onUiLanguageChanged((language) => {
    applyUiLanguage(language);
  });

  window.addEventListener('beforeunload', () => {
    resizeObserver?.disconnect();
    flushMemoSave(true);
  });

  window.addEventListener(
    'keydown',
    (event: KeyboardEvent) => {
      const accel = keyEventToAccelerator(event);
      if (!accel) return;
      if (normalizeAccelerator(accel).toLowerCase() !== activeHotkeyAccelerator.toLowerCase()) return;
      if (event.repeat) return;

      event.preventDefault();
      isPushToTalkMode = false;
      if (recordingState === 'recording') {
        void window.voiceInput.stopRecording();
        return;
      }
      void window.voiceInput.startRecording();
    },
    true
  );

  setRecordingState('idle');
}
