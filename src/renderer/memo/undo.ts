type MemoTextState = {
  value: string;
  selectionStart: number;
  selectionEnd: number;
  scrollTop: number;
};

type MemoTextEdit = {
  start: number;
  removed: string;
  inserted: string;
  beforeSelectionStart: number;
  beforeSelectionEnd: number;
  afterSelectionStart: number;
  afterSelectionEnd: number;
  beforeScrollTop: number;
  afterScrollTop: number;
};

const DEFAULT_MEMO_PAD_UNDO_MAX_STEPS = 500;
const MAX_MEMO_PAD_UNDO_MAX_STEPS = 5000;

export type SetupMemoUndoOptions = {
  text: HTMLTextAreaElement;
  getMemoTextState: () => MemoTextState;
  getLastKnownTextState: () => MemoTextState | null;
  setLastKnownTextState: (state: MemoTextState | null) => void;
  afterUndoRedo: () => void;
};

export type MemoUndoApi = {
  setMemoPadUndoMaxSteps: (next: number) => void;
  resetMemoUndoHistory: () => void;
  beforeDispatchTextInputEvent: () => void;
  handleBeforeInput: (event: InputEvent) => void;
  handleKeyDown: (event: KeyboardEvent) => void;
  handleTextInput: () => void;
  applyUndo: () => void;
  applyRedo: () => void;
};

function computeTextDiff(before: string, after: string): { start: number; removed: string; inserted: string } | null {
  if (before === after) return null;

  let start = 0;
  const beforeLen = before.length;
  const afterLen = after.length;
  const minLen = Math.min(beforeLen, afterLen);
  while (start < minLen && before.charCodeAt(start) === after.charCodeAt(start)) {
    start++;
  }

  let beforeEnd = beforeLen;
  let afterEnd = afterLen;
  while (beforeEnd > start && afterEnd > start && before.charCodeAt(beforeEnd - 1) === after.charCodeAt(afterEnd - 1)) {
    beforeEnd--;
    afterEnd--;
  }

  return {
    start,
    removed: before.slice(start, beforeEnd),
    inserted: after.slice(start, afterEnd)
  };
}

function clampSelectionIndex(value: number, max: number): number {
  const normalized = Number.isFinite(value) ? Math.floor(value) : 0;
  return Math.max(0, Math.min(max, normalized));
}

