import { contextBridge, ipcRenderer } from 'electron';
import type { UiLanguage } from '../shared/types';
import { isUiLanguage } from '../shared/typeGuards';

contextBridge.exposeInMainWorld('aviOverlay', {
  onState: (callback: (state: string) => void) => {
    const listener = (_event: unknown, state: string) => callback(state);
    ipcRenderer.on('overlay:setState', listener);
    return () => ipcRenderer.off('overlay:setState', listener);
  },
  onLevel: (callback: (level: number) => void) => {
    const listener = (_event: unknown, level: unknown) => {
      if (typeof level !== 'number' || !Number.isFinite(level)) return;
      callback(level);
    };
    ipcRenderer.on('overlay:setLevel', listener);
    return () => ipcRenderer.off('overlay:setLevel', listener);
  },
  onUiLanguageChanged: (callback: (language: UiLanguage) => void) => {
    const listener = (_event: unknown, language: unknown) => {
      if (!isUiLanguage(language)) return;
      callback(language);
    };
    ipcRenderer.on('uiLanguage:changed', listener);
    return () => ipcRenderer.off('uiLanguage:changed', listener);
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
  }
});
