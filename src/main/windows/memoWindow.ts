import { BrowserWindow, Menu, app, screen } from 'electron';
import { getAppIconPath, getDictionaryAddHtmlPath, getMemoHtmlPath, getPreloadPath } from '../appPaths';
import type { MemoPadButtonId, WindowBounds } from '../../shared/types';
import { t, type UiStringKey } from '../../shared/i18n';
import { FIXED_MEMO_FIND_HOTKEY, FIXED_MEMO_REPLACE_HOTKEY } from '../../shared/hotkey';
import type { SettingsStore } from '../settings';
import { hardenWebContents } from './hardenWebContents';

type ThemeColors = { appBackgroundColor: string; surfaceColor: string };
type RecordingState = 'idle' | 'recording' | 'transcribing' | 'error';

let memoBoundsSaveTimer: NodeJS.Timeout | null = null;
let memoBoundsLastWritten: string | null = null;

function getMemoButtonLayoutPayload(settingsStore: SettingsStore): MemoPadButtonId[] {
  return settingsStore.get().memoPadVisibleButtons;
}

export function broadcastMemoButtonLayout(settingsStore: SettingsStore, memoWindow: BrowserWindow | null): void {
  if (!memoWindow) return;
  memoWindow.webContents.send('memo:buttonLayout', getMemoButtonLayoutPayload(settingsStore));
}

function isWithinAnyWorkArea(point: { x: number; y: number }): boolean {
  for (const display of screen.getAllDisplays()) {
    const wa = display.workArea;
    if (point.x >= wa.x && point.x <= wa.x + wa.width && point.y >= wa.y && point.y <= wa.y + wa.height) {
      return true;
    }
  }
  return false;
}

function resolveMemoBounds(saved?: WindowBounds): WindowBounds {
  const primary = screen.getPrimaryDisplay().workArea;
  const minWidth = 320;
  const minHeight = 220;

  const fallbackWidth = Math.min(560, Math.max(minWidth, Math.floor(primary.width * 0.36)));
  const fallbackHeight = Math.min(420, Math.max(minHeight, Math.floor(primary.height * 0.3)));
  const fallback: WindowBounds = {
    width: fallbackWidth,
    height: fallbackHeight,
    x: Math.round(primary.x + primary.width - fallbackWidth - 20),
    y: Math.round(primary.y + 20)
  };

  if (!saved) return fallback;

  const width = Math.max(minWidth, Math.floor(saved.width));
  const height = Math.max(minHeight, Math.floor(saved.height));
  const x = Math.floor(saved.x);
  const y = Math.floor(saved.y);
  const center = { x: x + width / 2, y: y + height / 2 };
  if (!Number.isFinite(center.x) || !Number.isFinite(center.y) || !isWithinAnyWorkArea(center)) {
    return fallback;
  }
  return { x, y, width, height };
}

async function flushMemoBoundsToSettings(settingsStore: SettingsStore, memoWindow: BrowserWindow | null): Promise<void> {
  if (!memoWindow) return;
  const bounds = memoWindow.getBounds();
  const next: WindowBounds = {
    x: Math.floor(bounds.x),
    y: Math.floor(bounds.y),
    width: Math.floor(bounds.width),
    height: Math.floor(bounds.height)
  };
  const signature = JSON.stringify(next);
  if (signature === memoBoundsLastWritten) return;
  memoBoundsLastWritten = signature;
  await settingsStore.setMemoPadBounds(next);
}

function scheduleMemoBoundsSave(settingsStore: SettingsStore, getMemoWindow: () => BrowserWindow | null): void {
  if (!getMemoWindow()) return;
  if (memoBoundsSaveTimer) clearTimeout(memoBoundsSaveTimer);
  memoBoundsSaveTimer = setTimeout(() => {
    memoBoundsSaveTimer = null;
    void flushMemoBoundsToSettings(settingsStore, getMemoWindow());
  }, 600);
}

