import { BrowserWindow, clipboard, nativeImage, systemPreferences } from 'electron';
import type { SettingsStore } from '../settings';
import { t } from '../../shared/i18n';

type ExecFileAsync = (
  file: string,
  args: readonly string[],
  options: { timeout?: number }
) => Promise<{ stdout: string; stderr: string }>;

export type SetupAutoPasteOptions = {
  settingsStore: SettingsStore;
  execFileAsync: ExecFileAsync;
  getLastGlobalHotkeyAt: () => number;
  getLastRecordingStartAt: () => number;
  debug: boolean;
};

export type AutoPasteApi = {
  isAccessibilityTrusted: () => boolean;
  requestAutoPaste: (text: string) => Promise<{ didPaste: boolean; error?: string }>;
  scheduleAutoPasteFlush: (delayMs: number) => void;
};

const AUTO_PASTE_GLOBAL_HOTKEY_GUARD_MS = 350;
const AUTO_PASTE_QUEUE_TTL_MS = 20_000;
const AUTO_PASTE_QUEUE_MAX_ITEMS = 20;
const AUTO_PASTE_CLIPBOARD_SETTLE_MS = 60;
const AUTO_PASTE_CLIPBOARD_RESTORE_BASE_DELAY_MS = 900;
const AUTO_PASTE_CLIPBOARD_RESTORE_PER_CHAR_MS = 0.5;
const AUTO_PASTE_CLIPBOARD_RESTORE_MAX_DELAY_MS = 1500;

const CORE_CLIPBOARD_FORMATS = new Set([
  'text/plain',
  'text/html',
  'text/rtf',
  // macOS common UTIs (Electron may expose these depending on source app)
  'public.utf8-plain-text',
  'public.html',
  'public.rtf'
]);

type ClipboardSnapshot = {
  formats: string[];
  buffersByFormat: Map<string, Buffer>;
  text: string;
  html: string;
  rtf: string;
  imagePng: Buffer | null;
};

type AutoPasteQueueItem = {
  text: string;
  enqueuedAt: number;
};

function normalizeClipboardTextForCompare(text: string): string {
  // user-note: Some platforms normalize line endings when writing/reading clipboard text.
  return text.replaceAll('\r\n', '\n').replaceAll('\r', '\n');
}

function isSameClipboardText(actual: string, expected: string): boolean {
  if (actual === expected) return true;
  return normalizeClipboardTextForCompare(actual) === normalizeClipboardTextForCompare(expected);
}

function getClipboardRestoreDelayMs(text: string): number {
  const length = typeof text === 'string' ? text.length : 0;
  const extra = Math.floor(Math.max(0, length) * AUTO_PASTE_CLIPBOARD_RESTORE_PER_CHAR_MS);
  const next = AUTO_PASTE_CLIPBOARD_RESTORE_BASE_DELAY_MS + extra;
  return Math.min(AUTO_PASTE_CLIPBOARD_RESTORE_MAX_DELAY_MS, Math.max(0, Math.floor(next)));
}

