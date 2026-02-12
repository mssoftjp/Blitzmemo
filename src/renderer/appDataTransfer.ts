import { formatApiError } from '../shared/apiError';
import type { UiStringKey } from '../shared/i18n';
import type { UiLanguage } from '../shared/types';
import type { AppDataSections, SettingsSnapshot } from './voiceInputApi';

type AppDataTransferElements = {
  appDataAppSettings: HTMLInputElement;
  appDataDictionary: HTMLInputElement;
  appDataHistory: HTMLInputElement;
  appDataStats: HTMLInputElement;
  appDataUsage: HTMLInputElement;
  appDataExport: HTMLButtonElement;
  appDataImport: HTMLButtonElement;
  appDataStatus: HTMLDivElement;
  appDataExportPasswordModal: HTMLDivElement;
  appDataExportPasswordChoice: HTMLDivElement;
  appDataExportPasswordSet: HTMLDivElement;
  appDataExportPasswordNoPassword: HTMLButtonElement;
  appDataExportPasswordSetPassword: HTMLButtonElement;
  appDataExportPasswordCancel: HTMLButtonElement;
  appDataExportPasswordInput: HTMLInputElement;
  appDataExportPasswordConfirmInput: HTMLInputElement;
  appDataExportPasswordError: HTMLDivElement;
  appDataExportPasswordBack: HTMLButtonElement;
  appDataExportPasswordSubmit: HTMLButtonElement;
  appDataImportPasswordModal: HTMLDivElement;
  appDataImportPasswordInput: HTMLInputElement;
  appDataImportPasswordError: HTMLDivElement;
  appDataImportPasswordCancel: HTMLButtonElement;
  appDataImportPasswordSubmit: HTMLButtonElement;
};

type Translator = (key: UiStringKey, params?: Record<string, string | number>) => string;

export type SetupAppDataTransferOptions = {
  els: AppDataTransferElements;
  getUiLanguage: () => UiLanguage;
  tr: Translator;
  getActivePage: () => string;
  refreshUsage: () => Promise<void>;
  refreshStats: () => Promise<void>;
  applySettingsSnapshotToUi: (settings: SettingsSnapshot, permissions: { platform: string; accessibilityTrusted: boolean }) => void;
};

type PasswordPromptResult = { canceled: boolean; password: string | null };

function voidAsync<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    fn(...args).catch((error) => {
      console.error(error);
    });
  };
}

function getAppDataSectionsFromUi(els: AppDataTransferElements): AppDataSections {
  return {
    appSettings: els.appDataAppSettings.checked,
    dictionary: els.appDataDictionary.checked,
    history: els.appDataHistory.checked,
    stats: els.appDataStats.checked,
    usage: els.appDataUsage.checked
  };
}

function setAppDataStatus(els: AppDataTransferElements, message: string): void {
  els.appDataStatus.textContent = message;
}

function setModalOpen(modal: HTMLDivElement, open: boolean): void {
  modal.classList.toggle('avi-hidden', !open);
  if (open) {
    modal.focus();
  }
}

function normalizePasswordInput(value: string): string {
  return value.trim();
}

function showExportPasswordChoiceView(els: AppDataTransferElements): void {
  els.appDataExportPasswordChoice.classList.remove('avi-hidden');
  els.appDataExportPasswordSet.classList.add('avi-hidden');
  els.appDataExportPasswordError.textContent = '';
}

function showExportPasswordSetView(els: AppDataTransferElements): void {
  els.appDataExportPasswordChoice.classList.add('avi-hidden');
  els.appDataExportPasswordSet.classList.remove('avi-hidden');
  els.appDataExportPasswordError.textContent = '';
  els.appDataExportPasswordInput.value = '';
  els.appDataExportPasswordConfirmInput.value = '';
}

