import { app } from 'electron';
import path from 'node:path';
import type { SettingsStore } from '../settings';
import { FIXED_CANCEL_HOTKEY, formatAcceleratorForDisplay } from '../../shared/hotkey';
import { t, type UiStringKey } from '../../shared/i18n';
import type { AppLaunchAction } from './appLaunchAction';
import { getArgvForAppLaunchAction } from './appLaunchAction';

type RecordingState = 'idle' | 'recording' | 'transcribing' | 'error';

export type SetupWindowsUserTasksOptions = {
  settingsStore: SettingsStore;
  getRecordingState: () => RecordingState;
};

export type WindowsUserTasksApi = {
  syncWindowsUserTasks: () => void;
};

function buildWindowsUserTask(opts: {
  exePath: string;
  workingDirectory: string;
  title: string;
  action: AppLaunchAction;
}): Electron.Task {
  return {
    program: opts.exePath,
    arguments: getArgvForAppLaunchAction(opts.action),
    title: opts.title,
    description: opts.title,
    // user-note: Jump List icons are loaded by Windows Shell (not Electron), so prefer the executable icon.
    iconPath: opts.exePath,
    iconIndex: 0,
    workingDirectory: opts.workingDirectory
  };
}

export function setupWindowsUserTasks(opts: SetupWindowsUserTasksOptions): WindowsUserTasksApi {
  function syncWindowsUserTasks(): void {
    if (process.platform !== 'win32') return;
    if (!app.isReady()) return;

    const settings = opts.settingsStore.get();
    const uiLanguage = settings.uiLanguage;
    const tr = (key: UiStringKey, params?: Record<string, string | number>): string => t(uiLanguage, key, params);

    const activeHotkey = settings.hotkey;
    const activeHotkeyLabel = formatAcceleratorForDisplay(activeHotkey, process.platform) || activeHotkey;
    const cancelHotkeyLabel = formatAcceleratorForDisplay(FIXED_CANCEL_HOTKEY, process.platform) || 'Esc';

    const recordingState = opts.getRecordingState();
    const recordLabel =
      recordingState === 'recording'
        ? tr('tray.record.stopWithHotkey', { hotkey: activeHotkeyLabel })
        : tr('tray.record.startWithHotkey', { hotkey: activeHotkeyLabel });

    const exePath = process.execPath;
    const workingDirectory = path.dirname(exePath);

    // user-note: Windows taskbar right-click cannot be fully customized like a Tray context menu.
    // We expose core actions via Jump List tasks instead.
    const tasks: Electron.Task[] = [
      buildWindowsUserTask({ exePath, workingDirectory, title: recordLabel, action: 'toggle-recording' }),
      buildWindowsUserTask({
        exePath,
        workingDirectory,
        title: `${tr('common.cancel')} (${cancelHotkeyLabel})`,
        action: 'cancel-recording'
      }),
      buildWindowsUserTask({ exePath, workingDirectory, title: tr('tray.memoPad'), action: 'open-memo-pad' }),
      buildWindowsUserTask({ exePath, workingDirectory, title: tr('tray.history'), action: 'open-history' }),
      buildWindowsUserTask({ exePath, workingDirectory, title: tr('prefs.title'), action: 'open-preferences' }),
      buildWindowsUserTask({ exePath, workingDirectory, title: tr('common.quit'), action: 'quit' })
    ];

    try {
      app.setUserTasks(tasks);
    } catch {
      // ignore
    }
  }

  return { syncWindowsUserTasks };
}
