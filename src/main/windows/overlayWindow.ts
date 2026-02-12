import { BrowserWindow, app, screen, type Display } from 'electron';
import { getOverlayHtmlPath, getOverlayPreloadPath } from '../appPaths';
import type { SettingsStore } from '../settings';
import { hardenWebContents } from './hardenWebContents';

type RecordingState = 'idle' | 'recording' | 'transcribing' | 'error';

let overlayFollowTimer: NodeJS.Timeout | null = null;

export function stopOverlayFollow(): void {
  if (!overlayFollowTimer) return;
  clearInterval(overlayFollowTimer);
  overlayFollowTimer = null;
}

function isAnyAppWindowFullScreen(windows: (BrowserWindow | null)[]): boolean {
  for (const win of windows) {
    if (!win) continue;
    try {
      if (win.isDestroyed()) continue;
      if (win.isFullScreen()) return true;
    } catch {
      // ignore
    }
  }
  return false;
}

function getOverlayWorkArea(
  display: Display,
  anyAppWindowFullScreen: boolean
): { x: number; y: number; width: number; height: number } {
  const workArea = display.workArea;
  if (process.platform !== 'darwin') return workArea;
  if (!anyAppWindowFullScreen) return workArea;

  const bounds = display.bounds;
  if (workArea.y !== bounds.y) return workArea;

  const fallbackTopInset = 28;
  const top = bounds.y + fallbackTopInset;
  const bottom = workArea.y + workArea.height;
  if (bottom <= top) return workArea;
  return { x: workArea.x, y: top, width: workArea.width, height: bottom - top };
}

function getOverlayBoundsInDip(
  win: BrowserWindow,
  overlayWindowWidth: number,
  overlayWindowHeight: number
): { x: number; y: number; width: number; height: number } {
  const bounds = win.getBounds();
  if (process.platform !== 'win32') return bounds;

  const distRaw = Math.abs(bounds.width - overlayWindowWidth) + Math.abs(bounds.height - overlayWindowHeight);
  if (distRaw <= 2) return bounds;

  try {
    const dipBounds = screen.screenToDipRect(win, bounds);
    const distDip = Math.abs(dipBounds.width - overlayWindowWidth) + Math.abs(dipBounds.height - overlayWindowHeight);
    if (distDip <= distRaw) return dipBounds;
  } catch {
    // ignore
  }

  const scaleFactor = screen.getPrimaryDisplay()?.scaleFactor ?? 1;
  if (!Number.isFinite(scaleFactor) || scaleFactor <= 0) return bounds;
  return {
    x: Math.round(bounds.x / scaleFactor),
    y: Math.round(bounds.y / scaleFactor),
    width: Math.round(bounds.width / scaleFactor),
    height: Math.round(bounds.height / scaleFactor)
  };
}

export type OverlayWindowOptions = {
  overlayWindowWidth: number;
  overlayWindowHeight: number;
  settingsStore: SettingsStore;
  getRecordingState: () => RecordingState;
  getLastRecordingLevel: () => number;
  getOverlayWindow: () => BrowserWindow | null;
  setOverlayWindow: (window: BrowserWindow | null) => void;
  getAppUiWindows: () => (BrowserWindow | null)[];
};

