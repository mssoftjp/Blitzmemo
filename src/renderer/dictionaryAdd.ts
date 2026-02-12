import {
  consolidateDictionaryRulesByTo,
  parseDictionaryRules,
  serializeDictionaryRules,
  type DictionaryProtectRule,
  type DictionaryReplaceRule
} from '../shared/dictionary';
import type { UiLanguage } from '../shared/types';
import { t, type UiStringKey } from '../shared/i18n';
import { formatApiError } from '../shared/apiError';
import { applyAccentColor } from './accentColor';
import { applyI18n, setUiLanguage } from './i18n';

const els = {
  modeReplace: document.getElementById('dictionaryModeReplace') as HTMLInputElement,
  modeProtect: document.getElementById('dictionaryModeProtect') as HTMLInputElement,
  fromLabel: document.getElementById('dictionaryFromLabel') as HTMLLabelElement,
  from: document.getElementById('dictionaryFrom') as HTMLInputElement,
  toRow: document.getElementById('dictionaryToRow') as HTMLDivElement,
  to: document.getElementById('dictionaryTo') as HTMLInputElement,
  replaceSelectionRow: document.getElementById('dictionaryReplaceSelectionRow') as HTMLDivElement,
  replaceSelection: document.getElementById('dictionaryReplaceSelection') as HTMLInputElement,
  status: document.getElementById('dictionaryStatus') as HTMLDivElement,
  cancel: document.getElementById('dictionaryCancel') as HTMLButtonElement,
  save: document.getElementById('dictionarySave') as HTMLButtonElement
};

let uiLanguage: UiLanguage = 'en';

function tr(key: UiStringKey, params?: Record<string, string | number>): string {
  return t(uiLanguage, key, params);
}

function updateWindowTitle(): void {
  document.title = `${tr('app.name')} - ${tr('prefs.nav.dictionary')}`;
}

function setStatus(message: string): void {
  els.status.textContent = message;
}

