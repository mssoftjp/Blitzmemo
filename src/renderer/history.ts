import type { HistoryEntry, UiLanguage } from '../shared/types';
import { isHistoryEntry, renderHistoryList } from './historyView';
import { t, type UiStringKey } from '../shared/i18n';
import { formatApiError } from '../shared/apiError';
import { applyAccentColor } from './accentColor';
import { applyI18n, setUiLanguage } from './i18n';

function applyPlatformClasses(platform: string): void {
  document.documentElement.classList.toggle('avi-platform-mac', platform === 'darwin');
  document.documentElement.classList.toggle('avi-platform-windows', platform === 'win32');
}

const els = {
  search: document.getElementById('historySearch') as HTMLInputElement,
  clear: document.getElementById('historyClear') as HTMLButtonElement,
  pin: document.getElementById('historyPin') as HTMLButtonElement,
  status: document.getElementById('historyStatus') as HTMLDivElement,
  list: document.getElementById('historyList') as HTMLDivElement
};

let historyCache: HistoryEntry[] = [];
let filteredCache: HistoryEntry[] = [];
let historyAlwaysOnTop = false;
let uiLanguage: UiLanguage = 'en';
let suppressNextHistoryRefresh = false;

function tr(key: UiStringKey, params?: Record<string, string | number>): string {
  return t(uiLanguage, key, params);
}

function voidAsync<TArgs extends unknown[]>(
  fn: (...args: TArgs) => Promise<void>
): (...args: TArgs) => void {
  return (...args: TArgs) => {
    fn(...args).catch((error) => {
      console.error(error);
    });
  };
}

function setStatus(message: string): void {
  els.status.textContent = message;
}

function updatePinUi(): void {
  els.pin.classList.remove('avi-button-primary');
  els.pin.classList.add('avi-button-secondary');
  els.pin.classList.toggle('avi-button-toggle-active', historyAlwaysOnTop);
  els.pin.setAttribute('aria-pressed', historyAlwaysOnTop ? 'true' : 'false');
}

async function refreshPinState(): Promise<void> {
  try {
    const settings = await window.voiceInput.getSettings();
    historyAlwaysOnTop = settings.historyAlwaysOnTop;
    updatePinUi();
  } catch {
    // ignore
  }
}

async function deleteEntry(entry: HistoryEntry): Promise<void> {
  const res = await window.voiceInput.deleteHistoryEntry(entry.id);
  if (!res.ok) {
    setStatus(formatApiError(uiLanguage, res, 'history.error.failedToDelete'));
    return;
  }

  suppressNextHistoryRefresh = true;
  historyCache = historyCache.filter((item) => item.id !== entry.id);
  applyFilter();
  setStatus('');
}

function renderHistory(): void {
  const emptyMessage = historyCache.length === 0 ? tr('history.empty.noHistory') : tr('history.empty.noMatches');
  renderHistoryList({
    container: els.list,
    entries: filteredCache,
    emptyMessage,
    copyLabel: tr('common.copy'),
    deleteLabel: tr('common.delete'),
    onDeleteClick: voidAsync(deleteEntry),
    uiLanguage
  });
}

function applyFilter(): void {
  const query = els.search.value.trim().toLowerCase();
  if (!query) {
    filteredCache = [...historyCache];
    renderHistory();
    return;
  }

  filteredCache = historyCache.filter((entry) => {
    const haystack = `${entry.text}\n${entry.transcript}`.toLowerCase();
    return haystack.includes(query);
  });
  renderHistory();
}

async function refreshHistory(): Promise<void> {
  setStatus(tr('common.loading'));
  const res = await window.voiceInput.listHistory();
  if (!res.ok) {
    historyCache = [];
    filteredCache = [];
    renderHistory();
    setStatus(formatApiError(uiLanguage, res, 'history.error.failedToLoad'));
    return;
  }

  const entries = Array.isArray(res.entries) ? res.entries : [];
  historyCache = entries.filter(isHistoryEntry).sort((a, b) => b.createdAt - a.createdAt);
  applyFilter();
  setStatus('');
}

export async function initHistory(): Promise<void> {
  try {
    const permissions = await window.voiceInput.getPermissions();
    applyPlatformClasses(permissions.platform);
  } catch {
    // ignore
  }

  try {
    const settings = await window.voiceInput.getSettings();
    uiLanguage = settings.uiLanguage;
    applyAccentColor(settings.accentColor);
  } catch {
    // ignore
  }
  setUiLanguage(uiLanguage);
  applyI18n();
  document.title = `${tr('app.name')} - ${tr('history.title')}`;

  window.voiceInput.onUiLanguageChanged((language) => {
    uiLanguage = language;
    setUiLanguage(uiLanguage);
    applyI18n();
    document.title = `${tr('app.name')} - ${tr('history.title')}`;
    renderHistory();
  });

  window.voiceInput.onAccentColorChanged((accentColor) => {
    applyAccentColor(accentColor);
  });

  await refreshPinState();

  els.search.addEventListener('input', () => applyFilter());

  window.voiceInput.onHistoryUpdated(() => {
    if (suppressNextHistoryRefresh) {
      suppressNextHistoryRefresh = false;
      return;
    }
    void refreshHistory();
  });

  els.clear.addEventListener(
    'click',
    voidAsync(async () => {
      const ok = window.confirm(tr('history.confirm.clear'));
      if (!ok) return;
      const res = await window.voiceInput.clearHistory();
      if (!res.ok) {
        setStatus(formatApiError(uiLanguage, res, 'history.error.failedToClear'));
        return;
      }
      suppressNextHistoryRefresh = true;
      historyCache = [];
      filteredCache = [];
      renderHistory();
      setStatus('');
    })
  );

  els.pin.addEventListener(
    'click',
    voidAsync(async () => {
      historyAlwaysOnTop = !historyAlwaysOnTop;
      updatePinUi();
      await window.voiceInput.setHistoryAlwaysOnTop(historyAlwaysOnTop);
    })
  );

  await refreshHistory();
}
