import { BrowserWindow, app } from 'electron';
import { getAppIconPath, getHistoryHtmlPath, getPreloadPath } from '../appPaths';
import { hardenWebContents } from './hardenWebContents';

type ThemeColors = { appBackgroundColor: string; surfaceColor: string };

export type EnsureHistoryWindowOptions = {
  getHistoryWindow: () => BrowserWindow | null;
  setHistoryWindow: (window: BrowserWindow | null) => void;
  isQuitting: () => boolean;
  getThemeColors: () => ThemeColors;
  getHistoryAlwaysOnTop: () => boolean;
  disableWindowMenuOnWindows: (window: BrowserWindow) => void;
  trackAppWindow: (window: BrowserWindow) => void;
};

export async function ensureHistoryWindow(opts: EnsureHistoryWindowOptions): Promise<void> {
  if (opts.getHistoryWindow()) return;

  const isRelease = app.isPackaged;
  const themeColors = opts.getThemeColors();
  const win = new BrowserWindow({
    width: 520,
    height: 680,
    show: false,
    alwaysOnTop: opts.getHistoryAlwaysOnTop(),
    icon: getAppIconPath(),
    backgroundColor: themeColors.appBackgroundColor,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !isRelease
    }
  });

  hardenWebContents(win.webContents, { disableDevToolsShortcuts: isRelease, disableReloadShortcuts: isRelease });

  opts.disableWindowMenuOnWindows(win);
  opts.trackAppWindow(win);
  opts.setHistoryWindow(win);

  win.on('close', (event) => {
    if (opts.isQuitting()) return;
    event.preventDefault();
    win.hide();
  });

  win.on('closed', () => {
    opts.setHistoryWindow(null);
  });

  await win.loadFile(getHistoryHtmlPath());
}
