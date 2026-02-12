import { DEFAULT_HISTORY_MAX_ITEMS, normalizeHistoryMaxItemsFromUi } from '../../shared/settingsConstraints';

type HistoryPreferencesElements = {
  historyMaxItems: HTMLInputElement;
  historyMaxItemsValue: HTMLDivElement;
};

export type SetupHistoryPreferencesOptions = {
  els: HistoryPreferencesElements;
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

function normalizeHistoryMaxItems(value: unknown): number {
  return normalizeHistoryMaxItemsFromUi(value);
}

async function applyHistoryMaxItemsFromUi(els: HistoryPreferencesElements, value: unknown): Promise<void> {
  const next = normalizeHistoryMaxItems(value);
  const res = await window.voiceInput.setHistoryMaxItems(next);
  if (!res.ok) return;
  els.historyMaxItems.value = String(next);
  els.historyMaxItemsValue.textContent = String(next);
}

export function setupHistoryPreferences(opts: SetupHistoryPreferencesOptions): void {
  const { els } = opts;

  els.historyMaxItems.addEventListener('input', () => {
    els.historyMaxItemsValue.textContent = String(normalizeHistoryMaxItems(els.historyMaxItems.value));
  });

  els.historyMaxItems.addEventListener(
    'change',
    voidAsync(async () => {
      await applyHistoryMaxItemsFromUi(els, els.historyMaxItems.value);
    })
  );

  els.historyMaxItemsValue.addEventListener(
    'dblclick',
    voidAsync(async () => {
      els.historyMaxItems.value = String(DEFAULT_HISTORY_MAX_ITEMS);
      els.historyMaxItemsValue.textContent = String(DEFAULT_HISTORY_MAX_ITEMS);
      await applyHistoryMaxItemsFromUi(els, DEFAULT_HISTORY_MAX_ITEMS);
    })
  );
}