type MemoTextareaState = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
};

function getMemoContextMenuLabelText(value: string, maxLength: number): string {
  const normalized = value.replace(/\s+/g, ' ').trim();
  if (normalized.length <= maxLength) return normalized;
  return `${normalized.slice(0, Math.max(0, maxLength - 1))}…`;
}

async function getMemoTextareaState(memoWindow: BrowserWindow): Promise<MemoTextareaState | null> {
  const raw = (await memoWindow.webContents
    .executeJavaScript(
      `(() => {
        const el = document.getElementById('memoText');
        if (!el || !(el instanceof HTMLTextAreaElement)) return null;
        return {
          value: el.value ?? '',
          selectionStart: typeof el.selectionStart === 'number' ? el.selectionStart : 0,
          selectionEnd: typeof el.selectionEnd === 'number' ? el.selectionEnd : 0
        };
      })()`,
      true
    )
    .catch(() => null)) as unknown;

  if (!raw || typeof raw !== 'object') return null;
  const obj = raw as Record<string, unknown>;
  const value = typeof obj.value === 'string' ? obj.value : '';
  const selectionStartRaw = obj.selectionStart;
  const selectionEndRaw = obj.selectionEnd;
  const selectionStart =
    typeof selectionStartRaw === 'number' && Number.isFinite(selectionStartRaw) ? Math.max(0, Math.floor(selectionStartRaw)) : 0;
  const selectionEnd =
    typeof selectionEndRaw === 'number' && Number.isFinite(selectionEndRaw) ? Math.max(0, Math.floor(selectionEndRaw)) : selectionStart;
  return { value, selectionStart, selectionEnd };
}

async function replaceMemoTextareaRange(
  memoWindow: BrowserWindow,
  opts: { start: number; end: number; replacement: string }
): Promise<void> {
  const payload = JSON.stringify({
    start: Math.max(0, Math.floor(opts.start)),
    end: Math.max(0, Math.floor(opts.end)),
    replacement: opts.replacement
  });

  await memoWindow.webContents
    .executeJavaScript(
      `(() => {
        const el = document.getElementById('memoText');
        if (!el || !(el instanceof HTMLTextAreaElement)) return;
        const payload = ${payload};
        const maxLen = el.value.length;
        const start = Math.max(0, Math.min(maxLen, payload.start));
        const end = Math.max(start, Math.min(maxLen, payload.end));
        const before = el.value.slice(0, start);
        const after = el.value.slice(end);
        el.value = before + payload.replacement + after;
        const caret = start + payload.replacement.length;
        el.setSelectionRange(caret, caret);
        el.dispatchEvent(new Event('input', { bubbles: true }));
      })()`,
      true
    )
    .catch(() => {});
}

function capitalizeWords(value: string): string {
  return value.replace(/\b([A-Za-z])([A-Za-z]*)\b/g, (_match, first: string, rest: string) => {
    return `${first.toUpperCase()}${rest.toLowerCase()}`;
  });
}

async function runMemoTransformSelection(memoWindow: BrowserWindow, transform: 'uppercase' | 'lowercase' | 'capitalize'): Promise<void> {
  const state = await getMemoTextareaState(memoWindow);
  if (!state) return;
  const start = state.selectionStart;
  const end = state.selectionEnd;
  if (end <= start) return;

  const selectedText = state.value.slice(start, end);
  let replacement = selectedText;
  switch (transform) {
    case 'uppercase':
      replacement = selectedText.toUpperCase();
      break;
    case 'lowercase':
      replacement = selectedText.toLowerCase();
      break;
    case 'capitalize':
      replacement = capitalizeWords(selectedText);
      break;
  }

  if (replacement === selectedText) return;
  await replaceMemoTextareaRange(memoWindow, { start, end, replacement });
}

