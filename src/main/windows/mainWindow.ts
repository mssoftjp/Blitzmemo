import { BrowserWindow, app } from 'electron';
import { getAppIconPath, getIndexHtmlPath, getPreloadPath } from '../appPaths';
import { hardenWebContents } from './hardenWebContents';

type ThemeColors = { appBackgroundColor: string; surfaceColor: string };

export type CreateMainWindowOptions = {
  defaultWidth: number;
  defaultHeight: number;
  isQuitting: () => boolean;
  getThemeColors: () => ThemeColors;
  setWindowFocusable: (window: BrowserWindow, focusable: boolean) => void;
  disableWindowMenuOnWindows: (window: BrowserWindow) => void;
  trackAppWindow: (window: BrowserWindow) => void;
  hideWindow: () => void;
  updateTrayMenu: () => void;
  onClosed: () => void;
};

export async function createMainWindow(opts: CreateMainWindowOptions): Promise<BrowserWindow> {
  const isRelease = app.isPackaged;
  const themeColors = opts.getThemeColors();
  const win = new BrowserWindow({
    width: opts.defaultWidth,
    height: opts.defaultHeight,
    show: false,
    skipTaskbar: false,
    icon: getAppIconPath(),
    backgroundColor: themeColors.appBackgroundColor,
    webPreferences: {
      preload: getPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      backgroundThrottling: false,
      devTools: !isRelease
    }
  });

  hardenWebContents(win.webContents, { disableDevToolsShortcuts: isRelease, disableReloadShortcuts: isRelease });

  opts.setWindowFocusable(win, false);
  opts.disableWindowMenuOnWindows(win);
  opts.trackAppWindow(win);

  win.on('close', (event) => {
    if (opts.isQuitting()) return;
    event.preventDefault();
    opts.hideWindow();
  });

  win.on('closed', () => {
    opts.onClosed();
  });

  win.on('show', () => {
    // Some code paths show the preferences window without going through showWindow() (which sets focusable).
    // If focusable stays false, the renderer can't receive keyboard focus and inputs (e.g. dictionary rows) feel "dead".
    opts.setWindowFocusable(win, true);
    opts.updateTrayMenu();
  });

  win.on('hide', () => {
    opts.setWindowFocusable(win, false);
    opts.updateTrayMenu();
  });

  await win.loadFile(getIndexHtmlPath());
  return win;
}
