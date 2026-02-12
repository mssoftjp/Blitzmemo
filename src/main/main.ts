import {
  app,
  BrowserWindow,
  globalShortcut,
  Menu,
  Notification,
  nativeTheme,
  nativeImage,
  screen,
  shell,
  type IpcMainInvokeEvent
} from 'electron';
import { execFile } from 'node:child_process';
import fs from 'node:fs/promises';
import { promisify } from 'node:util';
import path from 'node:path';
import { SettingsStore } from './settings';
import {
  SilenceProcessingMode,
  ThemeMode
} from '../shared/types';
import { HistoryStore } from './history';
import { applyDictionaryRules, parseDictionaryRules } from './dictionary';
import { transcribeWithOpenAI } from './transcription';
import { translateWithOpenAI } from './translation';
import { UsageStore } from './usage';
import { StatsStore } from './stats';
import { checkForNewGitHubRelease, ReleaseWatchStore } from './releaseWatch';
import type { ApiErrorCode, SettingsChangedPayload } from '../shared/voiceInputApi';
import { t } from '../shared/i18n';
import { setupMainIpc, type MainIpcContext } from './ipc/setupMainIpc';
import { getAppIconPath } from './appPaths';
import { ensureHistoryWindow as ensureHistoryWindowImpl } from './windows/historyWindow';
import { createMainWindow } from './windows/mainWindow';
import { broadcastMemoButtonLayout as broadcastMemoButtonLayoutImpl, ensureMemoWindow as ensureMemoWindowImpl } from './windows/memoWindow';
import {
  ensureOverlayWindow as ensureOverlayWindowImpl,
  setOverlayState as setOverlayStateImpl,
  stopOverlayFollow as stopOverlayFollowImpl
} from './windows/overlayWindow';
import { setupTray } from './tray/setupTray';
import { setupHotkeys } from './hotkeys/setupHotkeys';
import { setupAutoPaste } from './autoPaste/setupAutoPaste';
import { setupMacAppMenu } from './menu/setupMacAppMenu';
import { setupDockMenu } from './menu/setupDockMenu';
import { parseAppLaunchActionFromArgv } from './taskbar/appLaunchAction';
import { setupWindowsUserTasks } from './taskbar/setupWindowsUserTasks';

let mainWindow: BrowserWindow | null = null;
let overlayWindow: BrowserWindow | null = null;
let historyWindow: BrowserWindow | null = null;
let memoWindow: BrowserWindow | null = null;
let dictionaryAddWindow: BrowserWindow | null = null;
let isQuitting = false;
let recordingState: 'idle' | 'recording' | 'transcribing' | 'error' = 'idle';
// user-note: Used to guard auto-paste right after the global hotkey to avoid sending Cmd/Ctrl+V while the hotkey is still in-flight.
let lastGlobalHotkeyAt = 0;
// user-note: Recording can also start without a global hotkey (e.g. UI/memo pad), so guard auto-paste right after recording starts too.
let lastRecordingStartAt = 0;
let lastRecordingLevel = 0;
let lastRecordingErrorMessage: string | null = null;
let isMainWindowTemporarilyAlwaysOnTop = false;
const shownAppWindowIds = new Set<number>();
const activeTranscriptionAborts = new Set<AbortController>();
const settingsStore = new SettingsStore();
const historyStore = new HistoryStore(() => settingsStore.get().historyMaxItems);
const usageStore = new UsageStore();
const statsStore = new StatsStore();
const releaseWatchStore = new ReleaseWatchStore();
const execFileAsync = promisify(execFile);
const DEBUG = process.env.BLITZMEMO_DEBUG === '1';
const OVERLAY_WINDOW_WIDTH = 86;
const OVERLAY_WINDOW_HEIGHT = 28;
const MAIN_WINDOW_DEFAULT_WIDTH = 936;
const MAIN_WINDOW_DEFAULT_HEIGHT = 640;
const trayApi = setupTray({
  settingsStore,
  getRecordingState: () => recordingState,
  // user-note: Tray-triggered window showing on macOS is a common regression point (Spaces/full-screen behavior).
  // Keep tray-specific behavior in openAppUiWindowFromTray() (do not call openAppUiWindow() directly here).
  openAppUiWindow: openAppUiWindowFromTray,
  sendRecordingToggle,
  sendRecordingCancel,
  broadcastSettingsChanged,
  quitApp: () => {
    isQuitting = true;
    app.quit();
  },
  normalizeMicLabel
});
const dockMenuApi = setupDockMenu({
  buildMenuTemplate: () => trayApi.buildAppIconMenuTemplate()
});
const windowsUserTasksApi = setupWindowsUserTasks({
  settingsStore,
  getRecordingState: () => recordingState
});
const hotkeysApi = setupHotkeys({
  settingsStore,
  isQuitting: () => isQuitting,
  getRecordingState: () => recordingState,
  getHotkeySuspensionWindows: () => [mainWindow, memoWindow, historyWindow, dictionaryAddWindow],
  setLastGlobalHotkeyAt: (timestamp) => {
    lastGlobalHotkeyAt = timestamp;
  },
  sendRecordingStart,
  sendRecordingStop,
  sendRecordingCancel
});
const autoPasteApi = setupAutoPaste({
  settingsStore,
  execFileAsync,
  getLastGlobalHotkeyAt: () => lastGlobalHotkeyAt,
  getLastRecordingStartAt: () => lastRecordingStartAt,
  debug: DEBUG
});
// user-note: Auto paste can be dropped when a transcription finishes while a new recording is starting (hotkey/recording overlap),
// so we defer paste into a short-lived queue and flush when it's safe to inject Cmd/Ctrl+V.
const UPDATE_RELEASE_OWNER = 'mssoftjp';
const UPDATE_RELEASE_REPO = 'blitzmemo';
const UPDATE_CHECK_INTERVAL_MS = 6 * 60 * 60 * 1000;
const ABOUT_COPYRIGHT = '© Musashino Software All rights reserved.';
const ABOUT_GITHUB_URL = 'https://github.com/mssoftjp/blitzmemo';
const ABOUT_WEBSITE_URL = 'https://blitzmemo.com/';
const ABOUT_PRIVACY_POLICY_URL = 'https://blitzmemo.com/privacy';