async function openDictionaryAddWindow(
  opts: EnsureMemoWindowOptions,
  memoWindow: BrowserWindow,
  fromText: string
): Promise<void> {
  const existing = opts.getDictionaryAddWindow();
  if (existing) {
    existing.close();
    opts.setDictionaryAddWindow(null);
  }

  const isRelease = app.isPackaged;
  const themeColors = opts.getThemeColors();
  const dictionaryAddWindow = new BrowserWindow({
    width: 460,
    height: 280,
    resizable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    modal: true,
    parent: memoWindow,
    show: false,
    icon: getAppIconPath(),
    backgroundColor: themeColors.appBackgroundColor,
    alwaysOnTop: memoWindow.isAlwaysOnTop(),
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !isRelease
    }
  });
  hardenWebContents(dictionaryAddWindow.webContents, {
    disableDevToolsShortcuts: isRelease,
    disableReloadShortcuts: isRelease
  });
  opts.disableWindowMenuOnWindows(dictionaryAddWindow);
  opts.setDictionaryAddWindow(dictionaryAddWindow);

  dictionaryAddWindow.on('closed', () => {
    opts.setDictionaryAddWindow(null);
  });

  dictionaryAddWindow.once('ready-to-show', () => {
    dictionaryAddWindow.show();
    dictionaryAddWindow.focus();
  });

  await dictionaryAddWindow.loadFile(getDictionaryAddHtmlPath(), {
    query: { from: String(fromText ?? '') }
  });
}

