import type { TranscriptionLanguage, TranscriptionModel, UiLanguage } from '../../shared/types';

type LanguagePreferencesElements = {
  uiLanguage: HTMLSelectElement;
  language: HTMLSelectElement;
  model: HTMLSelectElement;
};

export type SetupLanguagePreferencesOptions = {
  els: LanguagePreferencesElements;
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

export function setupLanguagePreferences(opts: SetupLanguagePreferencesOptions): void {
  const { els } = opts;

  els.uiLanguage.addEventListener(
    'change',
    voidAsync(async () => {
      const res = await window.voiceInput.setUiLanguage(els.uiLanguage.value as UiLanguage);
      if (!res.ok) {
        const settings = await window.voiceInput.getSettings();
        els.uiLanguage.value = settings.uiLanguage;
      }
    })
  );

  els.language.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setLanguage(els.language.value as TranscriptionLanguage);
    })
  );

  els.model.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setModel(els.model.value as TranscriptionModel);
    })
  );
}