type PendingRecordingStartFocus = {
  windowId: number;
  startedAt: number;
};
let pendingRecordingStartFocus: PendingRecordingStartFocus | null = null;

// user-note: Auto-paste queue is intentionally small and time-bounded to prevent accidental pastes long after the recording ends.
// (implementation lives in src/main/autoPaste/setupAutoPaste.ts)

function disableApplicationMenuOnWindows(): void {
  if (process.platform !== 'win32') return;
  try {
    Menu.setApplicationMenu(null);
  } catch {
    // ignore
  }
}

function disableWindowMenuOnWindows(window: BrowserWindow): void {
  if (process.platform !== 'win32') return;
  try {
    window.setMenu(null);
    window.setAutoHideMenuBar(true);
    window.setMenuBarVisibility(false);
  } catch {
    // ignore
  }
}

function normalizeThemeMode(value: unknown): ThemeMode {
  if (value === 'light' || value === 'dark' || value === 'system') return value;
  return 'system';
}

function getThemeColors(): { appBackgroundColor: string; surfaceColor: string } {
  if (nativeTheme.shouldUseDarkColors) {
    return { appBackgroundColor: '#0f0f12', surfaceColor: '#1b1b20' };
  }
  return { appBackgroundColor: '#f6f6f6', surfaceColor: '#ffffff' };
}

function updateWindowThemeColors(): void {
  const { appBackgroundColor, surfaceColor } = getThemeColors();
  mainWindow?.setBackgroundColor(appBackgroundColor);
  historyWindow?.setBackgroundColor(appBackgroundColor);
  dictionaryAddWindow?.setBackgroundColor(appBackgroundColor);
  if (process.platform === 'darwin' || process.platform === 'win32') {
    memoWindow?.setBackgroundColor(surfaceColor);
  }
}

function shouldRaiseMainWindowAboveMemo(): boolean {
  if (!memoWindow || memoWindow.isDestroyed()) return false;
  const memoVisible = memoWindow.isVisible();
  if (!memoVisible) return false;
  return settingsStore.get().memoPadAlwaysOnTop;
}

function setMainWindowTemporarilyAlwaysOnTop(enabled: boolean): void {
  if (!mainWindow) return;
  if (enabled === isMainWindowTemporarilyAlwaysOnTop) return;
  try {
    if (enabled) {
      mainWindow.setAlwaysOnTop(true, 'floating');
    } else {
      mainWindow.setAlwaysOnTop(false);
    }
    isMainWindowTemporarilyAlwaysOnTop = enabled;
  } catch {
    // ignore
  }
}

function setWindowFocusable(win: BrowserWindow | null, focusable: boolean): void {
  if (!win) return;
  if (win.isDestroyed()) return;
  try {
    win.setFocusable(focusable);
  } catch {
    // ignore
  }
}

function rememberRecordingStartFocus(event: IpcMainInvokeEvent): void {
  const win = BrowserWindow.fromWebContents(event.sender);
  if (!win) return;
  if (win.isDestroyed()) return;
  try {
    if (!win.isVisible()) return;
  } catch {
    // ignore
  }
  pendingRecordingStartFocus = { windowId: win.id, startedAt: Date.now() };
}

function restoreRecordingStartFocusIfNeeded(nextState: typeof recordingState): void {
  const pending = pendingRecordingStartFocus;
  if (!pending) return;

  const ageMs = Date.now() - pending.startedAt;
  if (ageMs > 5_000) {
    pendingRecordingStartFocus = null;
    return;
  }

  if (nextState !== 'recording' && nextState !== 'error') return;
  pendingRecordingStartFocus = null;

  const win = BrowserWindow.fromId(pending.windowId);
  if (!win) return;
  if (win.isDestroyed()) return;
  try {
    if (!win.isVisible()) return;
  } catch {
    // ignore
  }

  try {
    app.focus({ steal: true });
  } catch {
    // ignore
  }
  try {
    win.focus();
  } catch {
    // ignore
  }
  try {
    win.moveTop();
  } catch {
    // ignore
  }
}

function ensureMainWindowWidthOnShow(): void {
  const win = mainWindow;
  if (!win) return;
  try {
    const bounds = win.getBounds();
    if (bounds.width >= MAIN_WINDOW_DEFAULT_WIDTH) return;

    const display = screen.getDisplayMatching(bounds);
    const workArea = display.workArea;
    const nextWidth = Math.min(MAIN_WINDOW_DEFAULT_WIDTH, workArea.width);
    const maxX = workArea.x + workArea.width - nextWidth;
    const nextX = Math.min(Math.max(bounds.x, workArea.x), maxX);
    win.setBounds({ x: nextX, y: bounds.y, width: nextWidth, height: bounds.height }, true);
  } catch {
    // ignore
  }
}

function applyThemeMode(mode: ThemeMode): void {
  const next = normalizeThemeMode(mode);
  try {
    nativeTheme.themeSource = next;
  } catch {
    // ignore
  }
  updateWindowThemeColors();
  setTrayState(recordingState);
}

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

type TranscribeQueueItem = {
  payload: TranscribePayload;
  resolve: (value: TranscribeResult) => void;
};

const transcribeQueue: TranscribeQueueItem[] = [];
let transcribeWorkerRunning = false;

function cancelPendingTranscriptions(): void {
  for (const controller of activeTranscriptionAborts) {
    controller.abort();
  }
  activeTranscriptionAborts.clear();

  while (transcribeQueue.length > 0) {
    const item = transcribeQueue.shift();
    item?.resolve({ ok: false, canceled: true, errorCode: 'canceled' });
  }
}