async function promptExportPassword(els: AppDataTransferElements, tr: Translator): Promise<PasswordPromptResult> {
  showExportPasswordChoiceView(els);
  setModalOpen(els.appDataExportPasswordModal, true);
  els.appDataExportPasswordNoPassword.focus();

  return await new Promise<PasswordPromptResult>((resolve) => {
    const close = (result: PasswordPromptResult) => {
      cleanup();
      setModalOpen(els.appDataExportPasswordModal, false);
      resolve(result);
    };

    const onOverlayClick = (event: MouseEvent) => {
      if (event.target !== els.appDataExportPasswordModal) return;
      close({ canceled: true, password: null });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close({ canceled: true, password: null });
        return;
      }
      if (event.key === 'Enter' && !els.appDataExportPasswordSet.classList.contains('avi-hidden')) {
        event.preventDefault();
        submit();
      }
    };

    const noPassword = () => close({ canceled: false, password: null });

    const setPassword = () => {
      showExportPasswordSetView(els);
      els.appDataExportPasswordInput.focus();
    };

    const cancel = () => close({ canceled: true, password: null });

    const back = () => {
      showExportPasswordChoiceView(els);
      els.appDataExportPasswordSetPassword.focus();
    };

    const submit = () => {
      const password = normalizePasswordInput(els.appDataExportPasswordInput.value);
      const confirm = normalizePasswordInput(els.appDataExportPasswordConfirmInput.value);

      if (!password) {
        els.appDataExportPasswordError.textContent = tr('prefs.transfer.exportPassword.error.empty');
        els.appDataExportPasswordInput.focus();
        return;
      }
      if (password !== confirm) {
        els.appDataExportPasswordError.textContent = tr('prefs.transfer.exportPassword.error.mismatch');
        els.appDataExportPasswordConfirmInput.focus();
        return;
      }
      close({ canceled: false, password });
    };

    const cleanup = () => {
      els.appDataExportPasswordModal.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeyDown);
      els.appDataExportPasswordNoPassword.removeEventListener('click', noPassword);
      els.appDataExportPasswordSetPassword.removeEventListener('click', setPassword);
      els.appDataExportPasswordCancel.removeEventListener('click', cancel);
      els.appDataExportPasswordBack.removeEventListener('click', back);
      els.appDataExportPasswordSubmit.removeEventListener('click', submit);
    };

    els.appDataExportPasswordModal.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeyDown);
    els.appDataExportPasswordNoPassword.addEventListener('click', noPassword);
    els.appDataExportPasswordSetPassword.addEventListener('click', setPassword);
    els.appDataExportPasswordCancel.addEventListener('click', cancel);
    els.appDataExportPasswordBack.addEventListener('click', back);
    els.appDataExportPasswordSubmit.addEventListener('click', submit);
  });
}

async function promptImportPassword(
  els: AppDataTransferElements,
  tr: Translator,
  opts: { error?: string | null } = {}
): Promise<{ canceled: boolean; password: string | null }> {
  els.appDataImportPasswordError.textContent = opts.error ?? '';
  els.appDataImportPasswordInput.value = '';
  setModalOpen(els.appDataImportPasswordModal, true);
  els.appDataImportPasswordInput.focus();

  return await new Promise<{ canceled: boolean; password: string | null }>((resolve) => {
    const close = (result: { canceled: boolean; password: string | null }) => {
      cleanup();
      setModalOpen(els.appDataImportPasswordModal, false);
      resolve(result);
    };

    const onOverlayClick = (event: MouseEvent) => {
      if (event.target !== els.appDataImportPasswordModal) return;
      close({ canceled: true, password: null });
    };

    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === 'Escape') {
        event.preventDefault();
        close({ canceled: true, password: null });
        return;
      }
      if (event.key === 'Enter') {
        event.preventDefault();
        submit();
      }
    };

    const cancel = () => close({ canceled: true, password: null });

    const submit = () => {
      const password = normalizePasswordInput(els.appDataImportPasswordInput.value);
      if (!password) {
        els.appDataImportPasswordError.textContent = tr('prefs.transfer.importPassword.error.empty');
        els.appDataImportPasswordInput.focus();
        return;
      }
      close({ canceled: false, password });
    };

    const cleanup = () => {
      els.appDataImportPasswordModal.removeEventListener('click', onOverlayClick);
      document.removeEventListener('keydown', onKeyDown);
      els.appDataImportPasswordCancel.removeEventListener('click', cancel);
      els.appDataImportPasswordSubmit.removeEventListener('click', submit);
    };

    els.appDataImportPasswordModal.addEventListener('click', onOverlayClick);
    document.addEventListener('keydown', onKeyDown);
    els.appDataImportPasswordCancel.addEventListener('click', cancel);
    els.appDataImportPasswordSubmit.addEventListener('click', submit);
  });
}