export function setupAutoPaste(options: SetupAutoPasteOptions): AutoPasteApi {
  // user-note: Auto-paste queue is intentionally small and time-bounded to prevent accidental pastes long after the recording ends.
  const autoPasteQueue: AutoPasteQueueItem[] = [];
  let autoPasteFlushRunning = false;
  let autoPasteFlushTimer: NodeJS.Timeout | null = null;
  let autoPasteFlushScheduledAt: number | null = null;

  function isAccessibilityTrusted(): boolean {
    if (process.platform !== 'darwin') return true;
    try {
      return systemPreferences.isTrustedAccessibilityClient(false);
    } catch {
      return false;
    }
  }

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  function takeClipboardSnapshot(): ClipboardSnapshot {
    const formats = clipboard.availableFormats();
    const buffersByFormat = new Map<string, Buffer>();
    for (const format of formats) {
      try {
        const buf = clipboard.readBuffer(format);
        buffersByFormat.set(format, Buffer.from(buf));
      } catch {
        if (options.debug) console.debug(`[transcribe] failed to snapshot clipboard format: ${format}`);
        continue;
      }
    }

    let text = '';
    let html = '';
    let rtf = '';
    let imagePng: Buffer | null = null;
    try {
      text = clipboard.readText();
      html = clipboard.readHTML();
      rtf = clipboard.readRTF();
      const image = clipboard.readImage();
      if (!image.isEmpty()) {
        imagePng = image.toPNG();
      }
    } catch (error) {
      if (options.debug) {
        console.debug(
          `[transcribe] failed to snapshot clipboard: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
    }

    if (options.debug) {
      console.debug(
        `[transcribe] snapshot clipboard formats=${formats.length} textLen=${text.length} htmlLen=${html.length} rtfLen=${rtf.length} hasImage=${imagePng ? 'yes' : 'no'}`
      );
    }

    return { formats, buffersByFormat, text, html, rtf, imagePng };
  }

  function tryRestoreClipboard(snapshot: ClipboardSnapshot): boolean {
    try {
      const data: Electron.Data = {};
      if (snapshot.text) data.text = snapshot.text;
      if (snapshot.html) data.html = snapshot.html;
      if (snapshot.rtf) data.rtf = snapshot.rtf;
      if (snapshot.imagePng) {
        data.image = nativeImage.createFromBuffer(snapshot.imagePng);
      }

      const writeCoreData = () => {
        clipboard.clear();
        if (Object.keys(data).length > 0) {
          clipboard.write(data);
        }
      };

      writeCoreData();

      const expectedText = snapshot.text;
      const expectedHtml = snapshot.html;
      const expectedRtf = snapshot.rtf;
      const expectedHasImage = Boolean(snapshot.imagePng);
      for (const [format, buf] of snapshot.buffersByFormat.entries()) {
        const normalizedFormat = format.toLowerCase();
        if (CORE_CLIPBOARD_FORMATS.has(normalizedFormat)) continue;

        try {
          clipboard.writeBuffer(format, buf);
          if (expectedText && clipboard.readText() !== expectedText) {
            if (options.debug) console.debug(`[transcribe] clipboard restore lost text after writeBuffer: ${format}`);
            writeCoreData();
            break;
          }
          if (expectedHtml && clipboard.readHTML().trim().length === 0) {
            if (options.debug) console.debug(`[transcribe] clipboard restore lost html after writeBuffer: ${format}`);
            writeCoreData();
            break;
          }
          if (expectedRtf && clipboard.readRTF().trim().length === 0) {
            if (options.debug) console.debug(`[transcribe] clipboard restore lost rtf after writeBuffer: ${format}`);
            writeCoreData();
            break;
          }
          if (expectedHasImage && clipboard.readImage().isEmpty()) {
            if (options.debug) console.debug(`[transcribe] clipboard restore lost image after writeBuffer: ${format}`);
            writeCoreData();
            break;
          }
        } catch (error) {
          if (options.debug) {
            console.debug(
              `[transcribe] failed to restore clipboard format: ${format} ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }
      }
      return true;
    } catch (error) {
      if (options.debug) {
        console.debug(
          `[transcribe] failed to restore clipboard: ${error instanceof Error ? error.message : 'Unknown error'}`
        );
      }
      return false;
    }
  }

  function getAutoPastePreconditionError(): string | undefined {
    if (process.platform === 'darwin') {
      if (!isAccessibilityTrusted()) return t('en', 'detail.permissions.accessibilityNotGranted');
      return;
    }
    if (process.platform === 'win32') return;
    return t('en', 'detail.autoPaste.notSupported');
  }

  async function tryAutoPaste(): Promise<{ didPaste: boolean; error?: string }> {
    try {
      if (process.platform === 'darwin') {
        if (!isAccessibilityTrusted()) {
          return {
            didPaste: false,
            error: t('en', 'detail.permissions.accessibilityNotGranted')
          };
        }
        await options.execFileAsync(
          'osascript',
          ['-e', 'tell application "System Events" to keystroke "v" using {command down}'],
          { timeout: 5_000 }
        );
        return { didPaste: true };
      }
      if (process.platform === 'win32') {
        await options.execFileAsync(
          'powershell',
          [
            '-NoProfile',
            '-NonInteractive',
            '-Command',
            'Add-Type -AssemblyName System.Windows.Forms; [System.Windows.Forms.SendKeys]::SendWait("^v")'
          ],
          { timeout: 5_000 }
        );
        return { didPaste: true };
      }
      return { didPaste: false, error: t('en', 'detail.autoPaste.notSupported') };
    } catch (error) {
      if (error && typeof error === 'object') {
        const stderr = (error as { stderr?: unknown }).stderr;
        if (typeof stderr === 'string' && stderr.trim().length > 0) {
          return { didPaste: false, error: stderr.trim() };
        }
      }
      return { didPaste: false, error: error instanceof Error ? error.message : t('en', 'detail.autoPaste.failed') };
    }
  }

  async function tryAutoPasteWithClipboard(text: string): Promise<{ didPaste: boolean; error?: string }> {
    const preconditionError = getAutoPastePreconditionError();
    if (preconditionError) return { didPaste: false, error: preconditionError };

    const snapshot = takeClipboardSnapshot();

    let pasteResult: { didPaste: boolean; error?: string } = { didPaste: false };
    let didPrepareClipboard = false;
    try {
      // user-note: Some apps prefer rich clipboard formats (HTML/RTF). If we only overwrite plain text without
      // clearing, they can paste stale rich content from the previous clipboard item.
      clipboard.clear();
      clipboard.write({ text });
      const preparedText = clipboard.readText();
      didPrepareClipboard = isSameClipboardText(preparedText, text);
      if (!didPrepareClipboard) {
        throw new Error(t('en', 'detail.autoPaste.failed'));
      }

      if (options.debug) {
        const formats = clipboard.availableFormats();
        console.debug(`[transcribe] prepared clipboard formats=${formats.length} textLen=${preparedText.length}`);
      }

      // user-note: Clipboard updates can take a moment to become visible to the frontmost app.
      // Without a short settle delay, the target app may paste the previous clipboard contents intermittently.
      await sleep(AUTO_PASTE_CLIPBOARD_SETTLE_MS);

      pasteResult = await tryAutoPaste();
    } catch (error) {
      pasteResult = {
        didPaste: false,
        error: error instanceof Error ? error.message : t('en', 'detail.autoPaste.failed')
      };
    } finally {
      if (!pasteResult.didPaste) {
        if (!didPrepareClipboard) {
          // Best-effort rollback: avoid accidentally clearing the user's clipboard on internal failures.
          tryRestoreClipboard(snapshot);
        } else if (options.debug) {
          console.debug('[transcribe] keep clipboard because auto paste failed');
        }
      } else {
        const restoreDelayMs = getClipboardRestoreDelayMs(text);
        if (options.debug) console.debug(`[transcribe] clipboard restore delay=${restoreDelayMs}ms`);
        await sleep(restoreDelayMs);
        try {
          const shouldRestore = isSameClipboardText(clipboard.readText(), text);
          if (shouldRestore) {
            if (options.debug) {
              console.debug(
                `[transcribe] restoring clipboard formats=${snapshot.formats.length} textLen=${snapshot.text.length}`
              );
            }
            tryRestoreClipboard(snapshot);
          } else if (options.debug) {
            console.debug('[transcribe] skip clipboard restore because clipboard changed');
          }
        } catch (error) {
          if (options.debug) {
            console.debug(
              `[transcribe] failed to restore clipboard: ${error instanceof Error ? error.message : 'Unknown error'}`
            );
          }
        }
      }
    }

    return pasteResult;
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

  function getAutoPasteGuardRemainingMs(): number {
    const lastGuardedAt = Math.max(options.getLastGlobalHotkeyAt(), options.getLastRecordingStartAt());
    if (lastGuardedAt <= 0) return 0;
    const elapsedMs = Date.now() - lastGuardedAt;
    if (elapsedMs >= AUTO_PASTE_GLOBAL_HOTKEY_GUARD_MS) return 0;
    return AUTO_PASTE_GLOBAL_HOTKEY_GUARD_MS - elapsedMs;
  }

  function enqueueAutoPaste(text: string): void {
    if (!text.trim()) return;
    autoPasteQueue.push({ text, enqueuedAt: Date.now() });
    while (autoPasteQueue.length > AUTO_PASTE_QUEUE_MAX_ITEMS) {
      autoPasteQueue.shift();
    }
  }

  function scheduleAutoPasteFlush(delayMs: number): void {
    if (autoPasteQueue.length === 0) return;
    const nextDelay = Math.max(0, Math.floor(delayMs));
    const nextAt = Date.now() + nextDelay;
    if (autoPasteFlushTimer && autoPasteFlushScheduledAt !== null) {
      if (autoPasteFlushScheduledAt <= nextAt) return;
      clearTimeout(autoPasteFlushTimer);
      autoPasteFlushTimer = null;
      autoPasteFlushScheduledAt = null;
    }

    autoPasteFlushScheduledAt = nextAt;
    autoPasteFlushTimer = setTimeout(() => {
      autoPasteFlushTimer = null;
      autoPasteFlushScheduledAt = null;
      void flushAutoPasteQueue();
    }, nextDelay);
  }

  async function flushAutoPasteQueue(): Promise<void> {
    if (autoPasteFlushRunning) return;
    if (autoPasteQueue.length === 0) return;
    if (!options.settingsStore.get().autoPaste) {
      autoPasteQueue.length = 0;
      return;
    }
    // user-note: When Blitzmemo is frontmost, auto-paste must do nothing (no paste, no queue).
    // Otherwise, Cmd/Ctrl+V can end up pasting into Blitzmemo itself (e.g. Memo Pad) and cause duplicate text.
    if (isBlitzmemoFocused()) {
      if (options.debug) console.debug('[transcribe] drop auto paste queue because app is focused');
      autoPasteQueue.length = 0;
      return;
    }

    const guardRemainingMs = getAutoPasteGuardRemainingMs();
    if (guardRemainingMs > 0) {
      scheduleAutoPasteFlush(guardRemainingMs);
      return;
    }

    autoPasteFlushRunning = true;
    try {
      while (autoPasteQueue.length > 0) {
        if (isBlitzmemoFocused()) {
          if (options.debug) console.debug('[transcribe] drop auto paste queue because app is focused');
          autoPasteQueue.length = 0;
          return;
        }

        const nextGuardRemainingMs = getAutoPasteGuardRemainingMs();
        if (nextGuardRemainingMs > 0) {
          scheduleAutoPasteFlush(nextGuardRemainingMs);
          return;
        }

        const item = autoPasteQueue[0];
        if (!item) return;

        if (Date.now() - item.enqueuedAt > AUTO_PASTE_QUEUE_TTL_MS) {
          autoPasteQueue.shift();
          continue;
        }

        const pasteResult = await tryAutoPasteWithClipboard(item.text);
        if (!pasteResult.didPaste) {
          autoPasteQueue.length = 0;
          return;
        }

        autoPasteQueue.shift();
      }
    } finally {
      autoPasteFlushRunning = false;
    }
  }

  // user-note: Returns immediate paste result when safe; otherwise queues and schedules a best-effort flush later.
  async function requestAutoPaste(text: string): Promise<{ didPaste: boolean; error?: string }> {
    // user-note: When Blitzmemo is frontmost, auto-paste must do nothing (no copy, no paste, no queue).
    if (isBlitzmemoFocused()) {
      if (options.debug) console.debug('[transcribe] drop auto paste because app is focused');
      autoPasteQueue.length = 0;
      return { didPaste: false };
    }

    const guardRemainingMs = getAutoPasteGuardRemainingMs();
    if (guardRemainingMs > 0) {
      enqueueAutoPaste(text);
      scheduleAutoPasteFlush(guardRemainingMs);
      return { didPaste: false };
    }

    const pasteResult = await tryAutoPasteWithClipboard(text);
    if (!pasteResult.didPaste && !pasteResult.error) {
      enqueueAutoPaste(text);
      scheduleAutoPasteFlush(AUTO_PASTE_GLOBAL_HOTKEY_GUARD_MS);
      return { didPaste: false };
    }
    return pasteResult;
  }

  return {
    isAccessibilityTrusted,
    requestAutoPaste,
    scheduleAutoPasteFlush
  };
}
