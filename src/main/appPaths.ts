import path from 'node:path';

export function getAssetPath(filename: string): string {
  return path.join(__dirname, 'assets', filename);
}

export function getAppIconPath(): string {
  const filename = process.platform === 'win32' ? 'Blitzmemo_app.ico' : 'Blitzmemo_icon_color.png';
  return getAssetPath(filename);
}

export function getPreloadPath(): string {
  return path.join(__dirname, 'preload.js');
}

export function getOverlayPreloadPath(): string {
  return path.join(__dirname, 'overlay-preload.js');
}

export function getIndexHtmlPath(): string {
  return path.join(__dirname, 'renderer', 'index.html');
}

export function getHistoryHtmlPath(): string {
  return path.join(__dirname, 'renderer', 'history.html');
}

export function getMemoHtmlPath(): string {
  return path.join(__dirname, 'renderer', 'memo.html');
}

export function getDictionaryAddHtmlPath(): string {
  return path.join(__dirname, 'renderer', 'dictionaryAdd.html');
}

export function getOverlayHtmlPath(): string {
  return path.join(__dirname, 'renderer', 'overlay.html');
}
