import { BrowserWindow, Menu, nativeImage, nativeTheme, Tray } from 'electron';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import type { SettingsStore } from '../settings';
import { FIXED_CANCEL_HOTKEY, formatAcceleratorForDisplay } from '../../shared/hotkey';
import { t, type UiStringKey } from '../../shared/i18n';
import { getAssetPath } from '../appPaths';

type RecordingState = 'idle' | 'recording' | 'transcribing' | 'error';
type AppUiWindowKey = 'memo' | 'history' | 'preferences';

export type AudioInputDeviceInfo = { deviceId: string; label: string };

export type SetupTrayOptions = {
  settingsStore: SettingsStore;
  getRecordingState: () => RecordingState;
  openAppUiWindow: (target: AppUiWindowKey) => Promise<void>;
  sendRecordingToggle: () => void;
  sendRecordingCancel: () => void;
  broadcastSettingsChanged: () => void;
  quitApp: () => void;
  normalizeMicLabel: (value: unknown) => string;
};

export type TrayApi = {
  createTray: () => void;
  setTrayState: (state: RecordingState) => void;
  updateTrayMenu: () => void;
  buildAppIconMenuTemplate: () => Electron.MenuItemConstructorOptions[];
  popupTrayMenuInWindow: (window: BrowserWindow, x?: number, y?: number) => void;
  startWindowsTrayThemeWatcher: () => void;
  stopWindowsTrayThemeWatcher: () => void;
  setAudioInputDevices: (devices: AudioInputDeviceInfo[]) => void;
  setSystemDefaultMicrophoneLabel: (label: string | null) => void;
};

// user-note: Tray click handling can be noisy (platform- and configuration-dependent). In particular, a right-click
// (or macOS ctrl+click) can be followed by a `click` event, which could accidentally toggle recording. We delay the
// left-click toggle so a subsequent right-click can cancel the pending toggle.
const TRAY_RECORDING_TOGGLE_DELAY_MS = 180;
const TRAY_TOGGLE_DEBOUNCE_MS = 250;
const TRAY_RIGHT_CLICK_SUPPRESS_MS = 600;

