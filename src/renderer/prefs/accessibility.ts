import { formatApiError } from '../../shared/apiError';
import type { UiStringKey } from '../../shared/i18n';
import type { UiLanguage } from '../../shared/types';

type AccessibilityElements = {
  requestAccessibility: HTMLButtonElement;
  openAccessibility: HTMLButtonElement;
  accessibilityStatus: HTMLDivElement;
};

type Translator = (key: UiStringKey, params?: Record<string, string | number>) => string;

export type SetupAccessibilityPreferencesOptions = {
  els: AccessibilityElements;
  getUiLanguage: () => UiLanguage;
  tr: Translator;
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

export function setupAccessibilityPreferences(opts: SetupAccessibilityPreferencesOptions): void {
  const { els, getUiLanguage, tr } = opts;

  els.requestAccessibility.addEventListener(
    'click',
    voidAsync(async () => {
      const res = await window.voiceInput.requestAccessibilityPermission();
      if (!res.ok) {
        els.accessibilityStatus.textContent = formatApiError(getUiLanguage(), res, 'common.failed');
        return;
      }
      els.accessibilityStatus.textContent = res.trusted ? tr('common.allowed') : tr('common.notAllowed');
    })
  );

  els.openAccessibility.addEventListener(
    'click',
    voidAsync(async () => {
      const res = await window.voiceInput.openAccessibilitySettings();
      if (!res.ok) {
        els.accessibilityStatus.textContent = formatApiError(getUiLanguage(), res, 'common.failed');
      }
    })
  );
}

