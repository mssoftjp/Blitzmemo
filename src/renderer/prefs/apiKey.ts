import { formatApiError } from '../../shared/apiError';
import type { UiLanguage } from '../../shared/types';
import type { SettingsSnapshot } from '../voiceInputApi';

type ApiKeyPreferencesElements = {
  apiKey: HTMLInputElement;
  saveKey: HTMLButtonElement;
  keyStatus: HTMLDivElement;
};

export type SetupApiKeyPreferencesOptions = {
  els: ApiKeyPreferencesElements;
  getUiLanguage: () => UiLanguage;
  renderApiKeyStatus: (settings: SettingsSnapshot) => void;
};

function voidAsync<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    fn(...args).catch((error) => {
      console.error(error);
    });
  };
}

export function setupApiKeyPreferences(opts: SetupApiKeyPreferencesOptions): void {
  const { els, getUiLanguage, renderApiKeyStatus } = opts;

  els.saveKey.addEventListener(
    'click',
    voidAsync(async () => {
      const apiKey = els.apiKey.value;
      const res = await window.voiceInput.setApiKey(apiKey);
      if (!res.ok) {
        els.keyStatus.textContent = formatApiError(getUiLanguage(), res, 'prefs.ai.apiKey.error.failedToSave');
        return;
      }
      els.apiKey.value = '';
      const next = await window.voiceInput.getSettings();
      renderApiKeyStatus(next);
    })
  );
}

