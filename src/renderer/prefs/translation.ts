import type { TranscriptionLanguage } from '../../shared/types';

type TranslationPreferencesElements = {
  translateEnabled: HTMLInputElement;
  translateTarget: HTMLSelectElement;
};

export type SetupTranslationPreferencesOptions = {
  els: TranslationPreferencesElements;
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

export function setupTranslationPreferences(opts: SetupTranslationPreferencesOptions): void {
  const { els } = opts;

  els.translateEnabled.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setTranslationEnabled(els.translateEnabled.checked);
    })
  );

  els.translateTarget.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setTranslationTarget(els.translateTarget.value as TranscriptionLanguage);
    })
  );
}

