import type { MemoPadButtonId } from '../../shared/types';

type MemoPadButtonsElements = {
  memoPadButtonsHidden: HTMLSelectElement;
  memoPadButtonsVisible: HTMLSelectElement;
  memoPadButtonsAdd: HTMLButtonElement;
  memoPadButtonsRemove: HTMLButtonElement;
  memoPadButtonsUp: HTMLButtonElement;
  memoPadButtonsDown: HTMLButtonElement;
  memoPadButtonsReset: HTMLButtonElement;
};

export type SetupMemoPadButtonsPreferencesOptions = {
  els: MemoPadButtonsElements;
  defaultMemoPadVisibleButtons: MemoPadButtonId[];
  getMemoPadVisibleButtons: () => MemoPadButtonId[];
  setMemoPadVisibleButtons: (buttons: MemoPadButtonId[]) => void;
  readSelectedMemoPadButtonIds: (select: HTMLSelectElement) => MemoPadButtonId[];
  setSelectedMemoPadButtonIds: (select: HTMLSelectElement, ids: MemoPadButtonId[]) => void;
  renderMemoPadButtonsEditor: () => void;
  updateMemoPadButtonsEditorControls: () => void;
  persistMemoPadVisibleButtons: () => Promise<void>;
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

function moveSelectedVisibleButtons(
  visibleButtons: MemoPadButtonId[],
  selected: Set<MemoPadButtonId>,
  direction: 'up' | 'down'
): MemoPadButtonId[] {
  if (selected.size === 0) return visibleButtons;
  const next = [...visibleButtons];
  if (direction === 'up') {
    for (let index = 1; index < next.length; index++) {
      if (!selected.has(next[index])) continue;
      if (selected.has(next[index - 1])) continue;
      const tmp = next[index - 1];
      next[index - 1] = next[index];
      next[index] = tmp;
    }
  } else {
    for (let index = next.length - 2; index >= 0; index--) {
      if (!selected.has(next[index])) continue;
      if (selected.has(next[index + 1])) continue;
      const tmp = next[index + 1];
      next[index + 1] = next[index];
      next[index] = tmp;
    }
  }
  return next;
}

export function setupMemoPadButtonsPreferences(opts: SetupMemoPadButtonsPreferencesOptions): void {
  const {
    els,
    defaultMemoPadVisibleButtons,
    getMemoPadVisibleButtons,
    setMemoPadVisibleButtons,
    readSelectedMemoPadButtonIds,
    setSelectedMemoPadButtonIds,
    renderMemoPadButtonsEditor,
    updateMemoPadButtonsEditorControls,
    persistMemoPadVisibleButtons
  } = opts;

  els.memoPadButtonsHidden.addEventListener('change', () => updateMemoPadButtonsEditorControls());
  els.memoPadButtonsVisible.addEventListener('change', () => updateMemoPadButtonsEditorControls());

  const showSelectedMemoButtons = voidAsync(async () => {
    const selected = readSelectedMemoPadButtonIds(els.memoPadButtonsHidden);
    if (selected.length === 0) return;
    setMemoPadVisibleButtons([...getMemoPadVisibleButtons(), ...selected]);
    renderMemoPadButtonsEditor();
    setSelectedMemoPadButtonIds(els.memoPadButtonsVisible, selected);
    updateMemoPadButtonsEditorControls();
    await persistMemoPadVisibleButtons();
  });

  const hideSelectedMemoButtons = voidAsync(async () => {
    const selected = readSelectedMemoPadButtonIds(els.memoPadButtonsVisible);
    if (selected.length === 0) return;
    const nextVisible = getMemoPadVisibleButtons().filter((id) => !selected.includes(id));
    setMemoPadVisibleButtons(nextVisible);
    renderMemoPadButtonsEditor();
    setSelectedMemoPadButtonIds(els.memoPadButtonsHidden, selected);
    updateMemoPadButtonsEditorControls();
    await persistMemoPadVisibleButtons();
  });

  els.memoPadButtonsAdd.addEventListener('click', () => showSelectedMemoButtons());
  els.memoPadButtonsRemove.addEventListener('click', () => hideSelectedMemoButtons());
  els.memoPadButtonsHidden.addEventListener('dblclick', () => showSelectedMemoButtons());
  els.memoPadButtonsVisible.addEventListener('dblclick', () => hideSelectedMemoButtons());

  els.memoPadButtonsUp.addEventListener(
    'click',
    voidAsync(async () => {
      const selected = readSelectedMemoPadButtonIds(els.memoPadButtonsVisible);
      const selectedSet = new Set(selected);
      setMemoPadVisibleButtons(moveSelectedVisibleButtons(getMemoPadVisibleButtons(), selectedSet, 'up'));
      renderMemoPadButtonsEditor();
      setSelectedMemoPadButtonIds(els.memoPadButtonsVisible, selected);
      updateMemoPadButtonsEditorControls();
      await persistMemoPadVisibleButtons();
    })
  );

  els.memoPadButtonsDown.addEventListener(
    'click',
    voidAsync(async () => {
      const selected = readSelectedMemoPadButtonIds(els.memoPadButtonsVisible);
      const selectedSet = new Set(selected);
      setMemoPadVisibleButtons(moveSelectedVisibleButtons(getMemoPadVisibleButtons(), selectedSet, 'down'));
      renderMemoPadButtonsEditor();
      setSelectedMemoPadButtonIds(els.memoPadButtonsVisible, selected);
      updateMemoPadButtonsEditorControls();
      await persistMemoPadVisibleButtons();
    })
  );

  els.memoPadButtonsReset.addEventListener(
    'click',
    voidAsync(async () => {
      setMemoPadVisibleButtons([...defaultMemoPadVisibleButtons]);
      renderMemoPadButtonsEditor();
      updateMemoPadButtonsEditorControls();
      await persistMemoPadVisibleButtons();
    })
  );
}

