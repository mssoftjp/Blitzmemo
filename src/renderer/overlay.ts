import type { UiLanguage } from '../shared/types';
import { t } from '../shared/i18n';
import { applyMicLevelToDot, clamp01 } from './micLevel';
import { applyAccentColor } from './accentColor';
import { setUiLanguage } from './i18n';

declare global {
  interface Window {
    aviOverlay: {
      onState: (callback: (state: string) => void) => () => void;
      onLevel: (callback: (level: number) => void) => () => void;
      onUiLanguageChanged: (callback: (language: UiLanguage) => void) => () => void;
      onAccentColorChanged: (callback: (accentColor: string | null) => void) => () => void;
    };
  }
}

const root = document.getElementById('root');
const label = document.getElementById('label');
const dot = document.querySelector<HTMLElement>('.avi-dot');
let uiLanguage: UiLanguage = 'en';
let didApplyUiLanguage = false;
let currentState = 'recording';
let currentLevel = 0;

function tr(key: 'overlay.label.recording' | 'overlay.label.transcribing' | 'app.name'): string {
  return t(uiLanguage, key);
}

function applyUiLanguage(language: UiLanguage): void {
  if (uiLanguage === language && didApplyUiLanguage) return;
  uiLanguage = language;
  didApplyUiLanguage = true;
  setUiLanguage(uiLanguage);
  document.title = tr('app.name');
  setState(currentState);
}

function setState(state: string): void {
  if (!root || !label) return;

  currentState = state;
  root.classList.toggle('avi-state-transcribing', state === 'transcribing');
  label.textContent = state === 'transcribing' ? tr('overlay.label.transcribing') : tr('overlay.label.recording');
  applyMicLevelToDot(dot, currentLevel, { active: currentState === 'recording' });
}

export function initOverlay(): void {
  setUiLanguage(uiLanguage);
  document.title = tr('app.name');
  setState(currentState);

  window.aviOverlay.onUiLanguageChanged((language: UiLanguage) => applyUiLanguage(language));
  window.aviOverlay.onAccentColorChanged((accentColor: string | null) => applyAccentColor(accentColor));
  window.aviOverlay.onState((state: string) => setState(state));
  window.aviOverlay.onLevel((level: number) => {
    currentLevel = clamp01(level);
    applyMicLevelToDot(dot, currentLevel, { active: currentState === 'recording' });
  });
}
