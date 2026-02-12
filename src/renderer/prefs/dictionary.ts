import { formatApiError } from '../../shared/apiError';
import type { UiStringKey } from '../../shared/i18n';
import type { UiLanguage } from '../../shared/types';

type DictionaryPreferencesElements = {
  dictionaryEnabled: HTMLInputElement;
  addDictionaryReplaceRule: HTMLButtonElement;
  addDictionaryProtectRule: HTMLButtonElement;
  dictionaryStatus: HTMLDivElement;
};

type Translator = (key: UiStringKey, params?: Record<string, string | number>) => string;

export type SetupDictionaryPreferencesOptions = {
  els: DictionaryPreferencesElements;
  getUiLanguage: () => UiLanguage;
  tr: Translator;
  setDictionaryStatus: (message: string) => void;
  addDictionaryReplaceRule: () => void;
  addDictionaryProtectRule: () => void;
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

export function setupDictionaryPreferences(opts: SetupDictionaryPreferencesOptions): void {
  const { els, getUiLanguage, tr, setDictionaryStatus, addDictionaryReplaceRule, addDictionaryProtectRule } = opts;

  els.dictionaryEnabled.addEventListener(
    'change',
    voidAsync(async () => {
      const res = await window.voiceInput.setDictionaryEnabled(els.dictionaryEnabled.checked);
      if (!res.ok) {
        setDictionaryStatus(formatApiError(getUiLanguage(), res, 'common.failed'));
        return;
      }
      setDictionaryStatus(tr('prefs.dictionary.status.saved'));
    })
  );

  els.addDictionaryReplaceRule.addEventListener('click', () => {
    addDictionaryReplaceRule();
  });

  els.addDictionaryProtectRule.addEventListener('click', () => {
    addDictionaryProtectRule();
  });
}
