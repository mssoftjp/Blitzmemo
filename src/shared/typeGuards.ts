import type { TranscriptionLanguage, TranscriptionModel, UiLanguage } from './types';

export function isUiLanguage(value: unknown): value is UiLanguage {
  return (
    value === 'ja' ||
    value === 'en' ||
    value === 'es' ||
    value === 'pt' ||
    value === 'fr' ||
    value === 'de' ||
    value === 'it' ||
    value === 'pl' ||
    value === 'id' ||
    value === 'ru' ||
    value === 'vi' ||
    value === 'tr' ||
    value === 'th' ||
    value === 'ko' ||
    value === 'zh-hans' ||
    value === 'zh-hant'
  );
}

export function isTranscriptionLanguage(value: unknown): value is TranscriptionLanguage {
  return (
    value === 'ja' ||
    value === 'en' ||
    value === 'es' ||
    value === 'it' ||
    value === 'de' ||
    value === 'pt' ||
    value === 'pl' ||
    value === 'id' ||
    value === 'fr' ||
    value === 'ru' ||
    value === 'vi' ||
    value === 'nl' ||
    value === 'uk' ||
    value === 'ko' ||
    value === 'ro' ||
    value === 'ms' ||
    value === 'tr' ||
    value === 'th' ||
    value === 'sv' ||
    value === 'no' ||
    value === 'da' ||
    value === 'zh-hans' ||
    value === 'zh-hant'
  );
}

export function isTranscriptionModel(value: unknown): value is TranscriptionModel {
  return value === 'gpt-4o-transcribe' || value === 'gpt-4o-mini-transcribe';
}

