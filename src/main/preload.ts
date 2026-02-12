import { contextBridge, ipcRenderer } from 'electron';
import type {
  MemoPadButtonId,
  OverlayPlacement,
  SilenceProcessingMode,
  StatsEntry,
  TranscriptionLanguage,
  ThemeMode,
  TrayLeftClickAction,
  TranscriptionModel,
  UiLanguage
} from '../shared/types';
import { isTranscriptionLanguage, isUiLanguage } from '../shared/typeGuards';
import type {
  AboutInfo,
  ApiErrorCode,
  AppDataExportOptions,
  AppDataImportOptions,
  AppDataSections,
  ExportAppDataResult,
  ImportAppDataResult,
  SettingsChangedPayload,
  SettingsSnapshot,
  VoiceInputApi
} from '../shared/voiceInputApi';

const voiceInput = {
  getSettings: (): Promise<SettingsSnapshot> => ipcRenderer.invoke('settings:get'),
  getAboutInfo: (): Promise<{ ok: boolean; info?: AboutInfo; error?: string; errorCode?: ApiErrorCode }> =>
    ipcRenderer.invoke('app:getAbout'),
  checkForUpdates: (): ReturnType<VoiceInputApi['checkForUpdates']> => ipcRenderer.invoke('app:checkForUpdates'),
  getPermissions: (): Promise<{ platform: string; accessibilityTrusted: boolean }> =>
    ipcRenderer.invoke('permissions:get'),
  notifyRecordingState: (state: 'idle' | 'recording' | 'transcribing' | 'error', message?: string) => {
    if (typeof message === 'string') {
      ipcRenderer.send('recording:state', state, message);
      return;
    }
    ipcRenderer.send('recording:state', state);
  },
  notifyRecordingLevel: (level: number) => ipcRenderer.send('recording:level', level),
  notifyAudioInputDevices: (devices: { deviceId: string; label: string }[]) =>
    ipcRenderer.send('mic:devices', devices),
  notifySystemDefaultMicrophone: (label: string | null) => ipcRenderer.send('mic:systemDefault', label),
  notifyActiveMicrophone: (microphone: { deviceId: string | null; label: string } | null) =>
    ipcRenderer.send('mic:active', microphone),
  cancelTranscription: () => ipcRenderer.send('transcribe:cancel'),
  openPreferences: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('app:openPreferences'),
  openExternal: (url: string): Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }> =>
    ipcRenderer.invoke('app:openExternal', url),
  openThirdPartyNotices: (): Promise<{ ok: boolean; error?: string; errorCode?: ApiErrorCode }> =>
    ipcRenderer.invoke('app:openThirdPartyNotices'),
  popupTrayMenu: (position?: { x?: number; y?: number }): ReturnType<VoiceInputApi['popupTrayMenu']> =>
    ipcRenderer.invoke('tray:popupMenu', position),
  requestAccessibilityPermission: (): ReturnType<VoiceInputApi['requestAccessibilityPermission']> =>
    ipcRenderer.invoke('permissions:requestAccessibility'),
  openAccessibilitySettings: (): ReturnType<VoiceInputApi['openAccessibilitySettings']> =>
    ipcRenderer.invoke('permissions:openAccessibility'),
  setThemeMode: (mode: ThemeMode): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setThemeMode', mode),
  setAccentColor: (color: string | null): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setAccentColor', color),
  setOverlayPlacement: (placement: OverlayPlacement): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setOverlayPlacement', placement),
  setOverlayOffsetX: (offsetX: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setOverlayOffsetX', offsetX),
  setOverlayOffsetY: (offsetY: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setOverlayOffsetY', offsetY),
  setHotkey: (hotkey: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setHotkey', hotkey),
  setTrayLeftClickAction: (action: TrayLeftClickAction): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setTrayLeftClickAction', action),
  setApiTimeoutSeconds: (seconds: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setApiTimeoutSeconds', seconds),
  setRecordingMaxSeconds: (maxSeconds: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setRecordingMaxSeconds', maxSeconds),
  setKeyboardCharsPerMinute: (charsPerMinute: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setKeyboardCharsPerMinute', charsPerMinute),
  setSilenceProcessingMode: (mode: SilenceProcessingMode): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setSilenceProcessingMode', mode),
  setSilenceAutoStopSeconds: (seconds: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setSilenceAutoStopSeconds', seconds),
  setMicDeviceId: (deviceId: string | null): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setMicDeviceId', deviceId),
  setMicWarmGraceSeconds: (seconds: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setMicWarmGraceSeconds', seconds),
  setUpdateCheckEnabled: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setUpdateCheckEnabled', enabled),
  setHistoryMaxItems: (maxItems: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setHistoryMaxItems', maxItems),
  setDictionaryEnabled: (enabled: boolean): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setDictionaryEnabled', enabled),
  setDictionaryRulesText: (
    rulesText: string
  ): Promise<{ ok: boolean; ruleCount?: number; error?: string; errors?: string[] }> =>
    ipcRenderer.invoke('settings:setDictionaryRulesText', rulesText),
  setApiKey: (apiKey: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setApiKey', apiKey),
  setUiLanguage: (language: UiLanguage): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setUiLanguage', language),
  setLanguage: (language: TranscriptionLanguage): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setLanguage', language),
  setModel: (model: TranscriptionModel): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setModel', model),
  setSoftStartOpenMemoPad: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setSoftStartOpenMemoPad', enabled),
  setSoftStartOpenHistory: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setSoftStartOpenHistory', enabled),
  setAutoPaste: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setAutoPaste', enabled),
  setMemoPadAutoMemo: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setMemoPadAutoMemo', enabled),
  setMemoPadPersistText: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setMemoPadPersistText', enabled),
  setMemoPadInsertAtCursor: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setMemoPadInsertAtCursor', enabled),
  setMemoPadAlwaysOnTop: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setMemoPadAlwaysOnTop', enabled),
  setMemoPadEditorFontSizePx: (fontSizePx: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setMemoPadEditorFontSizePx', fontSizePx),
  setMemoPadUndoMaxSteps: (maxSteps: number): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setMemoPadUndoMaxSteps', maxSteps),
  setHistoryAlwaysOnTop: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setHistoryAlwaysOnTop', enabled),
  setMemoPadVisibleButtons: (buttons: MemoPadButtonId[]): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('settings:setMemoPadVisibleButtons', buttons),
  setMemoPadText: (text: string): Promise<{ ok: boolean }> => ipcRenderer.invoke('memo:setText', text),
  memoReplaceSelection: (payload: { replacementText: string }): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('memo:replaceSelection', payload),
  setTranslationEnabled: (enabled: boolean): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setTranslationEnabled', enabled),
  setTranslationTarget: (language: TranscriptionLanguage): Promise<{ ok: boolean }> =>
    ipcRenderer.invoke('settings:setTranslationTarget', language),
  listHistory: (): Promise<{ ok: boolean; entries?: unknown[]; error?: string }> =>
    ipcRenderer.invoke('history:list'),
  clearHistory: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('history:clear'),
  deleteHistoryEntry: (id: string): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('history:delete', id),
  openHistoryWindow: (): Promise<{ ok: boolean; error?: string }> =>
    ipcRenderer.invoke('history:openWindow'),
  getUsage: (): Promise<{
    ok: boolean;
    audioSecondsByModel?: Record<string, number>;
    sinceAt?: number | null;
    error?: string;
  }> =>
    ipcRenderer.invoke('usage:get'),
  clearUsage: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('usage:clear'),
  getStats: (): Promise<{ ok: boolean; entries?: StatsEntry[]; sinceAt?: number | null; error?: string }> =>
    ipcRenderer.invoke('stats:get'),
  clearStats: (): Promise<{ ok: boolean; error?: string }> => ipcRenderer.invoke('stats:clear'),
  exportAppData: (sections: AppDataSections, options?: AppDataExportOptions): Promise<ExportAppDataResult> =>
    ipcRenderer.invoke('appData:export', sections, options),
  importAppData: (sections: AppDataSections, options?: AppDataImportOptions): Promise<ImportAppDataResult> =>
    ipcRenderer.invoke('appData:import', sections, options),
  toggleRecording: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('recording:toggle'),
  startRecording: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('recording:start'),
  stopRecording: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('recording:stop'),
  cancelRecording: (): Promise<{ ok: boolean }> => ipcRenderer.invoke('recording:cancel'),
  manualTranslate: (inputText: string): Promise<{ ok: boolean; text?: string; error?: string }> =>
    ipcRenderer.invoke('translation:manual', inputText),
  transcribe: (
    audioData: ArrayBuffer,
    mimeType: string,
    durationSeconds: number,
    silenceProcessingMode?: SilenceProcessingMode,
    endedAt?: number
  ): Promise<{
    ok: boolean;
    text?: string;
    transcript?: string;
    didCopy?: boolean;
    didPaste?: boolean;
    pasteError?: string;
    error?: string;
  }> =>
    ipcRenderer.invoke('transcribe', { audioData, mimeType, durationSeconds, silenceProcessingMode, endedAt }),
  onToggleRecording: (callback: () => void) => {
    ipcRenderer.on('recording:toggle', callback);
    return () => ipcRenderer.off('recording:toggle', callback);
  },
  onStartRecording: (callback: () => void) => {
    ipcRenderer.on('recording:start', callback);
    return () => ipcRenderer.off('recording:start', callback);
  },
  onStopRecording: (callback: () => void) => {
    ipcRenderer.on('recording:stop', callback);
    return () => ipcRenderer.off('recording:stop', callback);
  },
  onCancelRecording: (callback: () => void) => {
    ipcRenderer.on('recording:cancel', callback);
    return () => ipcRenderer.off('recording:cancel', callback);
  },
  onRecordingStateChanged: (callback: (state: 'idle' | 'recording' | 'transcribing' | 'error', message?: string) => void) => {
    const listener = (_event: unknown, state: unknown, message: unknown) => {
      if (state !== 'idle' && state !== 'recording' && state !== 'transcribing' && state !== 'error') return;
      const nextMessage = typeof message === 'string' ? message : undefined;
      callback(state, nextMessage);
    };
    ipcRenderer.on('recording:stateChanged', listener);
    return () => ipcRenderer.off('recording:stateChanged', listener);
  },
  onRecordingLevel: (callback: (level: number) => void) => {
    const listener = (_event: unknown, level: unknown) => {
      if (typeof level !== 'number' || !Number.isFinite(level)) return;
      callback(level);
    };
    ipcRenderer.on('recording:level', listener);
    return () => ipcRenderer.off('recording:level', listener);
  },
  onMemoAppendText: (callback: (text: string) => void) => {
    const listener = (_event: unknown, text: unknown) => {
      if (typeof text !== 'string') return;
      callback(text);
    };
    ipcRenderer.on('memo:appendText', listener);
    return () => ipcRenderer.off('memo:appendText', listener);
  },
  onMemoRestoreText: (callback: (text: string) => void) => {
    const listener = (_event: unknown, text: unknown) => {
      if (typeof text !== 'string') return;
      callback(text);
    };
    ipcRenderer.on('memo:restoreText', listener);
    return () => ipcRenderer.off('memo:restoreText', listener);
  },
  onMemoRequestText: (callback: () => void) => {
    ipcRenderer.on('memo:requestText', callback);
    return () => ipcRenderer.off('memo:requestText', callback);
  },
  onMemoUndo: (callback: () => void) => {
    ipcRenderer.on('memo:undo', callback);
    return () => ipcRenderer.off('memo:undo', callback);
  },
  onMemoRedo: (callback: () => void) => {
    ipcRenderer.on('memo:redo', callback);
    return () => ipcRenderer.off('memo:redo', callback);
  },
  onMemoButtonLayout: (callback: (buttons: MemoPadButtonId[]) => void) => {
    const listener = (_event: unknown, buttons: unknown) => {
      if (!Array.isArray(buttons)) return;
      const next: MemoPadButtonId[] = [];
      for (const item of buttons) {
        if (typeof item !== 'string') continue;
        next.push(item as MemoPadButtonId);
      }
      callback(next);
    };
    ipcRenderer.on('memo:buttonLayout', listener);
    return () => ipcRenderer.off('memo:buttonLayout', listener);
  },
  onMemoReplaceSelection: (callback: (payload: { replacementText: string }) => void) => {
    const listener = (_event: unknown, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const obj = payload as Record<string, unknown>;
      if (typeof obj.replacementText !== 'string') return;
      callback({ replacementText: obj.replacementText });
    };
    ipcRenderer.on('memo:replaceSelection', listener);
    return () => ipcRenderer.off('memo:replaceSelection', listener);
  },
  onMemoOpenFindBar: (callback: (payload: { mode: 'find' | 'replace'; seed?: string }) => void) => {
    const listener = (_event: unknown, payload: unknown) => {
      if (!payload || typeof payload !== 'object') return;
      const obj = payload as Record<string, unknown>;
      const mode = obj.mode;
      if (mode !== 'find' && mode !== 'replace') return;
      const seed = typeof obj.seed === 'string' ? obj.seed : undefined;
      callback({ mode, seed });
    };
    ipcRenderer.on('memo:openFindBar', listener);
    return () => ipcRenderer.off('memo:openFindBar', listener);
  },
  onSettingsChanged: (callback: (settings: SettingsChangedPayload) => void) => {
    const listener = (_event: unknown, settings: unknown) => {
      if (!settings || typeof settings !== 'object') return;
      const obj = settings as Record<string, unknown>;
      if (typeof obj.autoPaste !== 'boolean') return;
      if (typeof obj.memoPadAutoMemo !== 'boolean') return;
      if (typeof obj.memoPadInsertAtCursor !== 'boolean') return;
      if (typeof obj.memoPadEditorFontSizePx !== 'number' || !Number.isFinite(obj.memoPadEditorFontSizePx)) return;
      if (typeof obj.memoPadUndoMaxSteps !== 'number' || !Number.isFinite(obj.memoPadUndoMaxSteps)) return;
      if (typeof obj.translationEnabled !== 'boolean') return;
      if (!isTranscriptionLanguage(obj.translationTarget)) return;
      callback({
        autoPaste: obj.autoPaste,
        memoPadAutoMemo: obj.memoPadAutoMemo,
        memoPadInsertAtCursor: obj.memoPadInsertAtCursor,
        memoPadEditorFontSizePx: obj.memoPadEditorFontSizePx,
        memoPadUndoMaxSteps: obj.memoPadUndoMaxSteps,
        translationEnabled: obj.translationEnabled,
        translationTarget: obj.translationTarget
      });
    };
    ipcRenderer.on('settings:changed', listener);
    return () => ipcRenderer.off('settings:changed', listener);
  },
  onAccentColorChanged: (callback: (accentColor: string | null) => void) => {
    const listener = (_event: unknown, accentColor: unknown) => {
      if (accentColor === null) {
        callback(null);
        return;
      }
      if (typeof accentColor !== 'string') return;
      const normalized = accentColor.trim().toLowerCase();
      if (!normalized) {
        callback(null);
        return;
      }
      if (!/^#[0-9a-f]{6}$/.test(normalized)) return;
      callback(normalized);
    };
    ipcRenderer.on('accentColor:changed', listener);
    return () => ipcRenderer.off('accentColor:changed', listener);
  },
  onUiLanguageChanged: (callback: (language: UiLanguage) => void) => {
    const listener = (_event: unknown, language: unknown) => {
      if (!isUiLanguage(language)) return;
      callback(language);
    };
    ipcRenderer.on('uiLanguage:changed', listener);
    return () => ipcRenderer.off('uiLanguage:changed', listener);
  },
  onHistoryUpdated: (callback: () => void) => {
    ipcRenderer.on('history:updated', callback);
    return () => ipcRenderer.off('history:updated', callback);
  }
} satisfies VoiceInputApi;

contextBridge.exposeInMainWorld('voiceInput', voiceInput);
