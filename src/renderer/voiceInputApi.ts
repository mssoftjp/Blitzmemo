import type { VoiceInputApi } from '../shared/voiceInputApi';

export type {
  AboutInfo,
  ApiKeyStorage,
  AppDataSections,
  ExportAppDataResult,
  ImportAppDataResult,
  SettingsChangedPayload,
  SettingsSnapshot,
  VoiceInputApi
} from '../shared/voiceInputApi';

declare global {
  interface Window {
    voiceInput: VoiceInputApi;
  }
}

export {};
