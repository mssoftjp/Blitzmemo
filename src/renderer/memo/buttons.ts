import { MEMO_PAD_BUTTON_ORDER, type MemoPadButtonId } from '../../shared/types';
import type { UiStringKey } from '../../shared/i18n';

type MemoOverflowItemDefinition = {
  element: HTMLElement;
  getLabel: () => string;
  isEnabled: () => boolean;
  activate: () => void;
  getChecked?: () => boolean;
};

const MEMO_OVERFLOW_HIDDEN_CLASS = 'avi-memo-overflow-hidden';
const MEMO_PAD_BUTTON_ID_SET = new Set<MemoPadButtonId>(MEMO_PAD_BUTTON_ORDER);

type MemoButtonsElements = {
  memoButtons: HTMLDivElement;
  toggle: HTMLButtonElement;
  cancel: HTMLButtonElement;
  translate: HTMLButtonElement;
  cut: HTMLButtonElement;
  copy: HTMLButtonElement;
  clear: HTMLButtonElement;
  history: HTMLButtonElement;
  settings: HTMLButtonElement;
  overflow: HTMLButtonElement;
  overflowMenu: HTMLDivElement;
  autoPasteWrap: HTMLLabelElement;
  autoPaste: HTMLInputElement;
  autoMemoWrap: HTMLLabelElement;
  autoMemo: HTMLInputElement;
  insertAtCursorWrap: HTMLLabelElement;
  insertAtCursor: HTMLInputElement;
  pinWrap: HTMLLabelElement;
};

export type SetupMemoButtonsOptions = {
  els: MemoButtonsElements;
  tr: (key: UiStringKey, params?: Record<string, string | number>) => string;
  setupPointerClickButton: (button: HTMLButtonElement, onActivate: () => void) => void;
  toggleCheckboxInput: (input: HTMLInputElement) => void;
};

export type MemoButtonsApi = {
  scheduleMemoButtonsOverflowUpdate: () => void;
  applyMemoButtonLayout: (visibleButtons: unknown) => void;
  toggleMemoOverflowMenu: () => void;
  closeMemoOverflowMenu: (options?: { restoreFocus?: boolean }) => void;
  isMemoOverflowMenuOpen: () => boolean;
};