function startOverlayFollow(opts: OverlayWindowOptions): void {
  if (!opts.getOverlayWindow()) return;
  if (overlayFollowTimer) return;

  let lastX: number | null = null;
  let lastY: number | null = null;

  const tick = () => {
    const overlayWindow = opts.getOverlayWindow();
    if (!overlayWindow) return;
    if (!overlayWindow.isVisible()) return;

    const cursor = screen.getCursorScreenPoint();
    const display = screen.getDisplayNearestPoint(cursor);
    const anyFullScreen = isAnyAppWindowFullScreen(opts.getAppUiWindows());
    const workArea = getOverlayWorkArea(display, anyFullScreen);

    const right = workArea.x + workArea.width;
    const bottom = workArea.y + workArea.height;

    const boundsDip = getOverlayBoundsInDip(overlayWindow, opts.overlayWindowWidth, opts.overlayWindowHeight);
    const width = boundsDip.width;
    const height = boundsDip.height;

    const { overlayPlacement, overlayOffsetX, overlayOffsetY } = opts.settingsStore.get();
    const userOffsetX = Number.isFinite(overlayOffsetX) ? overlayOffsetX : 0;
    const userOffsetY = Number.isFinite(overlayOffsetY) ? overlayOffsetY : 0;

    const cursorOffsetX = 14;
    const cursorOffsetY = 20;
    const fixedMargin = 16;

    let x: number;
    let y: number;

    if (overlayPlacement === 'cursor') {
      x = cursor.x + cursorOffsetX + userOffsetX;
      y = cursor.y + cursorOffsetY + userOffsetY;

      if (x + width > right - 4) {
        x = cursor.x - width - cursorOffsetX + userOffsetX;
      }
      if (y + height > bottom - 4) {
        y = cursor.y - height - cursorOffsetY + userOffsetY;
      }
    } else {
      const fixedXLeft = workArea.x + fixedMargin;
      const fixedXCenter = workArea.x + (workArea.width - width) / 2;
      const fixedXRight = right - width - fixedMargin;
      const fixedYTop = workArea.y + fixedMargin;
      const fixedYBottom = bottom - height - fixedMargin;

      switch (overlayPlacement) {
        case 'bottomRight':
          x = fixedXRight;
          y = fixedYBottom;
          break;
        case 'bottomCenter':
          x = fixedXCenter;
          y = fixedYBottom;
          break;
        case 'bottomLeft':
          x = fixedXLeft;
          y = fixedYBottom;
          break;
        case 'topRight':
          x = fixedXRight;
          y = fixedYTop;
          break;
        case 'topLeft':
          x = fixedXLeft;
          y = fixedYTop;
          break;
        default:
          x = cursor.x + cursorOffsetX;
          y = cursor.y + cursorOffsetY;
          break;
      }

      x += userOffsetX;
      y += userOffsetY;
    }

    const minX = workArea.x + 4;
    const minY = workArea.y + 4;
    const maxX = right - 4 - width;
    const maxY = bottom - 4 - height;

    if (maxX < minX) {
      x = minX;
    } else {
      if (x < minX) x = minX;
      if (x > maxX) x = maxX;
    }
    if (maxY < minY) {
      y = minY;
    } else {
      if (y < minY) y = minY;
      if (y > maxY) y = maxY;
    }

    const nextX = Math.round(x);
    const nextY = Math.round(y);
    if (lastX === nextX && lastY === nextY) return;
    lastX = nextX;
    lastY = nextY;

    // setBounds on Windows can cause subtle drift under DPI scaling; setPosition avoids resizing feedback loops.
    overlayWindow.setPosition(nextX, nextY, false);
  };

  tick();
  overlayFollowTimer = setInterval(tick, 50);
}

function hideOverlay(opts: OverlayWindowOptions): void {
  stopOverlayFollow();
  opts.getOverlayWindow()?.hide();
}

function showOverlay(opts: OverlayWindowOptions): void {
  const overlayWindow = opts.getOverlayWindow();
  if (!overlayWindow) return;
  try {
    overlayWindow.setAlwaysOnTop(true, 'screen-saver');
    overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  } catch {
    // ignore
  }

  try {
    overlayWindow.showInactive();
  } catch {
    overlayWindow.show();
  }
  try {
    overlayWindow.moveTop();
  } catch {
    // ignore
  }
  startOverlayFollow(opts);
}

export function setOverlayState(opts: OverlayWindowOptions, state: RecordingState): void {
  const overlayWindow = opts.getOverlayWindow();
  if (!overlayWindow) return;

  overlayWindow.webContents.send('overlay:setState', state);
  if (opts.settingsStore.get().overlayPlacement === 'none') {
    hideOverlay(opts);
    return;
  }
  if (state === 'recording' || state === 'transcribing') {
    showOverlay(opts);
  } else {
    hideOverlay(opts);
  }
}

export async function ensureOverlayWindow(opts: OverlayWindowOptions): Promise<void> {
  if (opts.getOverlayWindow()) return;

  const isRelease = app.isPackaged;
  const overlayWindow = new BrowserWindow({
    width: opts.overlayWindowWidth,
    height: opts.overlayWindowHeight,
    show: false,
    ...(process.platform === 'darwin' ? { type: 'panel', hiddenInMissionControl: true } : {}),
    frame: false,
    transparent: true,
    resizable: false,
    movable: false,
    minimizable: false,
    maximizable: false,
    fullscreenable: false,
    skipTaskbar: true,
    focusable: false,
    hasShadow: false,
    backgroundColor: '#00000000',
    webPreferences: {
      preload: getOverlayPreloadPath(),
      contextIsolation: true,
      nodeIntegration: false,
      devTools: !isRelease
    }
  });

  hardenWebContents(overlayWindow.webContents, { disableDevToolsShortcuts: isRelease, disableReloadShortcuts: isRelease });

  overlayWindow.setAlwaysOnTop(true, 'screen-saver');
  overlayWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  overlayWindow.setIgnoreMouseEvents(true, { forward: true });

  overlayWindow.on('closed', () => {
    stopOverlayFollow();
    opts.setOverlayWindow(null);
  });

  overlayWindow.webContents.on('did-finish-load', () => {
    overlayWindow.webContents.send('uiLanguage:changed', opts.settingsStore.get().uiLanguage);
    overlayWindow.webContents.send('accentColor:changed', opts.settingsStore.get().accentColor);
    overlayWindow.webContents.send('overlay:setState', opts.getRecordingState());
    overlayWindow.webContents.send('overlay:setLevel', opts.getLastRecordingLevel());
  });

  await overlayWindow.loadFile(getOverlayHtmlPath());
  opts.setOverlayWindow(overlayWindow);
}
