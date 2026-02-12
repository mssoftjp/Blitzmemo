import { BrowserWindow, globalShortcut } from 'electron';
import type { SettingsStore } from '../settings';
import type { ApiErrorCode } from '../../shared/voiceInputApi';
import { FIXED_CANCEL_HOTKEY, normalizeAccelerator } from '../../shared/hotkey';

type RecordingState = 'idle' | 'recording' | 'transcribing' | 'error';

export type SetupHotkeysOptions = {
  settingsStore: SettingsStore;
  isQuitting: () => boolean;
  getRecordingState: () => RecordingState;
  getHotkeySuspensionWindows: () => Array<BrowserWindow | null>;
  setLastGlobalHotkeyAt: (timestamp: number) => void;
  sendRecordingStart: () => void;
  sendRecordingStop: () => void;
  sendRecordingCancel: () => void;
};

type TryRegisterHotkeyResult = { ok: boolean; errorCode?: ApiErrorCode; error?: string };

export type HotkeysApi = {
  registerGlobalHotkey: (hotkey: string) => void;
  tryRegisterHotkey: (hotkey: string) => TryRegisterHotkeyResult;
  setCancelHotkeyEnabled: (enabled: boolean) => void;
  updateHotkeySuspension: () => void;
  clearGlobalHotkeyPttSession: () => void;
};

const GLOBAL_HOTKEY_REPEAT_SUPPRESS_MS = 240;

const DEBUG_HOTKEY = process.env.BLITZMEMO_DEBUG_HOTKEY === '1';

export function setupHotkeys(options: SetupHotkeysOptions): HotkeysApi {
  let registeredHotkey: string | null = null;
  let registeredCancelHotkey: string | null = null;
  let isHotkeySuspended = false;
  let globalHotkeyIgnoreUntil = 0;

  function clearGlobalHotkeyPttSession(): void {
    // user-note: Hotkey is toggle-only (no push-to-talk), but we still keep this hook for main IPC.
    // Do not clear repeat suppression while it's active, otherwise key-repeat/burst callbacks can re-trigger
    // Start/Stop during the stop->transcribe transition.
    const now = Date.now();
    if (globalHotkeyIgnoreUntil > now) return;
    globalHotkeyIgnoreUntil = 0;
  }

  function handleGlobalHotkey(): void {
    if (isHotkeySuspended) return;
    const now = Date.now();
    options.setLastGlobalHotkeyAt(now);

    // user-note: globalShortcut can fire multiple times for a single physical press (platform- and key-dependent).
    // For the Start/Stop hotkey we want stable toggle behavior (no push-to-talk), so suppress burst callbacks.
    if (now < globalHotkeyIgnoreUntil) {
      globalHotkeyIgnoreUntil = now + GLOBAL_HOTKEY_REPEAT_SUPPRESS_MS;
      if (DEBUG_HOTKEY) console.debug('[hotkey] global ignore repeat');
      return;
    }
    globalHotkeyIgnoreUntil = now + GLOBAL_HOTKEY_REPEAT_SUPPRESS_MS;

    const recordingState = options.getRecordingState();
    if (recordingState === 'recording') {
      if (DEBUG_HOTKEY) console.debug('[hotkey] global toggle -> stop');
      options.sendRecordingStop();
      return;
    }

    if (DEBUG_HOTKEY) console.debug('[hotkey] global start');
    options.sendRecordingStart();
  }

  function getCancelHotkeyCandidates(hotkey: string): string[] {
    const normalized = normalizeAccelerator(hotkey);
    if (!normalized) return [];
    const lower = normalized.toLowerCase();
    if (lower === 'escape' || lower === 'esc') return ['Escape', 'Esc'];
    return [normalized];
  }

  function registerGlobalHotkey(hotkey: string): void {
    try {
      const normalized = normalizeAccelerator(hotkey);
      if (!normalized) return;
      if (isHotkeySuspended) return;
      if (registeredHotkey === normalized) return;

      const ok = globalShortcut.register(normalized, () => {
        handleGlobalHotkey();
      });
      if (!ok) {
        registeredHotkey = null;
        console.warn(`[hotkey] failed to register: ${normalized}`);
        return;
      }

      if (registeredHotkey) {
        globalShortcut.unregister(registeredHotkey);
      }
      registeredHotkey = normalized;
    } catch (error) {
      registeredHotkey = null;
      console.warn('[hotkey] failed to register:', error);
    }
  }

  function tryRegisterHotkey(hotkey: string): TryRegisterHotkeyResult {
    const normalized = normalizeAccelerator(hotkey);
    if (!normalized) return { ok: false, errorCode: 'hotkey.empty' };

    // If it's already our active hotkey, treat as ok.
    if (registeredHotkey === normalized) return { ok: true };

    try {
      const ok = globalShortcut.register(normalized, () => {
        handleGlobalHotkey();
      });
      if (!ok) {
        return { ok: false, errorCode: 'hotkey.inUse' };
      }

      if (registeredHotkey) {
        globalShortcut.unregister(registeredHotkey);
      }
      if (isHotkeySuspended) {
        globalShortcut.unregister(normalized);
        registeredHotkey = null;
      } else {
        registeredHotkey = normalized;
      }
      return { ok: true };
    } catch (error) {
      return {
        ok: false,
        error: error instanceof Error ? error.message : 'Failed to register hotkey',
        errorCode: 'hotkey.invalid'
      };
    }
  }

  function setCancelHotkeyEnabled(enabled: boolean): void {
    if (enabled) {
      const candidates = getCancelHotkeyCandidates(FIXED_CANCEL_HOTKEY);
      if (candidates.length === 0) return;
      if (registeredCancelHotkey && candidates.includes(registeredCancelHotkey)) return;

      try {
        for (const accelerator of candidates) {
          const ok = globalShortcut.register(accelerator, () => options.sendRecordingCancel());
          if (!ok) continue;

          if (registeredCancelHotkey) {
            try {
              globalShortcut.unregister(registeredCancelHotkey);
            } catch {
              // ignore
            }
          }
          registeredCancelHotkey = accelerator;
          return;
        }
        console.warn(`[hotkey] failed to register cancel: ${candidates[0]}`);
      } catch (error) {
        console.warn('[hotkey] failed to register cancel:', error);
      }
      return;
    }

    if (!registeredCancelHotkey) return;
    try {
      globalShortcut.unregister(registeredCancelHotkey);
    } catch {
      // ignore
    }
    registeredCancelHotkey = null;
  }

  function setHotkeySuspended(suspended: boolean): void {
    if (isHotkeySuspended === suspended) return;
    isHotkeySuspended = suspended;
    if (suspended) {
      clearGlobalHotkeyPttSession();
      if (!registeredHotkey) return;
      try {
        globalShortcut.unregister(registeredHotkey);
      } catch {
        // ignore
      }
      registeredHotkey = null;
      return;
    }

    registerGlobalHotkey(options.settingsStore.get().hotkey);
  }

  function isExistingWindowFocused(win: BrowserWindow | null): boolean {
    if (!win) return false;
    try {
      return !win.isDestroyed() && win.isFocused();
    } catch {
      return false;
    }
  }

  function updateHotkeySuspension(): void {
    if (options.isQuitting()) return;
    const shouldSuspend = options.getHotkeySuspensionWindows().some((win) => isExistingWindowFocused(win));
    setHotkeySuspended(shouldSuspend);
  }

  return {
    registerGlobalHotkey,
    tryRegisterHotkey,
    setCancelHotkeyEnabled,
    updateHotkeySuspension,
    clearGlobalHotkeyPttSession
  };
}
