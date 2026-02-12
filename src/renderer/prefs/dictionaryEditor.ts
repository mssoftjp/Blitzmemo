import { formatApiError } from '../../shared/apiError';
import { parseDictionaryRules, serializeDictionaryRules, validateDictionaryRules, type DictionaryRule } from '../../shared/dictionary';
import type { UiStringKey } from '../../shared/i18n';
import type { UiLanguage } from '../../shared/types';

type ReplaceRow = {
  from: string;
  to: string;
};

type ProtectRow = {
  from: string;
};

type DictionaryEditorElements = {
  dictionaryEnabled: HTMLInputElement;
  dictionaryReplaceTable: HTMLDivElement;
  dictionaryProtectTable: HTMLDivElement;
  dictionaryStatus: HTMLDivElement;
};

type Translator = (key: UiStringKey, params?: Record<string, string | number>) => string;

export type DictionaryEditor = {
  setStatus: (message: string) => void;
  render: () => void;
  init: (text: string) => void;
  refreshFromSettings: () => Promise<void>;
  addReplaceRule: () => void;
  addProtectRule: () => void;
};

const DICTIONARY_AUTOSAVE_DELAY_MS = 800;

export function setupDictionaryEditor(opts: {
  els: DictionaryEditorElements;
  tr: Translator;
  getUiLanguage: () => UiLanguage;
}): DictionaryEditor {
  const { els, tr, getUiLanguage } = opts;

  let replaceRows: ReplaceRow[] = [];
  let protectRows: ProtectRow[] = [];
  let dirty = false;
  let autosaveTimer: number | null = null;
  let saveToken = 0;
  let refreshToken = 0;

  function setStatus(message: string): void {
    els.dictionaryStatus.textContent = message;
  }

  function cancelAutosave(): void {
    if (autosaveTimer === null) return;
    window.clearTimeout(autosaveTimer);
    autosaveTimer = null;
  }

  function stringToPatterns(value: string): string[] {
    return value
      .split(/[|,]/)
      .map((p) => p.trim())
      .filter(Boolean);
  }

  function findUnsupportedPatternReason(pattern: string): string | null {
    const text = String(pattern ?? '');
    if (text.includes('->') || text.includes('=>') || text.includes('→')) {
      return tr('dictionaryAdd.error.patternInvalid');
    }
    return null;
  }

  function rulesToRows(rules: DictionaryRule[]): { replaceRows: ReplaceRow[]; protectRows: ProtectRow[] } {
    const nextReplaceRows: ReplaceRow[] = [];
    const nextProtectRows: ProtectRow[] = [];

    for (const rule of rules) {
      if (rule.type === 'protect') {
        nextProtectRows.push({ from: rule.from.join(' | ') });
        continue;
      }
      nextReplaceRows.push({ from: rule.from.join(' | '), to: rule.to });
    }

    return { replaceRows: nextReplaceRows, protectRows: nextProtectRows };
  }

  function rowsToRules(
    nextReplaceRows: ReplaceRow[],
    nextProtectRows: ProtectRow[]
  ): { ok: true; rules: DictionaryRule[] } | { ok: false; error: string } {
    const rules: DictionaryRule[] = [];

    const replaceLabel = tr('prefs.dictionary.mode.replace');
    for (let index = 0; index < nextReplaceRows.length; index++) {
      const row = nextReplaceRows[index];
      const fromRaw = String(row?.from ?? '').trim();
      const to = String(row?.to ?? '').trim();
      if (!fromRaw && !to) continue;

      const from = stringToPatterns(fromRaw);
      if (from.length === 0) {
        return { ok: false, error: `${replaceLabel}: ${tr('prefs.dictionary.error.rowFromEmpty', { row: index + 1 })}` };
      }
      for (const pattern of from) {
        const reason = findUnsupportedPatternReason(pattern);
        if (reason) {
          return {
            ok: false,
            error: `${replaceLabel}: ${tr('prefs.dictionary.error.rowPatternInvalid', { row: index + 1, reason })}`
          };
        }
      }
      if (!to) {
        return { ok: false, error: `${replaceLabel}: ${tr('prefs.dictionary.error.rowToEmpty', { row: index + 1 })}` };
      }

      rules.push({ type: 'replace', from, to });
    }

    const protectLabel = tr('prefs.dictionary.mode.protect');
    for (let index = 0; index < nextProtectRows.length; index++) {
      const row = nextProtectRows[index];
      const fromRaw = String(row?.from ?? '').trim();
      if (!fromRaw) continue;

      const from = stringToPatterns(fromRaw);
      if (from.length === 0) {
        return { ok: false, error: `${protectLabel}: ${tr('prefs.dictionary.error.rowFromEmpty', { row: index + 1 })}` };
      }
      for (const pattern of from) {
        const reason = findUnsupportedPatternReason(pattern);
        if (reason) {
          return {
            ok: false,
            error: `${protectLabel}: ${tr('prefs.dictionary.error.rowPatternInvalid', { row: index + 1, reason })}`
          };
        }
      }

      rules.push({ type: 'protect', from });
    }

    return { ok: true, rules };
  }

  async function saveRules(token: number, rules: DictionaryRule[], options: { updateTable: boolean }): Promise<void> {
    const validation = validateDictionaryRules(rules);
    if (!validation.ok) {
      if (token !== saveToken) return;
      setStatus(formatApiError(getUiLanguage(), { error: validation.errors[0] }, 'prefs.dictionary.status.invalidRules'));
      return;
    }

    const text = serializeDictionaryRules(rules);
    if (token !== saveToken) return;
    setStatus(tr('prefs.dictionary.status.saving'));

    const res = await window.voiceInput.setDictionaryRulesText(text);
    if (token !== saveToken) return;
    if (!res.ok) {
      setStatus(formatApiError(getUiLanguage(), res, 'prefs.dictionary.status.invalidRules'));
      return;
    }

    if (options.updateTable) {
      const parsedRows = rulesToRows(rules);
      replaceRows = parsedRows.replaceRows;
      protectRows = parsedRows.protectRows;
      render();
    }

    dirty = false;
    setStatus(tr('prefs.dictionary.status.savedCount', { count: res.ruleCount ?? 0 }));
  }

  function scheduleAutosave(): void {
    cancelAutosave();
    const token = (saveToken += 1);
    autosaveTimer = window.setTimeout(() => {
      autosaveTimer = null;
      if (token !== saveToken) return;

      const rulesResult = rowsToRules(replaceRows, protectRows);
      if (!rulesResult.ok) {
        setStatus(rulesResult.error);
        return;
      }

      void saveRules(token, rulesResult.rules, { updateTable: false });
    }, DICTIONARY_AUTOSAVE_DELAY_MS);
  }

  function render(options: { focus?: { type: 'replace' | 'protect'; index: number } } = {}): void {
    els.dictionaryReplaceTable.replaceChildren();
    els.dictionaryProtectTable.replaceChildren();

    const replaceInner = document.createElement('div');
    replaceInner.className = 'avi-table-inner';

    const replaceTable = document.createElement('table');
    replaceTable.className = 'avi-table';

    const replaceThead = document.createElement('thead');
    const replaceHeadRow = document.createElement('tr');
    const fromTh = document.createElement('th');
    fromTh.textContent = tr('prefs.dictionary.table.from');
    const toTh = document.createElement('th');
    toTh.textContent = tr('prefs.dictionary.table.to');
    const replaceActionTh = document.createElement('th');
    replaceActionTh.className = 'avi-table-action';
    replaceActionTh.textContent = '';
    replaceHeadRow.appendChild(fromTh);
    replaceHeadRow.appendChild(toTh);
    replaceHeadRow.appendChild(replaceActionTh);
    replaceThead.appendChild(replaceHeadRow);

    const replaceTbody = document.createElement('tbody');
    replaceRows.forEach((row, index) => {
      const rowTr = document.createElement('tr');

      const fromTd = document.createElement('td');
      const fromInput = document.createElement('input');
      fromInput.type = 'text';
      fromInput.className = 'avi-table-input';
      fromInput.placeholder = tr('prefs.dictionary.placeholder.from');
      fromInput.value = row.from;
      fromInput.addEventListener('input', () => {
        replaceRows[index].from = fromInput.value;
        dirty = true;
        setStatus('');
        scheduleAutosave();
      });
      fromTd.appendChild(fromInput);

      const toTd = document.createElement('td');
      const toInput = document.createElement('input');
      toInput.type = 'text';
      toInput.className = 'avi-table-input';
      toInput.placeholder = tr('prefs.dictionary.placeholder.to');
      toInput.value = row.to;
      toInput.addEventListener('input', () => {
        replaceRows[index].to = toInput.value;
        dirty = true;
        setStatus('');
        scheduleAutosave();
      });
      toTd.appendChild(toInput);

      const actionTd = document.createElement('td');
      actionTd.className = 'avi-table-action';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'avi-icon-button avi-icon-button-danger';
      deleteButton.textContent = '×';
      deleteButton.setAttribute('aria-label', tr('common.delete'));
      deleteButton.addEventListener('click', () => {
        replaceRows.splice(index, 1);
        dirty = true;
        render();
        setStatus('');
        scheduleAutosave();
      });
      actionTd.appendChild(deleteButton);

      rowTr.appendChild(fromTd);
      rowTr.appendChild(toTd);
      rowTr.appendChild(actionTd);
      replaceTbody.appendChild(rowTr);

      if (options.focus?.type === 'replace' && options.focus.index === index) {
        setTimeout(() => {
          fromInput.focus();
        }, 0);
      }
    });

    replaceTable.appendChild(replaceThead);
    replaceTable.appendChild(replaceTbody);
    replaceInner.appendChild(replaceTable);
    els.dictionaryReplaceTable.appendChild(replaceInner);

    const protectInner = document.createElement('div');
    protectInner.className = 'avi-table-inner';

    const protectTable = document.createElement('table');
    protectTable.className = 'avi-table';

    const protectThead = document.createElement('thead');
    const protectHeadRow = document.createElement('tr');
    const protectTh = document.createElement('th');
    protectTh.textContent = tr('prefs.dictionary.mode.protect');
    const protectActionTh = document.createElement('th');
    protectActionTh.className = 'avi-table-action';
    protectActionTh.textContent = '';
    protectHeadRow.appendChild(protectTh);
    protectHeadRow.appendChild(protectActionTh);
    protectThead.appendChild(protectHeadRow);

    const protectTbody = document.createElement('tbody');
    protectRows.forEach((row, index) => {
      const rowTr = document.createElement('tr');

      const fromTd = document.createElement('td');
      const fromInput = document.createElement('input');
      fromInput.type = 'text';
      fromInput.className = 'avi-table-input';
      fromInput.placeholder = tr('prefs.dictionary.placeholder.protect');
      fromInput.value = row.from;
      fromInput.addEventListener('input', () => {
        protectRows[index].from = fromInput.value;
        dirty = true;
        setStatus('');
        scheduleAutosave();
      });
      fromTd.appendChild(fromInput);

      const actionTd = document.createElement('td');
      actionTd.className = 'avi-table-action';
      const deleteButton = document.createElement('button');
      deleteButton.type = 'button';
      deleteButton.className = 'avi-icon-button avi-icon-button-danger';
      deleteButton.textContent = '×';
      deleteButton.setAttribute('aria-label', tr('common.delete'));
      deleteButton.addEventListener('click', () => {
        protectRows.splice(index, 1);
        dirty = true;
        render();
        setStatus('');
        scheduleAutosave();
      });
      actionTd.appendChild(deleteButton);

      rowTr.appendChild(fromTd);
      rowTr.appendChild(actionTd);
      protectTbody.appendChild(rowTr);

      if (options.focus?.type === 'protect' && options.focus.index === index) {
        setTimeout(() => {
          fromInput.focus();
        }, 0);
      }
    });

    protectTable.appendChild(protectThead);
    protectTable.appendChild(protectTbody);
    protectInner.appendChild(protectTable);
    els.dictionaryProtectTable.appendChild(protectInner);
  }

  function init(text: string): void {
    cancelAutosave();
    saveToken += 1;

    const parsed = parseDictionaryRules(text);
    const parsedRows = rulesToRows(parsed.rules);
    replaceRows = parsedRows.replaceRows;
    protectRows = parsedRows.protectRows;
    dirty = false;
    render();
    const validation = validateDictionaryRules(parsed.rules);
    setStatus(parsed.errors[0] ?? (!validation.ok ? validation.errors[0] ?? '' : ''));
  }

  async function refreshFromSettings(): Promise<void> {
    if (dirty) return;
    const token = (refreshToken += 1);
    const settings = await window.voiceInput.getSettings();
    if (token !== refreshToken) return;

    els.dictionaryEnabled.checked = settings.dictionaryEnabled;
    init(settings.dictionaryRulesText);
  }

  function addReplaceRule(): void {
    replaceRows.push({ from: '', to: '' });
    dirty = true;
    render({ focus: { type: 'replace', index: replaceRows.length - 1 } });
    setStatus('');
  }

  function addProtectRule(): void {
    protectRows.push({ from: '' });
    dirty = true;
    render({ focus: { type: 'protect', index: protectRows.length - 1 } });
    setStatus('');
  }

  return { setStatus, render: () => render(), init, refreshFromSettings, addReplaceRule, addProtectRule };
}