export function setupTray(options: SetupTrayOptions): TrayApi {
  let tray: Tray | null = null;
  const trayIconCache = new Map<string, Electron.NativeImage>();
  let windowsTrayBackgroundIsDark: boolean | null = null;
  let windowsTrayThemePollTimer: NodeJS.Timeout | null = null;
  let windowsTrayThemePollRunning = false;
  let lastTrayToggleAt = 0;
  let lastTrayRightClickAt = 0;
  let trayMenu: Menu | null = null;
  let trayRecordingToggleTimer: NodeJS.Timeout | null = null;
  let audioInputDevices: AudioInputDeviceInfo[] = [];
  let systemDefaultMicrophoneLabel: string | null = null;
  const execFileAsync = promisify(execFile);

  async function queryWindowsTaskbarUsesLightTheme(): Promise<boolean | null> {
    if (process.platform !== 'win32') return null;
    try {
      const { stdout } = await execFileAsync(
        'reg',
        [
          'query',
          'HKCU\\Software\\Microsoft\\Windows\\CurrentVersion\\Themes\\Personalize',
          '/v',
          'SystemUsesLightTheme'
        ],
        { timeout: 2_000 }
      );
      const match = stdout.match(/SystemUsesLightTheme\\s+REG_DWORD\\s+(0x[0-9a-fA-F]+|[0-9]+)/i);
      if (!match) return null;
      const raw = (match[1] ?? '').trim();
      const normalized = raw.toLowerCase();
      const value = normalized.startsWith('0x') ? parseInt(normalized.slice(2), 16) : parseInt(normalized, 10);
      if (!Number.isFinite(value)) return null;
      return value !== 0;
    } catch {
      return null;
    }
  }

  async function pollWindowsTrayThemeOnce(): Promise<void> {
    if (process.platform !== 'win32') return;
    if (windowsTrayThemePollRunning) return;
    windowsTrayThemePollRunning = true;
    try {
      const usesLightTheme = await queryWindowsTaskbarUsesLightTheme();
      if (usesLightTheme === null) return;
      const nextDark = !usesLightTheme;
      if (windowsTrayBackgroundIsDark === nextDark) return;
      windowsTrayBackgroundIsDark = nextDark;
      trayIconCache.clear();
      setTrayState(options.getRecordingState());
    } finally {
      windowsTrayThemePollRunning = false;
    }
  }

  function startWindowsTrayThemeWatcher(): void {
    if (process.platform !== 'win32') return;
    if (windowsTrayThemePollTimer) return;
    void pollWindowsTrayThemeOnce();
    windowsTrayThemePollTimer = setInterval(() => {
      void pollWindowsTrayThemeOnce();
    }, 5_000);
  }

  function stopWindowsTrayThemeWatcher(): void {
    if (!windowsTrayThemePollTimer) return;
    clearInterval(windowsTrayThemePollTimer);
    windowsTrayThemePollTimer = null;
  }

  function isTrayBackgroundDark(): boolean {
    if (process.platform === 'win32' && windowsTrayBackgroundIsDark !== null) {
      return windowsTrayBackgroundIsDark;
    }
    return nativeTheme.shouldUseDarkColors;
  }

  function getTrayIconPath(): string {
    // user-note: tray modules compile into dist/main/tray/*, so __dirname won't point at dist/main.
    // Always resolve icon assets via dist/main/assets (getAssetPath) to avoid missing icons after refactors.
    if (process.platform === 'win32') {
      const filename = isTrayBackgroundDark() ? 'Blitzmemo_tray_white.ico' : 'Blitzmemo_tray_black.ico';
      return getAssetPath(filename);
    }

    const filename = isTrayBackgroundDark() ? 'Blitzmemo_icon_white.png' : 'Blitzmemo_icon_black.png';
    return getAssetPath(filename);
  }

  function getTrayIconPathForState(state: RecordingState): string {
    if (state === 'recording') {
      if (process.platform === 'win32') {
        return getAssetPath('Blitzmemo_tray_recording.ico');
      }
      return getAssetPath('Blitzmemo_icon_recording.png');
    }
    if (state === 'transcribing') {
      if (process.platform === 'win32') {
        return getAssetPath('Blitzmemo_tray_processing.ico');
      }
      return getAssetPath('Blitzmemo_icon_processing.png');
    }
    return getTrayIconPath();
  }

  function getTrayIconCacheKeyForState(state: RecordingState): string {
    if (state === 'recording') return 'tray:recording';
    if (state === 'transcribing') return 'tray:processing';
    return `tray:idle:${isTrayBackgroundDark() ? 'dark' : 'light'}`;
  }

  function buildTrayImage(image: Electron.NativeImage): Electron.NativeImage {
    if (image.isEmpty()) return image;

    if (process.platform === 'darwin') {
      // macOS status bar uses the image size as-is, so passing a large PNG makes the tray icon huge.
      // Provide @1x/@2x representations at a standard menu bar size.
      const size = 18;
      const trayImage = nativeImage.createEmpty();
      for (const scaleFactor of [1, 2]) {
        const px = size * scaleFactor;
        const resized = image.resize({ width: px, height: px, quality: 'best' });
        trayImage.addRepresentation({
          scaleFactor,
          width: px,
          height: px,
          dataURL: resized.toDataURL()
        });
      }
      return trayImage;
    }

    return image;
  }

  function getTrayIconForState(state: RecordingState): Electron.NativeImage {
    const cacheKey = getTrayIconCacheKeyForState(state);
    const cached = trayIconCache.get(cacheKey);
    if (cached) return cached;

    const iconPath = getTrayIconPathForState(state);
    const base = nativeImage.createFromPath(iconPath);
    const image = buildTrayImage(base);

    if (process.platform === 'darwin') {
      // Use template images for normal state so the menu bar can automatically adapt (light/dark, pressed state).
      image.setTemplateImage(state !== 'recording' && state !== 'transcribing');
    }

    trayIconCache.set(cacheKey, image);
    return image;
  }

  function buildTrayMenuTemplate(): Electron.MenuItemConstructorOptions[] {
    const settings = options.settingsStore.get();
    const uiLanguage = settings.uiLanguage;
    const tr = (key: UiStringKey, params?: Record<string, string | number>): string => t(uiLanguage, key, params);
    const activeHotkey = settings.hotkey;
    const activeHotkeyLabel = formatAcceleratorForDisplay(activeHotkey, process.platform) || activeHotkey;
    const cancelHotkeyLabel = formatAcceleratorForDisplay(FIXED_CANCEL_HOTKEY, process.platform) || 'Esc';
    const { autoPaste, memoPadAutoMemo, memoPadInsertAtCursor } = settings;
    const selectedMicDeviceId = settings.micDeviceId;
    const recordingState = options.getRecordingState();

    const statusLabel =
      recordingState === 'recording'
        ? tr('memo.status.recording')
        : recordingState === 'transcribing'
          ? tr('memo.status.transcribing')
          : recordingState === 'error'
            ? tr('memo.status.error')
            : tr('memo.status.idle');

    const recordLabel =
      recordingState === 'recording'
        ? tr('tray.record.stopWithHotkey', { hotkey: activeHotkeyLabel })
        : tr('tray.record.startWithHotkey', { hotkey: activeHotkeyLabel });
    const canToggleRecording = true;
    const canCancel = recordingState === 'recording' || recordingState === 'transcribing';
    const canChangeMicrophone = recordingState !== 'recording';
    const systemDefaultLabel = systemDefaultMicrophoneLabel ?? tr('common.unknown');
    const systemDefaultMenuLabel = tr('tray.systemDefault', { label: systemDefaultLabel });

    const micLabelCounts = new Map<string, number>();
    for (const device of audioInputDevices) {
      const label = options.normalizeMicLabel(device.label);
      micLabelCounts.set(label, (micLabelCounts.get(label) ?? 0) + 1);
    }
    const micLabelIndexes = new Map<string, number>();
    const microphoneSubmenu: Electron.MenuItemConstructorOptions[] = [
      {
        label: systemDefaultMenuLabel,
        type: 'radio',
        checked: selectedMicDeviceId === null,
        // user-note: Keep microphone radio items contiguous. Electron groups radio items by adjacency,
        // and separators split groups, which can make multiple items look "checked" at once (seen on Windows).
        click: () => {
          void options.settingsStore.setMicDeviceId(null).then(() => updateTrayMenu());
        }
      }
    ];
    for (const device of audioInputDevices) {
      const baseLabel = options.normalizeMicLabel(device.label);
      const count = micLabelCounts.get(baseLabel) ?? 0;
      const nextIndex = (micLabelIndexes.get(baseLabel) ?? 0) + 1;
      micLabelIndexes.set(baseLabel, nextIndex);
      const label = count > 1 ? `${baseLabel} (${nextIndex})` : baseLabel;
      microphoneSubmenu.push({
        label,
        type: 'radio',
        checked: selectedMicDeviceId === device.deviceId,
        click: () => {
          void options.settingsStore.setMicDeviceId(device.deviceId).then(() => updateTrayMenu());
        }
      });
    }

    return [
      { label: statusLabel, enabled: false },
      {
        label: tr('tray.microphone'),
        enabled: canChangeMicrophone,
        submenu: microphoneSubmenu
      },
      { type: 'separator' },
      {
        label: recordLabel,
        enabled: canToggleRecording,
        click: () => options.sendRecordingToggle()
      },
      {
        label: `${tr('common.cancel')} (${cancelHotkeyLabel})`,
        enabled: canCancel,
        click: () => options.sendRecordingCancel()
      },
      { type: 'separator' },
      {
        label: tr('tray.memoPad'),
        click: () => {
          void (async () => {
            try {
              await options.openAppUiWindow('memo');
            } catch (error) {
              console.error(error);
            }
          })();
        }
      },
      {
        label: tr('tray.history'),
        click: () => {
          void (async () => {
            try {
              await options.openAppUiWindow('history');
            } catch (error) {
              console.error(error);
            }
          })();
        }
      },
      {
        label: tr('prefs.title'),
        click: () => {
          void (async () => {
            try {
              await options.openAppUiWindow('preferences');
            } catch (error) {
              console.error(error);
            }
          })();
        }
      },
      { type: 'separator' },
      {
        label: tr('prefs.main.autoPaste.label'),
        type: 'checkbox',
        checked: autoPaste,
        click: (item) => {
          void options.settingsStore.setAutoPaste(item.checked);
          updateTrayMenu();
          options.broadcastSettingsChanged();
        }
      },
      {
        label: tr('prefs.main.memoPadAutoMemo.label'),
        type: 'checkbox',
        checked: memoPadAutoMemo,
        click: (item) => {
          void options.settingsStore.setMemoPadAutoMemo(item.checked);
          updateTrayMenu();
          options.broadcastSettingsChanged();
        }
      },
      {
        label: tr('prefs.main.memoPadInsertAtCursor.label'),
        type: 'checkbox',
        checked: memoPadInsertAtCursor,
        enabled: memoPadAutoMemo,
        click: (item) => {
          void options.settingsStore.setMemoPadInsertAtCursor(item.checked);
          updateTrayMenu();
          options.broadcastSettingsChanged();
        }
      },
      { type: 'separator' },
      {
        label: tr('common.quit'),
        click: () => {
          options.quitApp();
        }
      }
    ];
  }

  function updateTrayMenu(): void {
    trayMenu = Menu.buildFromTemplate(buildTrayMenuTemplate());
  }

  function buildAppIconMenuTemplate(): Electron.MenuItemConstructorOptions[] {
    return buildTrayMenuTemplate();
  }

  function popupTrayMenuInWindow(window: BrowserWindow, x?: number, y?: number): void {
    const menu = Menu.buildFromTemplate(buildTrayMenuTemplate());
    menu.popup({ window, x, y });
  }

  function markTrayRightClick(): void {
    lastTrayRightClickAt = Date.now();
  }

  function wasRecentTrayRightClick(): boolean {
    return Date.now() - lastTrayRightClickAt < TRAY_RIGHT_CLICK_SUPPRESS_MS;
  }

  function toggleRecordingFromTray(): void {
    const now = Date.now();
    if (now - lastTrayToggleAt < TRAY_TOGGLE_DEBOUNCE_MS) return;
    lastTrayToggleAt = now;
    options.sendRecordingToggle();
  }

  function cancelTrayRecordingToggle(): void {
    if (!trayRecordingToggleTimer) return;
    clearTimeout(trayRecordingToggleTimer);
    trayRecordingToggleTimer = null;
  }

  function popupTrayMenu(): void {
    if (!tray) return;
    updateTrayMenu();
    const menu = trayMenu ?? Menu.buildFromTemplate(buildTrayMenuTemplate());
    tray.popUpContextMenu(menu);
  }

  function scheduleTrayRecordingToggle(): void {
    cancelTrayRecordingToggle();
    trayRecordingToggleTimer = setTimeout(() => {
      trayRecordingToggleTimer = null;
      toggleRecordingFromTray();
    }, TRAY_RECORDING_TOGGLE_DELAY_MS);
  }

  function setTrayState(state: RecordingState): void {
    if (!tray) return;
    tray.setImage(getTrayIconForState(state));
    const uiLanguage = options.settingsStore.get().uiLanguage;
    tray.setToolTip(
      state === 'recording' ? t(uiLanguage, 'tray.tooltip.recording') : t(uiLanguage, 'tray.tooltip.default')
    );
    updateTrayMenu();
  }

  function createTray(): void {
    if (tray) return;

    tray = new Tray(getTrayIconForState(options.getRecordingState()));
    tray.setToolTip(t(options.settingsStore.get().uiLanguage, 'tray.tooltip.default'));

    tray.on('click', (event) => {
      if (wasRecentTrayRightClick()) return;
      if (process.platform === 'darwin' && event.ctrlKey) {
        markTrayRightClick();
        cancelTrayRecordingToggle();
        popupTrayMenu();
        return;
      }
      const action = options.settingsStore.get().trayLeftClickAction;
      if (action === 'toggleRecording') {
        scheduleTrayRecordingToggle();
        return;
      }

      cancelTrayRecordingToggle();

      if (action === 'showMenu') {
        popupTrayMenu();
        return;
      }

      if (action === 'openMemoPad') {
        void (async () => {
          try {
            await options.openAppUiWindow('memo');
          } catch (error) {
            console.error(error);
          }
        })();
        return;
      }

      if (action === 'openHistory') {
        void (async () => {
          try {
            await options.openAppUiWindow('history');
          } catch (error) {
            console.error(error);
          }
        })();
        return;
      }

      if (action === 'openPreferences') {
        void (async () => {
          try {
            await options.openAppUiWindow('preferences');
          } catch (error) {
            console.error(error);
          }
        })();
      }
    });

    tray.on('right-click', () => {
      markTrayRightClick();
      cancelTrayRecordingToggle();
      popupTrayMenu();
    });

    updateTrayMenu();
  }

  function setAudioInputDevices(devices: AudioInputDeviceInfo[]): void {
    audioInputDevices = devices;
  }

  function setSystemDefaultMicrophoneLabel(label: string | null): void {
    systemDefaultMicrophoneLabel = label;
  }

  return {
    createTray,
    setTrayState,
    updateTrayMenu,
    buildAppIconMenuTemplate,
    popupTrayMenuInWindow,
    startWindowsTrayThemeWatcher,
    stopWindowsTrayThemeWatcher,
    setAudioInputDevices,
    setSystemDefaultMicrophoneLabel
  };
}