export function setupAppDataTransfer(opts: SetupAppDataTransferOptions): void {
  const { els, tr } = opts;

  els.appDataExport.addEventListener(
    'click',
    voidAsync(async () => {
      setAppDataStatus(els, '');
      const sections = getAppDataSectionsFromUi(els);
      const hasAny =
        sections.appSettings || sections.dictionary || sections.history || sections.stats || sections.usage;
      if (!hasAny) {
        setAppDataStatus(
          els,
          formatApiError(
            opts.getUiLanguage(),
            { errorCode: 'transfer.nothingSelected' },
            'prefs.transfer.error.failedToExport'
          )
        );
        return;
      }

      const prompt = await promptExportPassword(els, tr);
      if (prompt.canceled) {
        setAppDataStatus(els, tr('prefs.transfer.status.canceled'));
        return;
      }

      const res = await window.voiceInput.exportAppData(sections, { password: prompt.password });
      if (res.canceled) {
        setAppDataStatus(els, tr('prefs.transfer.status.canceled'));
        return;
      }
      if (!res.ok) {
        setAppDataStatus(els, formatApiError(opts.getUiLanguage(), res, 'prefs.transfer.error.failedToExport'));
        return;
      }
      setAppDataStatus(
        els,
        res.filePath ? tr('prefs.transfer.status.exportedWithPath', { path: res.filePath }) : tr('prefs.transfer.status.exported')
      );
    })
  );

  els.appDataImport.addEventListener(
    'click',
    voidAsync(async () => {
      setAppDataStatus(els, '');
      const sections = getAppDataSectionsFromUi(els);
      const hasAny =
        sections.appSettings || sections.dictionary || sections.history || sections.stats || sections.usage;
      if (!hasAny) {
        setAppDataStatus(
          els,
          formatApiError(
            opts.getUiLanguage(),
            { errorCode: 'transfer.nothingSelected' },
            'prefs.transfer.error.failedToImport'
          )
        );
        return;
      }

      const ok = window.confirm(tr('prefs.transfer.confirm.importOverwrite'));
      if (!ok) return;

      let res = await window.voiceInput.importAppData(sections);
      if (res.canceled) {
        setAppDataStatus(els, tr('prefs.transfer.status.canceled'));
        return;
      }
      if (!res.ok && (res.errorCode === 'transfer.passwordRequired' || res.errorCode === 'transfer.invalidPassword')) {
        const filePath = typeof res.filePath === 'string' ? res.filePath : '';
        if (!filePath) {
          setAppDataStatus(els, formatApiError(opts.getUiLanguage(), res, 'prefs.transfer.error.failedToImport'));
          return;
        }

        while (true) {
          const prompt = await promptImportPassword(els, tr, {
            error: res.errorCode === 'transfer.invalidPassword' ? tr('error.transfer.invalidPassword') : null
          });
          if (prompt.canceled) {
            setAppDataStatus(els, tr('prefs.transfer.status.canceled'));
            return;
          }

          res = await window.voiceInput.importAppData(sections, { filePath, password: prompt.password });
          if (res.canceled) {
            setAppDataStatus(els, tr('prefs.transfer.status.canceled'));
            return;
          }
          if (res.ok) break;
          if (res.errorCode === 'transfer.invalidPassword') {
            continue;
          }

          setAppDataStatus(els, formatApiError(opts.getUiLanguage(), res, 'prefs.transfer.error.failedToImport'));
          return;
        }
      }

      if (!res.ok) {
        setAppDataStatus(els, formatApiError(opts.getUiLanguage(), res, 'prefs.transfer.error.failedToImport'));
        return;
      }

      const imported = res.imported;
      setAppDataStatus(
        els,
        tr('prefs.transfer.status.importedSummary', {
          history: imported?.historyEntries ?? 0,
          stats: imported?.statsEntries ?? 0,
          usageModels: imported?.usageModels ?? 0
        })
      );

      const nextSettings = await window.voiceInput.getSettings();
      const nextPermissions = await window.voiceInput.getPermissions();
      opts.applySettingsSnapshotToUi(nextSettings, nextPermissions);

      if (sections.usage) {
        await opts.refreshUsage();
      }
      if (sections.stats && opts.getActivePage() === 'stats') {
        await opts.refreshStats();
      }
    })
  );
}