function normalizeOneLine(value: string): string {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function stringToPatterns(value: string): string[] {
  return String(value ?? '')
    .split(/[|,]/)
    .map((p) => p.trim())
    .filter(Boolean);
}

function findUnsupportedPatternReason(pattern: string): string | null {
  const text = String(pattern ?? '');
  if (text.includes('->') || text.includes('=>') || text.includes('→')) return tr('dictionaryAdd.error.patternInvalid');
  return null;
}

function getMode(): 'replace' | 'protect' {
  return els.modeProtect.checked ? 'protect' : 'replace';
}

function applyModeToUi(): void {
  const mode = getMode();
  const isReplace = mode === 'replace';
  els.fromLabel.textContent = isReplace ? tr('dictionaryAdd.label.from') : tr('dictionaryAdd.label.protectText');
  els.toRow.style.display = isReplace ? '' : 'none';
  els.replaceSelectionRow.style.display = isReplace ? '' : 'none';
  if (!isReplace) {
    els.to.value = '';
    els.replaceSelection.checked = false;
  }
  setStatus('');
}

async function saveRule(): Promise<void> {
  const mode = getMode();
  const fromRaw = normalizeOneLine(els.from.value);
  const to = normalizeOneLine(els.to.value);
  if (!fromRaw) {
    setStatus(tr('dictionaryAdd.error.fromEmpty'));
    return;
  }
  if (mode === 'replace' && !to) {
    setStatus(tr('dictionaryAdd.error.toEmpty'));
    return;
  }

  const from = stringToPatterns(fromRaw);
  if (from.length === 0) {
    setStatus(tr('dictionaryAdd.error.fromEmpty'));
    return;
  }

  for (const pattern of from) {
    const reason = findUnsupportedPatternReason(pattern);
    if (reason) {
      setStatus(reason);
      return;
    }
  }

  els.save.disabled = true;
  els.cancel.disabled = true;
  setStatus('');

  try {
    const settings = await window.voiceInput.getSettings();
    const parsed = parseDictionaryRules(settings.dictionaryRulesText);
    if (parsed.errors.length > 0) {
      setStatus(formatApiError(uiLanguage, { error: parsed.errors[0] }, 'dictionaryAdd.error.rulesInvalid'));
      return;
    }

    const protectRules = parsed.rules.filter((r): r is DictionaryProtectRule => r.type === 'protect');
    const replaceRules = parsed.rules.filter((r): r is DictionaryReplaceRule => r.type === 'replace');

    const protectedPatternSet = new Set<string>();
    for (const rule of protectRules) {
      for (const pattern of rule.from) protectedPatternSet.add(pattern);
    }

    if (mode === 'replace') {
      for (const pattern of from) {
        if (protectedPatternSet.has(pattern)) {
          setStatus(tr('dictionaryAdd.error.patternProtected', { pattern }));
          return;
        }
      }

      const existingMap = new Map<string, string>();
      for (const rule of replaceRules) {
        for (const pattern of rule.from) {
          if (!existingMap.has(pattern)) {
            existingMap.set(pattern, rule.to);
          }
        }
      }

      for (const pattern of from) {
        const existingTo = existingMap.get(pattern);
        if (existingTo && existingTo !== to) {
          setStatus(tr('dictionaryAdd.error.alreadyMapped', { pattern, existingTo }));
          return;
        }
      }

      const removeSet = new Set(from);
      const nextReplaceRules = replaceRules
        .map((rule) => ({ ...rule, from: rule.from.filter((p) => !removeSet.has(p)) }))
        .filter((rule) => rule.from.length > 0);

      nextReplaceRules.unshift({ type: 'replace', from, to });

      const consolidatedRules = consolidateDictionaryRulesByTo(nextReplaceRules);
      const text = serializeDictionaryRules([...consolidatedRules, ...protectRules]);
      const res = await window.voiceInput.setDictionaryRulesText(text);
      if (!res.ok) {
        setStatus(formatApiError(uiLanguage, res, 'dictionaryAdd.error.failedToSave'));
        return;
      }

      if (!settings.dictionaryEnabled) {
        const enableRes = await window.voiceInput.setDictionaryEnabled(true);
        if (!enableRes.ok) {
          setStatus(formatApiError(uiLanguage, enableRes, 'dictionaryAdd.error.savedButEnableFailed'));
          return;
        }
      }

      if (els.replaceSelection.checked) {
        const replaceRes = await window.voiceInput.memoReplaceSelection({ replacementText: to });
        if (!replaceRes.ok) {
          setStatus(formatApiError(uiLanguage, replaceRes, 'dictionaryAdd.error.savedButReplaceFailed'));
          return;
        }
      }

      window.close();
      return;
    }

    for (const pattern of from) {
      if (protectedPatternSet.has(pattern)) {
        setStatus(tr('dictionaryAdd.error.patternProtected', { pattern }));
        return;
      }
    }

    const removeSet = new Set(from);
    const nextProtectRules = protectRules
      .map((rule) => ({ ...rule, from: rule.from.filter((p) => !removeSet.has(p)) }))
      .filter((rule) => rule.from.length > 0);

    nextProtectRules.unshift({ type: 'protect', from });

    const text = serializeDictionaryRules([...replaceRules, ...nextProtectRules]);
    const res = await window.voiceInput.setDictionaryRulesText(text);
    if (!res.ok) {
      setStatus(formatApiError(uiLanguage, res, 'dictionaryAdd.error.failedToSave'));
      return;
    }

    if (!settings.dictionaryEnabled) {
      const enableRes = await window.voiceInput.setDictionaryEnabled(true);
      if (!enableRes.ok) {
        setStatus(formatApiError(uiLanguage, enableRes, 'dictionaryAdd.error.savedButEnableFailed'));
        return;
      }
    }

    window.close();
  } finally {
    els.save.disabled = false;
    els.cancel.disabled = false;
  }
}

export async function initDictionaryAdd(): Promise<void> {
  els.cancel.addEventListener('click', () => {
    window.close();
  });

  els.modeReplace.addEventListener('change', () => {
    applyModeToUi();
    if (getMode() === 'replace') {
      els.to.focus();
    } else {
      els.from.focus();
    }
  });

  els.modeProtect.addEventListener('change', () => {
    applyModeToUi();
    if (getMode() === 'replace') {
      els.to.focus();
    } else {
      els.from.focus();
    }
  });

  els.save.addEventListener('click', () => {
    void saveRule();
  });

  els.from.addEventListener('input', () => {
    setStatus('');
  });

  els.to.addEventListener('input', () => {
    setStatus('');
  });

  try {
    const settings = await window.voiceInput.getSettings();
    uiLanguage = settings.uiLanguage;
    applyAccentColor(settings.accentColor);
  } catch {
    // ignore
  }
  setUiLanguage(uiLanguage);
  applyI18n();
  updateWindowTitle();

  window.voiceInput.onUiLanguageChanged((language) => {
    uiLanguage = language;
    setUiLanguage(uiLanguage);
    applyI18n();
    updateWindowTitle();
    applyModeToUi();
  });

  window.voiceInput.onAccentColorChanged((accentColor) => {
    applyAccentColor(accentColor);
  });

  const query = new URLSearchParams(window.location.search);
  const selectionText = query.get('from') ?? '';
  els.from.value = normalizeOneLine(selectionText);

  applyModeToUi();
  if (getMode() === 'replace') {
    els.to.focus();
  } else {
    els.from.focus();
  }
}