function buildMemoContextMenuTemplate(
  opts: EnsureMemoWindowOptions,
  memoWindow: BrowserWindow,
  params: Electron.ContextMenuParams
): Electron.MenuItemConstructorOptions[] | null {
  const isMac = process.platform === 'darwin';
  const uiLanguage = opts.settingsStore.get().uiLanguage;
  const tr = (key: UiStringKey, params?: Record<string, string | number>): string => t(uiLanguage, key, params);
  const can = params.editFlags;
  const selectionTextRaw = typeof params.selectionText === 'string' ? params.selectionText : '';
  const selectionText = selectionTextRaw.trim();
  const hasSelectionText = selectionTextRaw.length > 0;
  const showMacExtras = isMac && params.isEditable;
  const hasAnyAction =
    hasSelectionText ||
    can.canUndo ||
    can.canRedo ||
    can.canCut ||
    can.canCopy ||
    can.canPaste ||
    can.canSelectAll ||
    showMacExtras;
  if (!hasAnyAction) return null;

  const template: Electron.MenuItemConstructorOptions[] = [];

  const labelText = selectionText.length > 0 ? getMemoContextMenuLabelText(selectionText, 40) : '';

  if (isMac && selectionText.length > 0) {
    template.push({
      label: tr('memo.context.lookup', { text: labelText }),
      click: () => {
        memoWindow.webContents.showDefinitionForSelection();
      }
    });
    template.push({ type: 'separator' });
  }

  if (params.isEditable) {
    template.push(
      {
        label: tr('common.undo'),
        enabled: can.canUndo,
        click: () => {
          memoWindow.webContents.send('memo:undo');
        }
      },
      {
        label: tr('common.redo'),
        enabled: can.canRedo,
        click: () => {
          memoWindow.webContents.send('memo:redo');
        }
      },
      { type: 'separator' }
    );
  }

  template.push(
    { label: tr('common.cut'), role: 'cut', enabled: params.isEditable && can.canCut },
    { label: tr('common.copy'), role: 'copy', enabled: can.canCopy || hasSelectionText },
    { label: tr('common.paste'), role: 'paste', enabled: params.isEditable && can.canPaste },
    { label: tr('common.selectAll'), role: 'selectAll', enabled: can.canSelectAll }
  );

  if (params.isEditable) {
    template.push({ type: 'separator' });
    template.push(
      {
        label: `${tr('common.find')}…`,
        accelerator: FIXED_MEMO_FIND_HOTKEY,
        click: () => {
          memoWindow.webContents.send('memo:openFindBar', { mode: 'find', seed: selectionTextRaw.slice(0, 2000) });
        }
      },
      {
        label: `${tr('common.replace')}…`,
        accelerator: FIXED_MEMO_REPLACE_HOTKEY,
        click: () => {
          memoWindow.webContents.send('memo:openFindBar', { mode: 'replace', seed: selectionTextRaw.slice(0, 2000) });
        }
      }
    );
  }

  if (selectionText.length > 0 || showMacExtras) {
    template.push({ type: 'separator' });
  }

  if (selectionText.length > 0) {
    template.push({
      label: tr('memo.context.addToDictionary'),
      click: () => {
        void openDictionaryAddWindow(opts, memoWindow, selectionText.slice(0, 2000));
      }
    });
    if (showMacExtras) {
      template.push({ type: 'separator' });
    }
  }

  if (showMacExtras) {
    const spellEnabled = memoWindow.webContents.session.isSpellCheckerEnabled();
    const misspelledWord = typeof params.misspelledWord === 'string' ? params.misspelledWord.trim() : '';
    const suggestions: string[] = Array.isArray(params.dictionarySuggestions)
      ? params.dictionarySuggestions
          .filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
          .map((item) => item.trim())
      : [];

    const spellingSubmenu: Electron.MenuItemConstructorOptions[] = [];
    if (misspelledWord) {
      if (suggestions.length > 0) {
        for (const suggestion of suggestions.slice(0, 8)) {
          spellingSubmenu.push({
            label: suggestion,
            click: () => {
              memoWindow.webContents.replaceMisspelling(suggestion);
            }
          });
        }
      } else {
        spellingSubmenu.push({ label: tr('memo.context.spelling.noSuggestions'), enabled: false });
      }
      spellingSubmenu.push(
        { type: 'separator' },
        {
          label: tr('memo.context.spelling.learn'),
          click: () => {
            memoWindow.webContents.session.addWordToSpellCheckerDictionary(misspelledWord);
          }
        },
        { type: 'separator' }
      );
    }
    spellingSubmenu.push({
      label: tr('memo.context.spelling.checkWhileTyping'),
      type: 'checkbox',
      checked: spellEnabled,
      click: (menuItem) => {
        memoWindow.webContents.session.setSpellCheckerEnabled(Boolean(menuItem.checked));
      }
    });

    template.push(
      {
        label: tr('memo.context.spelling.menu'),
        submenu: spellingSubmenu
      },
      {
        label: tr('memo.context.transform.menu'),
        submenu: [
          {
            label: tr('memo.context.transform.uppercase'),
            enabled: hasSelectionText,
            click: () => {
              void runMemoTransformSelection(memoWindow, 'uppercase');
            }
          },
          {
            label: tr('memo.context.transform.lowercase'),
            enabled: hasSelectionText,
            click: () => {
              void runMemoTransformSelection(memoWindow, 'lowercase');
            }
          },
          {
            label: tr('memo.context.transform.capitalize'),
            enabled: hasSelectionText,
            click: () => {
              void runMemoTransformSelection(memoWindow, 'capitalize');
            }
          }
        ]
      },
      {
        label: tr('memo.context.speech.menu'),
        submenu: [{ role: 'startSpeaking' }, { role: 'stopSpeaking' }]
      }
    );
  }

  return template;
}

export type EnsureMemoWindowOptions = {
  settingsStore: SettingsStore;
  getThemeColors: () => ThemeColors;
  getMemoWindow: () => BrowserWindow | null;
  setMemoWindow: (window: BrowserWindow | null) => void;
  getDictionaryAddWindow: () => BrowserWindow | null;
  setDictionaryAddWindow: (window: BrowserWindow | null) => void;
  isQuitting: () => boolean;
  trackAppWindow: (window: BrowserWindow) => void;
  disableWindowMenuOnWindows: (window: BrowserWindow) => void;
  getRecordingState: () => RecordingState;
  getLastRecordingErrorMessage: () => string | null;
  getLastRecordingLevel: () => number;
};

