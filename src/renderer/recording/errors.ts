import type { UiStringKey } from '../../shared/i18n';

type Translator = (key: UiStringKey, params?: Record<string, string | number>) => string;

export function formatStartRecordingErrorMessage(tr: Translator, error: unknown): string {
  if (error instanceof DOMException) {
    if (error.name === 'NotAllowedError' || error.name === 'SecurityError') {
      return tr('mic.error.permissionDenied');
    }
    if (error.name === 'NotFoundError' || error.name === 'OverconstrainedError') {
      return tr('mic.error.notFound');
    }
  }

  if (error instanceof Error) {
    const trimmed = error.message.trim();
    if (trimmed) return trimmed;
  }

  return tr('common.failed');
}

