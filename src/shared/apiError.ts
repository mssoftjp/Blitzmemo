import type { UiLanguage } from './types';
import { t, type UiStringKey } from './i18n';
import type { ApiErrorCode } from './voiceInputApi';

export function uiStringKeyForErrorCode(code: ApiErrorCode): UiStringKey | null {
  switch (code) {
    case 'canceled':
      return 'common.canceled';
    case 'unknown':
      return 'common.failed';
    case 'apiKey.notSet':
      return 'error.apiKey.notSet';
    case 'settings.invalidApiKeyFormat':
      return 'error.apiKey.invalidFormat';
    case 'settings.secureStorageUnavailable':
      return 'error.apiKey.secureStorageUnavailable';
    case 'settings.invalidUiLanguage':
      return 'error.uiLanguage.invalid';
    case 'hotkey.empty':
      return 'error.hotkey.empty';
    case 'hotkey.conflict':
      return 'error.hotkey.conflict';
    case 'hotkey.inUse':
      return 'error.hotkey.inUse';
    case 'hotkey.invalid':
      return 'error.hotkey.invalid';
    case 'history.failedToLoad':
      return 'history.error.failedToLoad';
    case 'history.failedToClear':
      return 'history.error.failedToClear';
    case 'history.failedToDelete':
      return 'history.error.failedToDelete';
    case 'history.openFailed':
      return 'prefs.history.error.failedToOpenWindow';
    case 'transfer.nothingSelected':
      return 'error.transfer.nothingSelected';
    case 'transfer.filePathEmpty':
      return 'error.transfer.filePathEmpty';
    case 'transfer.passwordRequired':
      return 'error.transfer.passwordRequired';
    case 'transfer.invalidPassword':
      return 'error.transfer.invalidPassword';
    case 'transfer.failedToExport':
      return 'prefs.transfer.error.failedToExport';
    case 'transfer.failedToImport':
      return 'prefs.transfer.error.failedToImport';
    case 'dictionary.invalidRules':
      return 'error.dictionary.invalidRules';
    case 'memo.notAvailable':
      return 'error.memo.notAvailable';
    case 'invalidPayload':
      return 'error.invalidPayload';
    case 'notSupported':
      return 'error.notSupported';
    case 'window.notFound':
      return 'error.windowNotFound';
    case 'transcribe.failed':
      return 'transcribe.error.failed';
    case 'translation.failed':
      return 'memo.alert.translationFailed';
  }
}

export function formatApiError(
  uiLanguage: UiLanguage,
  opts: { errorCode?: ApiErrorCode; error?: string; canceled?: boolean },
  fallbackKey: UiStringKey
): string {
  const key = opts.errorCode ? uiStringKeyForErrorCode(opts.errorCode) : null;
  const base = t(uiLanguage, key ?? fallbackKey);
  if (opts.canceled || opts.errorCode === 'canceled') return base;
  const detail = typeof opts.error === 'string' ? opts.error.trim() : '';
  if (!detail || detail === base) return base;
  return `${base} (${detail})`;
}