export function setupMemoButtons(opts: SetupMemoButtonsOptions): MemoButtonsApi {
  const els = opts.els;
  let memoOverflowUpdateTimer: number | null = null;
  let isMemoOverflowMenuOpen = false;
  let memoOverflowMenuRestoreFocusTarget: HTMLElement | null = null;

  const scheduleMemoButtonsOverflowUpdate = () => {
    if (memoOverflowUpdateTimer !== null) return;
    memoOverflowUpdateTimer = window.setTimeout(() => {
      memoOverflowUpdateTimer = null;
      updateMemoButtonsOverflow();
    }, 0);
  };

  const isMemoButtonsOverflowing = (): boolean => {
    return els.memoButtons.scrollWidth - els.memoButtons.clientWidth > 1;
  };

  const closeMemoOverflowMenu = (options: { restoreFocus?: boolean } = {}) => {
    if (!isMemoOverflowMenuOpen) return;
    isMemoOverflowMenuOpen = false;
    const restoreTarget = memoOverflowMenuRestoreFocusTarget;
    memoOverflowMenuRestoreFocusTarget = null;
    els.overflowMenu.classList.add('avi-hidden');
    els.overflowMenu.setAttribute('aria-hidden', 'true');
    els.overflow.setAttribute('aria-expanded', 'false');
    if (options.restoreFocus !== false) {
      if (restoreTarget?.isConnected && typeof restoreTarget.focus === 'function') {
        restoreTarget.focus({ preventScroll: true });
      } else {
        els.overflow.focus({ preventScroll: true });
      }
    }
  };

  const updateMemoButtonsOverflow = () => {
    closeMemoOverflowMenu({ restoreFocus: false });

    for (const child of Array.from(els.memoButtons.children)) {
      if (!(child instanceof HTMLElement)) continue;
      child.classList.remove(MEMO_OVERFLOW_HIDDEN_CLASS);
    }

    els.overflow.classList.add('avi-hidden');

    if (els.memoButtons.clientWidth <= 0) return;
    if (!isMemoButtonsOverflowing()) return;

    els.overflow.classList.remove('avi-hidden');

    const hideable = Array.from(els.memoButtons.children).filter((child): child is HTMLElement => {
      if (!(child instanceof HTMLElement)) return false;
      if (child === els.toggle) return false;
      if (child === els.pinWrap) return false;
      if (child === els.overflow) return false;
      if (child.classList.contains('avi-hidden')) return false;
      return true;
    });

    for (let i = hideable.length - 1; i >= 0; i--) {
      if (!isMemoButtonsOverflowing()) break;
      hideable[i].classList.add(MEMO_OVERFLOW_HIDDEN_CLASS);
    }

    const hasOverflowed = hideable.some((item) => item.classList.contains(MEMO_OVERFLOW_HIDDEN_CLASS));
    els.overflow.classList.toggle('avi-hidden', !hasOverflowed);
  };

  const getMemoOverflowItemDefinitions = (): MemoOverflowItemDefinition[] => {
    return [
      {
        element: els.cancel,
        getLabel: () => els.cancel.textContent?.trim() || opts.tr('common.cancel'),
        isEnabled: () => !els.cancel.disabled,
        activate: () => els.cancel.click()
      },
      {
        element: els.translate,
        getLabel: () => els.translate.textContent?.trim() || opts.tr('memo.translate'),
        isEnabled: () => !els.translate.disabled,
        activate: () => els.translate.click()
      },
      {
        element: els.cut,
        getLabel: () => els.cut.textContent?.trim() || opts.tr('common.cut'),
        isEnabled: () => !els.cut.disabled,
        activate: () => els.cut.click()
      },
      {
        element: els.copy,
        getLabel: () => els.copy.textContent?.trim() || opts.tr('common.copy'),
        isEnabled: () => !els.copy.disabled,
        activate: () => els.copy.click()
      },
      {
        element: els.clear,
        getLabel: () => els.clear.textContent?.trim() || opts.tr('common.clear'),
        isEnabled: () => !els.clear.disabled,
        activate: () => els.clear.click()
      },
      {
        element: els.history,
        getLabel: () => els.history.textContent?.trim() || opts.tr('history.title'),
        isEnabled: () => !els.history.disabled,
        activate: () => els.history.click()
      },
      {
        element: els.autoPasteWrap,
        getLabel: () => opts.tr('memo.autoPaste'),
        isEnabled: () => !els.autoPaste.disabled,
        activate: () => opts.toggleCheckboxInput(els.autoPaste),
        getChecked: () => els.autoPaste.checked
      },
      {
        element: els.autoMemoWrap,
        getLabel: () => opts.tr('memo.autoMemo'),
        isEnabled: () => !els.autoMemo.disabled,
        activate: () => opts.toggleCheckboxInput(els.autoMemo),
        getChecked: () => els.autoMemo.checked
      },
      {
        element: els.insertAtCursorWrap,
        getLabel: () => opts.tr('prefs.main.memoPadInsertAtCursor.label'),
        isEnabled: () => !els.insertAtCursor.disabled,
        activate: () => opts.toggleCheckboxInput(els.insertAtCursor),
        getChecked: () => els.insertAtCursor.checked
      },
      {
        element: els.settings,
        getLabel: () => opts.tr('common.settings'),
        isEnabled: () => !els.settings.disabled,
        activate: () => els.settings.click()
      }
    ];
  };

  const renderMemoOverflowMenu = () => {
    els.overflowMenu.replaceChildren();

    const defs = getMemoOverflowItemDefinitions()
      .filter((def) => def.element.classList.contains(MEMO_OVERFLOW_HIDDEN_CLASS))
      .sort((a, b) => {
        const pos = a.element.compareDocumentPosition(b.element);
        if (pos & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
        if (pos & Node.DOCUMENT_POSITION_PRECEDING) return 1;
        return 0;
      });

    for (const def of defs) {
      const item = document.createElement('button');
      item.type = 'button';
      item.className = 'avi-memo-overflow-item';
      item.textContent = def.getLabel();
      item.disabled = !def.isEnabled();
      item.setAttribute('role', def.getChecked ? 'menuitemcheckbox' : 'menuitem');
      if (def.getChecked) {
        const checked = def.getChecked();
        item.classList.add('avi-memo-overflow-item-checkbox');
        item.dataset.checked = checked ? 'true' : 'false';
        item.setAttribute('aria-checked', checked ? 'true' : 'false');
      }
      opts.setupPointerClickButton(item, () => {
        closeMemoOverflowMenu();
        def.activate();
        scheduleMemoButtonsOverflowUpdate();
      });
      els.overflowMenu.appendChild(item);
    }
  };

  const clampNumber = (value: number, min: number, max: number): number => {
    return Math.min(max, Math.max(min, value));
  };

  const positionMemoOverflowMenu = () => {
    if (els.overflowMenu.classList.contains('avi-hidden')) return;
    const buttonRect = els.overflow.getBoundingClientRect();
    const menuRect = els.overflowMenu.getBoundingClientRect();
    const margin = 8;
    const gap = 6;

    const maxLeft = Math.max(margin, window.innerWidth - menuRect.width - margin);
    let left = Math.round(buttonRect.right - menuRect.width);
    left = clampNumber(left, margin, maxLeft);

    let top = Math.round(buttonRect.bottom + gap);
    if (top + menuRect.height > window.innerHeight - margin) {
      const above = Math.round(buttonRect.top - gap - menuRect.height);
      if (above >= margin) top = above;
    }

    els.overflowMenu.style.left = `${left}px`;
    els.overflowMenu.style.top = `${top}px`;
  };

  const openMemoOverflowMenu = () => {
    if (isMemoOverflowMenuOpen) return;
    if (els.overflow.classList.contains('avi-hidden')) return;
    memoOverflowMenuRestoreFocusTarget = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const shouldFocusMenu =
      document.activeElement === els.overflow || (memoOverflowMenuRestoreFocusTarget === els.overflow && document.hasFocus());
    renderMemoOverflowMenu();
    if (!els.overflowMenu.firstElementChild) return;

    isMemoOverflowMenuOpen = true;
    els.overflowMenu.classList.remove('avi-hidden');
    els.overflowMenu.setAttribute('aria-hidden', 'false');
    els.overflow.setAttribute('aria-expanded', 'true');
    positionMemoOverflowMenu();
    if (shouldFocusMenu) {
      const firstItem = els.overflowMenu.querySelector<HTMLButtonElement>('button:not(:disabled)');
      firstItem?.focus({ preventScroll: true });
    }
  };

  const toggleMemoOverflowMenu = () => {
    if (isMemoOverflowMenuOpen) {
      closeMemoOverflowMenu();
      return;
    }
    openMemoOverflowMenu();
  };

  const normalizeMemoPadVisibleButtons = (value: unknown): MemoPadButtonId[] => {
    if (!Array.isArray(value)) return [...MEMO_PAD_BUTTON_ORDER];
    const next: MemoPadButtonId[] = [];
    for (const item of value) {
      if (typeof item !== 'string') continue;
      if (!MEMO_PAD_BUTTON_ID_SET.has(item as MemoPadButtonId)) continue;
      const id = item as MemoPadButtonId;
      if (next.includes(id)) continue;
      next.push(id);
    }
    return next;
  };

  const applyMemoButtonLayout = (visibleButtons: unknown) => {
    const ordered = normalizeMemoPadVisibleButtons(visibleButtons);
    const visibleSet = new Set(ordered);
    const map: Record<MemoPadButtonId, HTMLElement> = {
      toggle: els.toggle,
      cancel: els.cancel,
      translate: els.translate,
      cut: els.cut,
      copy: els.copy,
      clear: els.clear,
      history: els.history,
      autoPaste: els.autoPasteWrap,
      autoMemo: els.autoMemoWrap,
      insertAtCursor: els.insertAtCursorWrap,
      settings: els.settings
    };

    for (const id of MEMO_PAD_BUTTON_ORDER) {
      map[id].classList.toggle('avi-hidden', !visibleSet.has(id));
    }

    for (const id of ordered) {
      els.memoButtons.appendChild(map[id]);
    }
    for (const id of MEMO_PAD_BUTTON_ORDER) {
      if (visibleSet.has(id)) continue;
      els.memoButtons.appendChild(map[id]);
    }

    els.memoButtons.appendChild(els.overflow);
    els.memoButtons.appendChild(els.pinWrap);
    scheduleMemoButtonsOverflowUpdate();
  };

  return {
    scheduleMemoButtonsOverflowUpdate,
    applyMemoButtonLayout,
    toggleMemoOverflowMenu,
    closeMemoOverflowMenu,
    isMemoOverflowMenuOpen: () => isMemoOverflowMenuOpen
  };
}
