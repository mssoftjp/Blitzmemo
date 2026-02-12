import type { UiLanguage } from '../shared/types';
import { t, type UiStringKey } from '../shared/i18n';

function normalizeKey(value: string | undefined | null): UiStringKey | null {
  if (!value) return null;
  return value as UiStringKey;
}

function applyI18nAttr(el: HTMLElement, key: UiStringKey, attr: string): void {
  const value = t(currentUiLanguage, key);
  if (attr === 'text') {
    el.textContent = value;
    return;
  }
  el.setAttribute(attr, value);
}

let currentUiLanguage: UiLanguage = 'en';

export function setUiLanguage(language: UiLanguage): void {
  currentUiLanguage = language;
  document.documentElement.lang = language;
}

export function applyI18n(root: ParentNode = document): void {
  const nodes = root.querySelectorAll<HTMLElement>('[data-i18n]');
  for (const el of nodes) {
    const key = normalizeKey(el.dataset.i18n);
    if (!key) continue;
    const attr = el.dataset.i18nAttr;
    if (!attr) {
      el.textContent = t(currentUiLanguage, key);
      continue;
    }
    for (const item of attr.split(',').map((s) => s.trim()).filter(Boolean)) {
      applyI18nAttr(el, key, item);
    }
  }
}