function isBlitzmemoFocused(): boolean {
  const focusedWindow = BrowserWindow.getFocusedWindow();
  if (!focusedWindow) return false;
  try {
    return focusedWindow.isVisible();
  } catch {
    return false;
  }
}

async function handleTranscribePayload(payload: TranscribePayload): Promise<TranscribeResult> {
  const apiKey = settingsStore.getApiKey() ?? process.env.OPENAI_API_KEY ?? null;
  if (!apiKey) {
    return { ok: false, errorCode: 'apiKey.notSet' };
  }

  const audioData = payload.audioData instanceof ArrayBuffer ? payload.audioData : null;
  if (!audioData) {
    return { ok: false, errorCode: 'invalidPayload', error: 'Invalid audio data' };
  }
  const mimeType = typeof payload.mimeType === 'string' ? payload.mimeType : '';

  const abortController = new AbortController();
  activeTranscriptionAborts.add(abortController);

  const startedAt = Date.now();
  try {
    const settings = settingsStore.get();
    const { language, model } = settings;
    const requestSilenceProcessingMode = payload.silenceProcessingMode ?? settings.silenceProcessingMode;
    const durationSecondsRaw = payload.durationSeconds;
    const durationSeconds = Number.isFinite(durationSecondsRaw)
      ? Math.max(0, Math.min(24 * 60 * 60, Number(durationSecondsRaw)))
      : 0;
    const endedAtRaw = payload.endedAt;
    const endedAt =
      typeof endedAtRaw === 'number' && Number.isFinite(endedAtRaw) ? Math.max(0, Math.floor(endedAtRaw)) : Date.now();
    const timeoutMs = getApiTimeoutMsForAudioSeconds(durationSeconds);

    if (DEBUG) {
      const bytes = audioData.byteLength;
      console.debug(
        `[transcribe] start model=${model} lang=${language} mime=${mimeType} duration=${durationSeconds.toFixed(2)}s bytes=${bytes}`
      );
      const ext = mimeType.includes('ogg')
        ? 'ogg'
        : mimeType.includes('webm')
          ? 'webm'
          : 'bin';
      const filePath = path.join(app.getPath('temp'), `blitzmemo-debug-last.${ext}`);
      try {
        await fs.writeFile(filePath, Buffer.from(audioData));
        console.debug(`[transcribe] saved audio to ${filePath}`);
      } catch (error) {
        console.debug(
          `[transcribe] failed to save audio: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    const rawTranscript = await transcribeWithOpenAI({
      apiKey,
      audioData,
      mimeType,
      language,
      model,
      silenceProcessingMode: requestSilenceProcessingMode,
      signal: abortController.signal,
      timeoutMs
    });
    if (abortController.signal.aborted) return { ok: false, canceled: true, errorCode: 'canceled' };

    await usageStore.addAudioSeconds(model, durationSeconds);

    let transcript = rawTranscript;
    const { dictionaryEnabled, dictionaryRulesText } = settingsStore.get();
    if (dictionaryEnabled && dictionaryRulesText.trim().length > 0 && transcript.trim().length > 0) {
      const { errors, rules } = parseDictionaryRules(dictionaryRulesText);
      if (errors.length === 0 && rules.length > 0) {
        transcript = applyDictionaryRules(transcript, rules);
      }
    }
    if (abortController.signal.aborted) return { ok: false, canceled: true, errorCode: 'canceled' };

    const { translationEnabled, translationTarget } = settingsStore.get();
    const shouldTranslate =
      Boolean(
        translationEnabled &&
          translationTarget !== language &&
          transcript &&
          transcript.trim().length > 0
      );
    let text = transcript;
    if (shouldTranslate) {
      text = await translateWithOpenAI({
        apiKey,
        inputText: transcript,
        sourceLanguage: language,
        targetLanguage: translationTarget,
        signal: abortController.signal,
        timeoutMs
      });
    }
    if (abortController.signal.aborted) return { ok: false, canceled: true, errorCode: 'canceled' };

    const hasText = text.trim().length > 0;
    if (hasText) {
      const waitSeconds = Math.max(0, Math.min(24 * 60 * 60, (Date.now() - endedAt) / 1000));
      await statsStore.addTranscription({ endedAt, durationSeconds, waitSeconds, language, model, text });
    }
    const { autoPaste } = settingsStore.get();
    // user-note: When Blitzmemo is frontmost, treat auto-paste as effectively disabled.
    // Otherwise, Cmd/Ctrl+V can end up pasting into Blitzmemo itself (e.g. Memo Pad) and cause duplicate text.
    const shouldAutoPaste = autoPaste && !isBlitzmemoFocused();
    const didCopy = false;

    let didPaste = false;
    let pasteError: string | undefined;
    if (hasText && shouldAutoPaste) {
      const pasteResult = await requestAutoPaste(text);
      didPaste = pasteResult.didPaste;
      pasteError = pasteResult.error;
    }
    if (abortController.signal.aborted) return { ok: false, canceled: true, errorCode: 'canceled' };

    await historyStore.add({
      language,
      model,
      transcript,
      text,
      translated: shouldTranslate,
      ...(shouldTranslate ? { translationTarget } : {})
    });
    historyWindow?.webContents.send('history:updated');
    const { memoPadAutoMemo } = settingsStore.get();
    if (memoPadAutoMemo && text && text.trim().length > 0) {
      try {
        await ensureMemoWindow();
        memoWindow?.webContents.send('memo:appendText', text);
      } catch (error) {
        if (DEBUG) {
          console.debug(
            `[transcribe] failed to append to memo: ${error instanceof Error ? error.message : 'Unknown error'}`
          );
        }
      }
    }

    if (DEBUG) {
      const elapsedMs = Date.now() - startedAt;
      const pasteErrorShort = pasteError
        ? pasteError.trim().replaceAll('\n', ' ').replaceAll('\r', ' ').replace(/\s+/g, ' ').slice(0, 180)
        : '';
      console.debug(
        `[transcribe] done ok elapsed=${elapsedMs}ms textLen=${text.trim().length} transcriptLen=${transcript.trim().length} didCopy=${didCopy} didPaste=${didPaste} pasteError=${pasteErrorShort || 'no'}`
      );
    }

    return { ok: true, text, transcript, didCopy, didPaste, pasteError };
  } catch (error) {
    if (abortController.signal.aborted) {
      return { ok: false, canceled: true, errorCode: 'canceled' };
    }
    if (DEBUG) {
      const elapsedMs = Date.now() - startedAt;
      console.debug(
        `[transcribe] done error elapsed=${elapsedMs}ms ${error instanceof Error ? error.message : t('en', 'detail.transcribe.failed')}`
      );
    }
    return {
      ok: false,
      error: error instanceof Error ? error.message : t('en', 'detail.transcribe.failed'),
      errorCode: 'transcribe.failed'
    };
  } finally {
    activeTranscriptionAborts.delete(abortController);
  }
}

async function drainTranscribeQueue(): Promise<void> {
  if (transcribeWorkerRunning) return;
  transcribeWorkerRunning = true;
  try {
    while (transcribeQueue.length > 0) {
      const item = transcribeQueue.shift();
      if (!item) continue;
      try {
        const result = await handleTranscribePayload(item.payload);
        item.resolve(result);
      } catch (error) {
        item.resolve({
          ok: false,
          error: error instanceof Error ? error.message : t('en', 'detail.transcribe.failed'),
          errorCode: 'transcribe.failed'
        });
      }
    }
  } finally {
    transcribeWorkerRunning = false;
  }
}

function enqueueTranscribe(payload: TranscribePayload): Promise<TranscribeResult> {
  return new Promise((resolve) => {
    transcribeQueue.push({ payload, resolve });
    void drainTranscribeQueue();
  });
}

function startWindowsTrayThemeWatcher(): void {
  trayApi.startWindowsTrayThemeWatcher();
}

function stopWindowsTrayThemeWatcher(): void {
  trayApi.stopWindowsTrayThemeWatcher();
}

function applyDockIcon(): void {
  if (process.platform !== 'darwin') return;
  if (app.isPackaged) return;
  if (!app.dock) return;
  try {
    app.dock.setIcon(nativeImage.createFromPath(getAppIconPath()));
  } catch {
    // ignore
  }
}

function showWindow(options: { focus?: boolean } = {}): void {
  if (!mainWindow) return;
  setWindowFocusable(mainWindow, true);
  setMainWindowTemporarilyAlwaysOnTop(shouldRaiseMainWindowAboveMemo());
  const shouldNormalizeWidth = !mainWindow.isVisible() || mainWindow.isMinimized();
  if (shouldNormalizeWidth) {
    ensureMainWindowWidthOnShow();
  }
  showAppWindow(mainWindow, options);
  updateTrayMenu();
}

function hideWindow(): void {
  if (!mainWindow) return;
  setMainWindowTemporarilyAlwaysOnTop(false);
  mainWindow.hide();
  setWindowFocusable(mainWindow, false);
  updateTrayMenu();
}

function trackAppWindow(win: BrowserWindow): void {
  const id = win.id;
  win.on('show', () => {
    shownAppWindowIds.add(id);
  });
  win.on('closed', () => {
    shownAppWindowIds.delete(id);
  });
}

function showAppWindow(win: BrowserWindow, options: { focus?: boolean } = {}): void {
  if (win.isDestroyed()) return;
  if (win.isMinimized()) {
    win.restore();
  }
  const focus = options.focus ?? true;

  if (process.platform !== 'darwin') {
    try {
      if (focus) {
        win.show();
        win.focus();
      } else {
        win.showInactive();
      }
    } catch {
      win.show();
      if (focus) {
        try {
          win.focus();
        } catch {
          // ignore
        }
      }
    }
    return;
  }

  if (!focus) {
    try {
      win.showInactive();
    } catch {
      win.show();
    }
    return;
  }

  // Avoid showing normal app windows above other apps' full-screen spaces.
  // Show the window on non-full-screen workspaces first, then restore default behavior.
  //
  // NOTE: Keep this block synchronous (no delayed timers / intervals). On macOS, leaving a *focused* window
  // "visible on all workspaces" even briefly can fight with Mission Control trackpad Space swipes and pull the
  // user back to the window's original Space when the visibility is restored.
  //
  // user-note: This behavior has regressed multiple times. In particular, restoring `setVisibleOnAllWorkspaces(false)`
  // immediately after `show()` can move the window into the *current* Space. If the user triggered this from another
  // app's full-screen Space, that makes the window appear over full-screen again. To keep the behavior stable, only
  // restore after the window actually receives focus (i.e. once macOS has switched to a non-full-screen workspace).
  let didJoinAllWorkspaces = false;
  try {
    win.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: false });
    didJoinAllWorkspaces = true;
  } catch {
    // ignore
  }

  try {
    let didRestoreWorkspaces = false;
    const restoreWorkspaces = (): void => {
      if (didRestoreWorkspaces) return;
      didRestoreWorkspaces = true;
      if (!didJoinAllWorkspaces || win.isDestroyed()) return;
      try {
        win.setVisibleOnAllWorkspaces(false);
      } catch {
        // ignore
      }
      try {
        win.off('focus', restoreWorkspaces);
      } catch {
        // ignore
      }
      try {
        win.off('closed', restoreWorkspaces);
      } catch {
        // ignore
      }
      try {
        win.moveTop();
      } catch {
        // ignore
      }
    };

    // Restore visibility after the window actually gains focus (usually implies we're on a non-full-screen workspace).
    try {
      win.on('focus', restoreWorkspaces);
      win.on('closed', restoreWorkspaces);
    } catch {
      // ignore
    }

    try {
      app.focus({ steal: true });
    } catch {
      // ignore
    }
    win.show();
    win.focus();

    // If focus succeeded synchronously, restore immediately; otherwise keep the window on all non-full-screen
    // workspaces until focus happens.
    try {
      if (win.isFocused()) {
        restoreWorkspaces();
      }
    } catch {
      // ignore
    }
  } catch {
    win.show();
    try {
      win.focus();
    } catch {
      // ignore
    }
  }
}

type AppUiWindowKey = 'memo' | 'history' | 'preferences';
const APP_UI_WINDOW_PRIORITY: AppUiWindowKey[] = ['memo', 'history', 'preferences'];

function getAppUiWindow(key: AppUiWindowKey): BrowserWindow | null {
  if (key === 'memo') return memoWindow;
  if (key === 'history') return historyWindow;
  return mainWindow;
}

function isAppUiWindowPlaced(win: BrowserWindow): boolean {
  return shownAppWindowIds.has(win.id);
}

function isWindowFullScreenSafe(win: BrowserWindow): boolean {
  try {
    return win.isFullScreen();
  } catch {
    return false;
  }
}

function getPlacedAppUiWindowByPriority(): { key: AppUiWindowKey; win: BrowserWindow } | null {
  for (const key of APP_UI_WINDOW_PRIORITY) {
    const win = getAppUiWindow(key);
    if (!win) continue;
    try {
      if (win.isDestroyed()) continue;
    } catch {
      continue;
    }
    if (!isAppUiWindowPlaced(win)) continue;
    return { key, win };
  }
  return null;
}

function getAnchorAppUiWindow(target: AppUiWindowKey): BrowserWindow | null {
  for (const key of APP_UI_WINDOW_PRIORITY) {
    if (key === target) continue;
    const win = getAppUiWindow(key);
    if (!win) continue;
    try {
      if (win.isDestroyed()) continue;
    } catch {
      continue;
    }
    if (!isAppUiWindowPlaced(win)) continue;
    if (isWindowFullScreenSafe(win)) continue;
    return win;
  }
  return null;
}

async function openAppUiWindow(target: AppUiWindowKey): Promise<void> {
  const existing = getAppUiWindow(target);
  if (existing && !existing.isDestroyed() && isAppUiWindowPlaced(existing)) {
    if (target === 'memo') {
      showMemoWindow();
      return;
    }
    if (target === 'history') {
      showHistoryWindow();
      return;
    }
    showWindow();
    return;
  }

  const anchor = getAnchorAppUiWindow(target);
  if (anchor) {
    showAppWindow(anchor);
  }

  if (target === 'memo') {
    await ensureMemoWindow();
    showMemoWindow();
    return;
  }
  if (target === 'history') {
    await ensureHistoryWindow();
    showHistoryWindow();
    return;
  }

  if (!mainWindow) {
    await createWindow();
  }
  showWindow();
}

async function openAppUiWindowFromTray(target: AppUiWindowKey): Promise<void> {
  // user-note: On macOS, opening windows from the tray while another app is in a full-screen Space is tricky.
  // Showing a window without stealing focus can keep it off full-screen Spaces, but it may also open in a different
  // Space and become hard to find. Prefer focusing the window so macOS switches to it, and rely on showAppWindow()
  // to keep normal windows off other apps' full-screen Spaces.
  //
  // Manual check (macOS):
  // - Put another app into full-screen, then open Memo/History/Preferences from the tray.
  // - The window should not appear above the other app's full-screen Space and should be discoverable (focused).
  const focus = true;

  const existing = getAppUiWindow(target);
  if (existing && !existing.isDestroyed() && isAppUiWindowPlaced(existing)) {
    if (target === 'memo') {
      showMemoWindow({ focus });
      return;
    }
    if (target === 'history') {
      showHistoryWindow({ focus });
      return;
    }
    showWindow({ focus });
    return;
  }

  if (target === 'memo') {
    await ensureMemoWindow();
    showMemoWindow({ focus });
    return;
  }
  if (target === 'history') {
    await ensureHistoryWindow();
    showHistoryWindow({ focus });
    return;
  }

  if (!mainWindow) {
    await createWindow();
  }
  showWindow({ focus });
}

function updateTrayMenu(): void {
  trayApi.updateTrayMenu();
  dockMenuApi.updateDockMenu();
  windowsUserTasksApi.syncWindowsUserTasks();
}

function popupTrayMenuInWindow(window: BrowserWindow, x?: number, y?: number): void {
  trayApi.popupTrayMenuInWindow(window, x, y);
}

function setTrayState(state: typeof recordingState): void {
  trayApi.setTrayState(state);
  dockMenuApi.updateDockMenu();
  windowsUserTasksApi.syncWindowsUserTasks();
}

function createTray(): void {
  trayApi.createTray();
  dockMenuApi.updateDockMenu();
  windowsUserTasksApi.syncWindowsUserTasks();
}

function setOverlayState(state: typeof recordingState): void {
  setOverlayStateImpl(
    {
      overlayWindowWidth: OVERLAY_WINDOW_WIDTH,
      overlayWindowHeight: OVERLAY_WINDOW_HEIGHT,
      settingsStore,
      getRecordingState: () => recordingState,
      getLastRecordingLevel: () => lastRecordingLevel,
      getOverlayWindow: () => overlayWindow,
      setOverlayWindow: (win) => {
        overlayWindow = win;
      },
      getAppUiWindows: () => [mainWindow, memoWindow, historyWindow, dictionaryAddWindow]
    },
    state
  );
}


function broadcastRecordingState(state: typeof recordingState, message?: string): void {
  mainWindow?.webContents.send('recording:stateChanged', state, message);
  memoWindow?.webContents.send('recording:stateChanged', state, message);
}

function broadcastRecordingLevel(level: number): void {
  memoWindow?.webContents.send('recording:level', level);
  overlayWindow?.webContents.send('overlay:setLevel', level);
}

function getSettingsChangedPayload(): SettingsChangedPayload {
  const s = settingsStore.get();
  return {
    autoPaste: s.autoPaste,
    memoPadAutoMemo: s.memoPadAutoMemo,
    memoPadInsertAtCursor: s.memoPadInsertAtCursor,
    memoPadEditorFontSizePx: s.memoPadEditorFontSizePx,
    memoPadUndoMaxSteps: s.memoPadUndoMaxSteps,
    translationEnabled: s.translationEnabled,
    translationTarget: s.translationTarget
  };
}

function broadcastSettingsChanged(): void {
  const payload = getSettingsChangedPayload();
  mainWindow?.webContents.send('settings:changed', payload);
  memoWindow?.webContents.send('settings:changed', payload);
}

function broadcastUiLanguageChanged(): void {
  const uiLanguage = settingsStore.get().uiLanguage;
  mainWindow?.webContents.send('uiLanguage:changed', uiLanguage);
  memoWindow?.webContents.send('uiLanguage:changed', uiLanguage);
  historyWindow?.webContents.send('uiLanguage:changed', uiLanguage);
  dictionaryAddWindow?.webContents.send('uiLanguage:changed', uiLanguage);
  overlayWindow?.webContents.send('uiLanguage:changed', uiLanguage);
}

function broadcastAccentColorChanged(): void {
  const accentColor = settingsStore.get().accentColor;
  mainWindow?.webContents.send('accentColor:changed', accentColor);
  memoWindow?.webContents.send('accentColor:changed', accentColor);
  historyWindow?.webContents.send('accentColor:changed', accentColor);
  dictionaryAddWindow?.webContents.send('accentColor:changed', accentColor);
  overlayWindow?.webContents.send('accentColor:changed', accentColor);
}

async function createOverlayWindow(): Promise<void> {
  await ensureOverlayWindowImpl({
    overlayWindowWidth: OVERLAY_WINDOW_WIDTH,
    overlayWindowHeight: OVERLAY_WINDOW_HEIGHT,
    settingsStore,
    getRecordingState: () => recordingState,
    getLastRecordingLevel: () => lastRecordingLevel,
    getOverlayWindow: () => overlayWindow,
    setOverlayWindow: (win) => {
      overlayWindow = win;
    },
    getAppUiWindows: () => [mainWindow, memoWindow, historyWindow, dictionaryAddWindow]
  });
}


function isAccessibilityTrusted(): boolean {
  return autoPasteApi.isAccessibilityTrusted();
}

function scheduleAutoPasteFlush(delayMs: number): void {
  autoPasteApi.scheduleAutoPasteFlush(delayMs);
}

// user-note: Returns immediate paste result when safe; otherwise queues and schedules a best-effort flush later.
async function requestAutoPaste(text: string): Promise<{ didPaste: boolean; error?: string }> {
  return autoPasteApi.requestAutoPaste(text);
}

function broadcastMemoButtonLayout(): void {
  broadcastMemoButtonLayoutImpl(settingsStore, memoWindow);
}

// Derived internally to avoid user misconfiguration.
// Audio: 20s + duration*1.5, Text: 30s + chars/10, clamped to [10, 420] seconds.
const API_TIMEOUT_AUDIO_BASE_SECONDS = 20;
const API_TIMEOUT_AUDIO_SECONDS_MULTIPLIER = 1.5;
const API_TIMEOUT_TEXT_BASE_SECONDS = 30;
const API_TIMEOUT_TEXT_CHARS_PER_SECOND = 10;
const API_TIMEOUT_MIN_SECONDS = 10;
const API_TIMEOUT_MAX_SECONDS = 420;

function normalizeApiTimeoutSeconds(seconds: number): number {
  const normalized = Number.isFinite(seconds) ? seconds : API_TIMEOUT_MIN_SECONDS;
  return Math.max(API_TIMEOUT_MIN_SECONDS, Math.min(API_TIMEOUT_MAX_SECONDS, Math.ceil(normalized)));
}

function getApiTimeoutMsForAudioSeconds(durationSeconds: number): number {
  const audioSeconds = Number.isFinite(durationSeconds) ? Math.max(0, durationSeconds) : 0;
  const timeoutSeconds = API_TIMEOUT_AUDIO_BASE_SECONDS + audioSeconds * API_TIMEOUT_AUDIO_SECONDS_MULTIPLIER;
  return normalizeApiTimeoutSeconds(timeoutSeconds) * 1000;
}

function getApiTimeoutMsForText(text: string): number {
  const length = typeof text === 'string' ? text.length : 0;
  const timeoutSeconds = API_TIMEOUT_TEXT_BASE_SECONDS + length / API_TIMEOUT_TEXT_CHARS_PER_SECOND;
  return normalizeApiTimeoutSeconds(timeoutSeconds) * 1000;
}

async function ensureMemoWindow(): Promise<void> {
  await ensureMemoWindowImpl({
    settingsStore,
    getThemeColors,
    getMemoWindow: () => memoWindow,
    setMemoWindow: (win) => {
      memoWindow = win;
    },
    getDictionaryAddWindow: () => dictionaryAddWindow,
    setDictionaryAddWindow: (win) => {
      dictionaryAddWindow = win;
    },
    isQuitting: () => isQuitting,
    trackAppWindow,
    disableWindowMenuOnWindows,
    getRecordingState: () => recordingState,
    getLastRecordingErrorMessage: () => lastRecordingErrorMessage,
    getLastRecordingLevel: () => lastRecordingLevel
  });
}


function showMemoWindow(options: { focus?: boolean } = {}): void {
  if (!memoWindow) return;
  showAppWindow(memoWindow, options);
}

function sendRecordingToggle(): void {
  mainWindow?.webContents.send('recording:toggle');
}

function sendRecordingStart(): void {
  mainWindow?.webContents.send('recording:start');
}

function sendRecordingStop(): void {
  mainWindow?.webContents.send('recording:stop');
}

function sendRecordingCancel(): void {
  mainWindow?.webContents.send('recording:cancel');
}

function clearGlobalHotkeyPttSession(): void {
  hotkeysApi.clearGlobalHotkeyPttSession();
}

function setCancelHotkeyEnabled(enabled: boolean): void {
  hotkeysApi.setCancelHotkeyEnabled(enabled);
}

function registerGlobalHotkey(hotkey: string): void {
  hotkeysApi.registerGlobalHotkey(hotkey);
}

function tryRegisterHotkey(hotkey: string): { ok: boolean; errorCode?: ApiErrorCode; error?: string } {
  return hotkeysApi.tryRegisterHotkey(hotkey);
}

function updateHotkeySuspension(): void {
  hotkeysApi.updateHotkeySuspension();
}

async function createWindow(): Promise<void> {
  mainWindow = await createMainWindow({
    defaultWidth: MAIN_WINDOW_DEFAULT_WIDTH,
    defaultHeight: MAIN_WINDOW_DEFAULT_HEIGHT,
    isQuitting: () => isQuitting,
    getThemeColors,
    setWindowFocusable,
    disableWindowMenuOnWindows,
    trackAppWindow,
    hideWindow,
    updateTrayMenu,
    onClosed: () => {
      mainWindow = null;
    }
  });
}

function showHistoryWindow(options: { focus?: boolean } = {}): void {
  if (!historyWindow) return;
  showAppWindow(historyWindow, options);
}

async function ensureHistoryWindow(): Promise<void> {
  await ensureHistoryWindowImpl({
    getHistoryWindow: () => historyWindow,
    setHistoryWindow: (win) => {
      historyWindow = win;
    },
    isQuitting: () => isQuitting,
    getThemeColors,
    getHistoryAlwaysOnTop: () => settingsStore.get().historyAlwaysOnTop,
    disableWindowMenuOnWindows,
    trackAppWindow
  });
}

function normalizeMicLabel(value: unknown): string {
  const normalized = typeof value === 'string' ? value.trim() : '';
  return normalized.length > 0 ? normalized : 'undefined';
}

function setupIpc(): void {
  // user-note: IPC registrations live in a dedicated module to keep main.ts maintainable.
  const ctx = {
    settingsStore,
    historyStore,
    usageStore,
    statsStore,
    releaseWatchStore,
    about: {
      copyright: ABOUT_COPYRIGHT,
      githubUrl: ABOUT_GITHUB_URL,
      websiteUrl: ABOUT_WEBSITE_URL,
      privacyPolicyUrl: ABOUT_PRIVACY_POLICY_URL
    },
    applyThemeMode,
    openAppUiWindow,
    popupTrayMenuInWindow,
    getMemoWindow: () => memoWindow,
    getHistoryWindow: () => historyWindow,
    getRecordingState: () => recordingState,
    setRecordingState: (state) => {
      recordingState = state;
    },
    setLastRecordingStartAt: (timestamp) => {
      lastRecordingStartAt = timestamp;
    },
    setLastRecordingLevel: (level) => {
      lastRecordingLevel = level;
    },
    setLastRecordingErrorMessage: (message) => {
      lastRecordingErrorMessage = message;
    },
    setAudioInputDevices: (devices) => {
      trayApi.setAudioInputDevices(devices);
    },
    setSystemDefaultMicrophoneLabel: (label) => {
      trayApi.setSystemDefaultMicrophoneLabel(label);
    },
    normalizeMicLabel,
    updateTrayMenu,
    syncUpdateCheckLoopEnabled,
    setTrayState,
    setOverlayState,
    restoreRecordingStartFocusIfNeeded,
    broadcastRecordingLevel,
    broadcastRecordingState,
    broadcastUiLanguageChanged,
    broadcastSettingsChanged,
    broadcastAccentColorChanged,
    broadcastMemoButtonLayout,
    clearGlobalHotkeyPttSession,
    setCancelHotkeyEnabled,
    scheduleAutoPasteFlush,
    rememberRecordingStartFocus,
    sendRecordingToggle,
    sendRecordingStart,
    sendRecordingStop,
    sendRecordingCancel,
    cancelPendingTranscriptions,
    enqueueTranscribe,
    tryRegisterHotkey,
    isAccessibilityTrusted,
    getApiTimeoutMsForText
  } satisfies MainIpcContext;
  setupMainIpc(ctx);
}

async function openSoftStartWindows(): Promise<void> {
  const { softStartOpenMemoPad, softStartOpenHistory } = settingsStore.get();
  if (!softStartOpenMemoPad && !softStartOpenHistory) return;

  if (softStartOpenMemoPad) {
    try {
      await ensureMemoWindow();
      showMemoWindow({ focus: false });
    } catch (error) {
      console.error(error);
    }
  }

  if (softStartOpenHistory) {
    try {
      await ensureHistoryWindow();
      showHistoryWindow({ focus: false });
    } catch (error) {
      console.error(error);
    }
  }
}

async function handleAppLaunchActionFromArgv(argv: string[]): Promise<boolean> {
  const action = parseAppLaunchActionFromArgv(argv);
  if (!action) return false;

  if (action === 'open-memo-pad') {
    await openAppUiWindowFromTray('memo');
    return true;
  }

  if (action === 'open-history') {
    await openAppUiWindowFromTray('history');
    return true;
  }

  if (action === 'open-preferences') {
    await openAppUiWindowFromTray('preferences');
    return true;
  }

  if (action === 'toggle-recording') {
    sendRecordingToggle();
    return true;
  }

  if (action === 'cancel-recording') {
    sendRecordingCancel();
    return true;
  }

  if (action === 'quit') {
    isQuitting = true;
    app.quit();
    return true;
  }

  return false;
}

let updateCheckTimeoutTimer: NodeJS.Timeout | null = null;
let updateCheckIntervalTimer: NodeJS.Timeout | null = null;
let updateCheckRunning = false;

function getUpdateNotificationText(version: string): { title: string; body: string } {
  const language = settingsStore.get().uiLanguage;
  if (language === 'ja') {
    return { title: 'アップデート', body: `Blitzmemo ${version} がリリースされました。` };
  }
  return { title: 'Update', body: `Blitzmemo ${version} has been released.` };
}

async function runUpdateCheckOnce(): Promise<void> {
  if (!settingsStore.get().updateCheckEnabled) return;
  if (updateCheckRunning) return;
  updateCheckRunning = true;
  try {
    const latest = await checkForNewGitHubRelease({
      owner: UPDATE_RELEASE_OWNER,
      repo: UPDATE_RELEASE_REPO,
      currentVersion: app.getVersion(),
      store: releaseWatchStore,
      minCheckIntervalMs: UPDATE_CHECK_INTERVAL_MS
    });
    if (!latest) return;

    const { title, body } = getUpdateNotificationText(latest.version);
    try {
      const notification = new Notification({ title, body });
      notification.on('click', () => {
        void shell.openExternal(latest.htmlUrl);
      });
      notification.show();
      void releaseWatchStore.setLastNotifiedVersion(latest.version);
    } catch {
      // ignore
    }
  } catch {
    // ignore
  } finally {
    updateCheckRunning = false;
  }
}

function startUpdateCheckLoop(): void {
  if (updateCheckIntervalTimer) return;

  updateCheckTimeoutTimer = setTimeout(() => {
    updateCheckTimeoutTimer = null;
    void runUpdateCheckOnce();
  }, 30_000);

  updateCheckIntervalTimer = setInterval(() => {
    void runUpdateCheckOnce();
  }, UPDATE_CHECK_INTERVAL_MS);
}

function stopUpdateCheckLoop(): void {
  if (updateCheckTimeoutTimer) {
    clearTimeout(updateCheckTimeoutTimer);
    updateCheckTimeoutTimer = null;
  }
  if (updateCheckIntervalTimer) {
    clearInterval(updateCheckIntervalTimer);
    updateCheckIntervalTimer = null;
  }
}

function syncUpdateCheckLoopEnabled(): void {
  const { updateCheckEnabled } = settingsStore.get();
  if (updateCheckEnabled) {
    startUpdateCheckLoop();
  } else {
    stopUpdateCheckLoop();
  }
}

async function main(): Promise<void> {
  await app.whenReady();
  applyDockIcon();
  startWindowsTrayThemeWatcher();
  nativeTheme.on('updated', () => {
    updateWindowThemeColors();
    setTrayState(recordingState);
  });
  disableApplicationMenuOnWindows();
  setupMacAppMenu({
    openPreferences: () => {
      void openAppUiWindow('preferences');
    }
  });
  await settingsStore.load();
  applyThemeMode(settingsStore.get().themeMode);
  await historyStore.load();
  await usageStore.load();
  await statsStore.load();
  await releaseWatchStore.load();
  setupIpc();
  await createWindow();
  await createOverlayWindow();
  createTray();
  syncUpdateCheckLoopEnabled();
  let handledLaunchAction = false;
  try {
    handledLaunchAction = await handleAppLaunchActionFromArgv(process.argv);
  } catch (error) {
    console.error(error);
  }
  if (!handledLaunchAction) {
    void openSoftStartWindows();
  }
  const scheduleHotkeySuspensionUpdate = () => {
    setTimeout(() => updateHotkeySuspension(), 0);
  };
  const scheduleMainWindowAlwaysOnTopRelease = () => {
    if (!isMainWindowTemporarilyAlwaysOnTop) return;
    setTimeout(() => {
      if (BrowserWindow.getFocusedWindow()) return;
      setMainWindowTemporarilyAlwaysOnTop(false);
    }, 0);
  };
  app.on('browser-window-focus', scheduleHotkeySuspensionUpdate);
  app.on('browser-window-blur', () => {
    scheduleHotkeySuspensionUpdate();
    scheduleMainWindowAlwaysOnTopRelease();
    scheduleAutoPasteFlush(0);
  });
  updateHotkeySuspension();
  registerGlobalHotkey(settingsStore.get().hotkey);
  setTrayState(recordingState);
  setOverlayState(recordingState);

  app.on('activate', () => {
    void (async () => {
      if (!mainWindow) {
        await createWindow();
        createTray();
      }
      const placed = getPlacedAppUiWindowByPriority();
      if (!placed) return;
      if (placed.key === 'memo') {
        showMemoWindow();
        return;
      }
      if (placed.key === 'history') {
        showHistoryWindow();
        return;
      }
      showWindow();
    })();
  });
}

const gotSingleInstanceLock = app.requestSingleInstanceLock();
if (!gotSingleInstanceLock) {
  app.quit();
} else {
  app.on('second-instance', (_event, argv) => {
    void (async () => {
      await app.whenReady();
      try {
        if (await handleAppLaunchActionFromArgv(argv)) return;
      } catch (error) {
        console.error(error);
      }
      const placed = getPlacedAppUiWindowByPriority();
      if (placed) {
        if (placed.key === 'memo') {
          showMemoWindow();
          return;
        }
        if (placed.key === 'history') {
          showHistoryWindow();
          return;
        }
        showWindow();
        return;
      }

      try {
        await openAppUiWindow('preferences');
      } catch (error) {
        console.error(error);
      }
    })();
  });

  app.on('before-quit', () => {
    isQuitting = true;
  });

  app.on('will-quit', () => {
    globalShortcut.unregisterAll();
    stopOverlayFollowImpl();
    stopWindowsTrayThemeWatcher();
  });

  main().catch((error) => {
    console.error(error);
    app.quit();
  });
}