export function setupMemoUndo(opts: SetupMemoUndoOptions): MemoUndoApi {
  let memoPadUndoMaxSteps = DEFAULT_MEMO_PAD_UNDO_MAX_STEPS;
  let isApplyingUndoRedo = false;
  let undoStack: MemoTextEdit[] = [];
  let redoStack: MemoTextEdit[] = [];
  let pendingBeforeInputState: MemoTextState | null = null;

  const setMemoPadUndoMaxSteps = (next: number): void => {
    const normalized = Number.isFinite(next) ? Math.floor(next) : DEFAULT_MEMO_PAD_UNDO_MAX_STEPS;
    memoPadUndoMaxSteps = Math.max(0, Math.min(MAX_MEMO_PAD_UNDO_MAX_STEPS, normalized));
    if (memoPadUndoMaxSteps === 0) {
      undoStack = [];
      redoStack = [];
      pendingBeforeInputState = null;
      return;
    }

    if (undoStack.length > memoPadUndoMaxSteps) {
      undoStack = undoStack.slice(-memoPadUndoMaxSteps);
    }
  };

  const resetMemoUndoHistory = (): void => {
    undoStack = [];
    redoStack = [];
    pendingBeforeInputState = null;
    opts.setLastKnownTextState(opts.getMemoTextState());
  };

  const recordUndoEdit = (before: MemoTextState, after: MemoTextState): void => {
    if (memoPadUndoMaxSteps <= 0) {
      opts.setLastKnownTextState(after);
      pendingBeforeInputState = null;
      return;
    }

    const diff = computeTextDiff(before.value, after.value);
    if (!diff) {
      opts.setLastKnownTextState(after);
      pendingBeforeInputState = null;
      return;
    }

    const edit: MemoTextEdit = {
      start: diff.start,
      removed: diff.removed,
      inserted: diff.inserted,
      beforeSelectionStart: before.selectionStart,
      beforeSelectionEnd: before.selectionEnd,
      afterSelectionStart: after.selectionStart,
      afterSelectionEnd: after.selectionEnd,
      beforeScrollTop: before.scrollTop,
      afterScrollTop: after.scrollTop
    };

    undoStack.push(edit);
    if (undoStack.length > memoPadUndoMaxSteps) {
      undoStack = undoStack.slice(-memoPadUndoMaxSteps);
    }
    redoStack = [];
    opts.setLastKnownTextState(after);
    pendingBeforeInputState = null;
  };

  const applyUndo = (): void => {
    if (memoPadUndoMaxSteps <= 0) return;
    if (undoStack.length === 0) return;

    const edit = undoStack.pop();
    if (!edit) return;

    const current = opts.getMemoTextState();
    const start = Math.max(0, Math.min(current.value.length, edit.start));
    const expected = current.value.slice(start, start + edit.inserted.length);
    if (expected !== edit.inserted) {
      resetMemoUndoHistory();
      return;
    }

    const nextValue = `${current.value.slice(0, start)}${edit.removed}${current.value.slice(start + edit.inserted.length)}`;
    redoStack.push(edit);

    isApplyingUndoRedo = true;
    opts.text.value = nextValue;
    const maxSel = nextValue.length;
    opts.text.setSelectionRange(
      clampSelectionIndex(edit.beforeSelectionStart, maxSel),
      clampSelectionIndex(edit.beforeSelectionEnd, maxSel)
    );
    opts.text.scrollTop = edit.beforeScrollTop;
    isApplyingUndoRedo = false;
    opts.setLastKnownTextState(opts.getMemoTextState());
    opts.afterUndoRedo();
  };

  const applyRedo = (): void => {
    if (memoPadUndoMaxSteps <= 0) return;
    if (redoStack.length === 0) return;

    const edit = redoStack.pop();
    if (!edit) return;

    const current = opts.getMemoTextState();
    const start = Math.max(0, Math.min(current.value.length, edit.start));
    const expected = current.value.slice(start, start + edit.removed.length);
    if (expected !== edit.removed) {
      resetMemoUndoHistory();
      return;
    }

    const nextValue = `${current.value.slice(0, start)}${edit.inserted}${current.value.slice(start + edit.removed.length)}`;
    undoStack.push(edit);
    if (undoStack.length > memoPadUndoMaxSteps) {
      undoStack = undoStack.slice(-memoPadUndoMaxSteps);
    }

    isApplyingUndoRedo = true;
    opts.text.value = nextValue;
    const maxSel = nextValue.length;
    opts.text.setSelectionRange(
      clampSelectionIndex(edit.afterSelectionStart, maxSel),
      clampSelectionIndex(edit.afterSelectionEnd, maxSel)
    );
    opts.text.scrollTop = edit.afterScrollTop;
    isApplyingUndoRedo = false;
    opts.setLastKnownTextState(opts.getMemoTextState());
    opts.afterUndoRedo();
  };

  const beforeDispatchTextInputEvent = (): void => {
    pendingBeforeInputState = null;
  };

  const handleBeforeInput = (event: InputEvent): void => {
    if (isApplyingUndoRedo) return;
    if (memoPadUndoMaxSteps <= 0) return;

    if (event.inputType === 'historyUndo') {
      if (undoStack.length === 0) return;
      event.preventDefault();
      applyUndo();
      return;
    }

    if (event.inputType === 'historyRedo') {
      if (redoStack.length === 0) return;
      event.preventDefault();
      applyRedo();
      return;
    }

    pendingBeforeInputState = opts.getMemoTextState();
  };

  const handleKeyDown = (event: KeyboardEvent): void => {
    if (event.isComposing) return;
    if (memoPadUndoMaxSteps <= 0) return;
    if (!event.metaKey && !event.ctrlKey) return;

    const key = event.key.toLowerCase();
    if (key === 'z') {
      if (event.shiftKey) {
        if (redoStack.length === 0) return;
        event.preventDefault();
        applyRedo();
        return;
      }
      if (undoStack.length === 0) return;
      event.preventDefault();
      applyUndo();
      return;
    }

    if (key === 'y' && !event.shiftKey) {
      if (redoStack.length === 0) return;
      event.preventDefault();
      applyRedo();
    }
  };

  const handleTextInput = (): void => {
    if (!isApplyingUndoRedo) {
      const after = opts.getMemoTextState();
      const before = pendingBeforeInputState ?? opts.getLastKnownTextState();
      if (before) {
        recordUndoEdit(before, after);
      } else {
        opts.setLastKnownTextState(after);
        pendingBeforeInputState = null;
      }
      return;
    }

    pendingBeforeInputState = null;
    opts.setLastKnownTextState(opts.getMemoTextState());
  };

  return {
    setMemoPadUndoMaxSteps,
    resetMemoUndoHistory,
    beforeDispatchTextInputEvent,
    handleBeforeInput,
    handleKeyDown,
    handleTextInput,
    applyUndo,
    applyRedo
  };
}