export async function ensureMemoWindow(opts: EnsureMemoWindowOptions): Promise<void> {
  if (opts.getMemoWindow()) return;

  const isRelease = app.isPackaged;
  const bounds = resolveMemoBounds(opts.settingsStore.get().memoPadBounds);
  const isMac = process.platform === 'darwin';
  const isWindows = process.platform === 'win32';
  const useNativeFrame = isMac || isWindows;
  const settings = opts.settingsStore.get();
  const memoPadAlwaysOnTop = settings.memoPadAlwaysOnTop;
  const themeColors = opts.getThemeColors();

  const memoWindow = new BrowserWindow({
    x: bounds.x,
    y: bounds.y,
    width: bounds.width,
    height: bounds.height,
    minWidth: 320,
    minHeight: 220,
    show: false,
    icon: getAppIconPath(),
    ...(isMac ? { acceptFirstMouse: true } : {}),
    frame: useNativeFrame,
    resizable: true,
    transparent: !useNativeFrame,
    backgroundColor: useNativeFrame ? themeColors.surfaceColor : '#00000000',
    minimizable: useNativeFrame,
    maximizable: useNativeFrame,
    ...(isMac ? { fullscreenable: !memoPadAlwaysOnTop } : {}),
    alwaysOnTop: memoPadAlwaysOnTop,
    skipTaskbar: false,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      spellcheck: true,
      devTools: !isRelease
    }
  });

  opts.disableWindowMenuOnWindows(memoWindow);
  opts.trackAppWindow(memoWindow);
  opts.setMemoWindow(memoWindow);

  hardenWebContents(memoWindow.webContents, { disableDevToolsShortcuts: isRelease, disableReloadShortcuts: isRelease });

  // user-note: Memo pad uses in-app font size settings, so keep the window zoom fixed to avoid Electron zoom affecting UI.
  try {
    void memoWindow.webContents.setVisualZoomLevelLimits(1, 1).catch(() => {});
    memoWindow.webContents.setZoomLevel(0);
  } catch {
    // ignore
  }
  memoWindow.webContents.on('zoom-changed', (event) => {
    event.preventDefault();
    try {
      memoWindow.webContents.setZoomLevel(0);
    } catch {
      // ignore
    }
  });

  memoWindow.on('move', () => scheduleMemoBoundsSave(opts.settingsStore, opts.getMemoWindow));
  memoWindow.on('resize', () => scheduleMemoBoundsSave(opts.settingsStore, opts.getMemoWindow));

  memoWindow.on('close', (event) => {
    if (opts.isQuitting()) return;
    event.preventDefault();
    memoWindow.hide();
  });

  memoWindow.on('closed', () => {
    opts.setMemoWindow(null);
  });

  memoWindow.webContents.on('did-finish-load', () => {
    const recordingState = opts.getRecordingState();
    memoWindow.webContents.send(
      'recording:stateChanged',
      recordingState,
      recordingState === 'error' ? opts.getLastRecordingErrorMessage() ?? undefined : undefined
    );
    const { memoPadPersistText, memoPadText } = opts.settingsStore.get();
    memoWindow.webContents.send('memo:restoreText', memoPadPersistText ? memoPadText : '');
    broadcastMemoButtonLayout(opts.settingsStore, memoWindow);
    memoWindow.webContents.send('recording:level', opts.getLastRecordingLevel());
  });

  memoWindow.webContents.on('context-menu', (_event, params) => {
    const template = buildMemoContextMenuTemplate(opts, memoWindow, params);
    if (!template) return;

    Menu.buildFromTemplate(template).popup({
      window: memoWindow,
      x: params.x,
      y: params.y
    });
  });

  await memoWindow.loadFile(getMemoHtmlPath());
}
