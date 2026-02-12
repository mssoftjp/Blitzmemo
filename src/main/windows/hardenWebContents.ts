import type { Input, WebContents } from 'electron';

export type HardenWebContentsOptions = {
  disableDevToolsShortcuts: boolean;
  disableReloadShortcuts: boolean;
};

function isCmdOrCtrl(input: Input): boolean {
  return Boolean(input.meta || input.control);
}

function normalizeKey(input: Input): string {
  return typeof input.key === 'string' ? input.key.toLowerCase() : '';
}

function isReloadShortcut(input: Input): boolean {
  const key = normalizeKey(input);
  if (key === 'f5') return true;
  if (!isCmdOrCtrl(input)) return false;
  return key === 'r';
}

function isDevToolsShortcut(input: Input): boolean {
  const key = normalizeKey(input);
  if (key === 'f12') return true;

  const cmdOrCtrl = isCmdOrCtrl(input);
  if (!cmdOrCtrl) return false;

  // macOS: Cmd+Option+I/J/C, Windows/Linux: Ctrl+Shift+I/J/C
  if (input.alt && (key === 'i' || key === 'j' || key === 'c')) return true;
  if (input.shift && (key === 'i' || key === 'j' || key === 'c')) return true;
  return false;
}

export function hardenWebContents(webContents: WebContents, opts: HardenWebContentsOptions): void {
  if (!opts.disableDevToolsShortcuts && !opts.disableReloadShortcuts) return;

  if (opts.disableDevToolsShortcuts) {
    webContents.on('devtools-opened', () => {
      try {
        webContents.closeDevTools();
      } catch {
        // ignore
      }
    });
  }

  webContents.on('before-input-event', (event, input) => {
    if (input.type !== 'keyDown') return;
    if (opts.disableReloadShortcuts && isReloadShortcut(input)) {
      event.preventDefault();
      return;
    }
    if (opts.disableDevToolsShortcuts && isDevToolsShortcut(input)) {
      event.preventDefault();
      try {
        webContents.closeDevTools();
      } catch {
        // ignore
      }
    }
  });
}

