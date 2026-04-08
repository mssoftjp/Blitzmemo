import type { SettingsChangedPayload } from '../voiceInputApi';
import type { TranscriptionLanguage } from '../../shared/types';

type MemoStateElements = {
  autoMemo: HTMLInputElement;
  insertAtCursor: HTMLInputElement;
};

export type SetupMemoStateOptions = {
  els: MemoStateElements;
  applyAutoPasteSettings: (settings: SettingsChangedPayload) => void;
  updateAutoMemoUi: () => void;
  setMemoPadInsertAtCursor: (value: boolean) => void;
  setMemoPadUndoMaxSteps: (value: number) => void;
  setTranslationEnabled: (value: boolean) => void;
  setLastTranslateTarget: (value: TranscriptionLanguage) => void;
  setTranslateButtonLabel: (value: TranscriptionLanguage) => void;
  updateTranslateUi: () => void;
  updateAutoMemoHint: () => void;
};

export type MemoStateApi = {
  applySettingsChanged: (settings: SettingsChangedPayload) => void;
};

export function setupMemoState(opts: SetupMemoStateOptions): MemoStateApi {
  const els = opts.els;

  const applySettingsChanged = (settings: SettingsChangedPayload) => {
    opts.applyAutoPasteSettings(settings);
    els.autoMemo.checked = settings.memoPadAutoMemo;
    els.insertAtCursor.checked = settings.memoPadInsertAtCursor;
    opts.setMemoPadInsertAtCursor(settings.memoPadInsertAtCursor);
    opts.updateAutoMemoUi();
    opts.setMemoPadUndoMaxSteps(settings.memoPadUndoMaxSteps);
    opts.setTranslationEnabled(settings.translationEnabled);
    opts.setLastTranslateTarget(settings.translationTarget);
    opts.setTranslateButtonLabel(settings.translationTarget);
    opts.updateTranslateUi();
    opts.updateAutoMemoHint();
  };

  return { applySettingsChanged };
}
