type MemoFindReplaceElements = {
  text: HTMLTextAreaElement;
  findBar: HTMLDivElement;
  findQuery: HTMLInputElement;
  findPrev: HTMLButtonElement;
  findNext: HTMLButtonElement;
  findClose: HTMLButtonElement;
  replaceRow: HTMLDivElement;
  replaceText: HTMLInputElement;
  replaceOne: HTMLButtonElement;
  replaceAll: HTMLButtonElement;
  findStatus: HTMLDivElement;
};

export type SetupMemoFindReplaceOptions = {
  els: MemoFindReplaceElements;
  getLastKnownSelectionRange: () => { start: number; end: number } | null;
  getGutterLineEndOffsets: () => number[];
  updateLineNumbers: () => void;
  syncGutterScroll: () => void;
  syncLastKnownCursorAndScroll: () => void;
  afterTextMutated: () => void;
};

export type MemoFindReplaceApi = {
  openFindBar: (mode: 'find' | 'replace', seed?: string) => void;
  closeFindBar: () => void;
};

function normalizeFindSeed(value: string): string {
  return String(value ?? '').replace(/\r?\n/g, ' ').trim();
}

function voidSync(fn: () => void): () => void {
  return () => {
    try {
      fn();
    } catch (error) {
      console.error(error);
    }
  };
}

function voidSyncEvent<TEvent extends Event>(fn: (event: TEvent) => void): (event: TEvent) => void {
  return (event) => {
    try {
      fn(event);
    } catch (error) {
      console.error(error);
    }
  };
}

export function setupMemoFindReplace(opts: SetupMemoFindReplaceOptions): MemoFindReplaceApi {
  const els = opts.els;

  const setFindStatus = (message: string) => {
    els.findStatus.textContent = message;
  };

  const setFindBarMode = (mode: 'find' | 'replace') => {
    els.replaceRow.classList.toggle('avi-hidden', mode !== 'replace');
  };

  const getMemoSelectionSeed = (): string => {
    const fallback = opts.getLastKnownSelectionRange();
    const selectionStart = typeof els.text.selectionStart === 'number' ? els.text.selectionStart : fallback?.start ?? 0;
    const selectionEnd = typeof els.text.selectionEnd === 'number' ? els.text.selectionEnd : fallback?.end ?? 0;
    if (selectionStart === selectionEnd) return '';
    return normalizeFindSeed(els.text.value.slice(selectionStart, selectionEnd));
  };

  const openFindBar = (mode: 'find' | 'replace', seed?: string) => {
    setFindBarMode(mode);
    els.findBar.classList.remove('avi-hidden');
    setFindStatus('');

    const nextSeed = typeof seed === 'string' ? normalizeFindSeed(seed) : '';
    if (nextSeed) {
      els.findQuery.value = nextSeed;
    } else if (!els.findQuery.value) {
      const selectionSeed = getMemoSelectionSeed();
      if (selectionSeed) els.findQuery.value = selectionSeed;
    }

    if (mode === 'replace' && els.findQuery.value) {
      els.replaceText.focus();
      els.replaceText.select();
    } else {
      els.findQuery.focus();
      els.findQuery.select();
    }
  };

  const closeFindBar = () => {
    els.findBar.classList.add('avi-hidden');
    setFindStatus('');
    els.text.focus();
  };

  const getLineNumberAtIndex = (text: string, index: number) => {
    let line = 1;
    const limit = Math.max(0, Math.min(text.length, index));
    for (let i = 0; i < limit; i++) {
      if (text.charCodeAt(i) === 10) line += 1;
    }
    return line;
  };

  const revealMemoIndex = (index: number) => {
    const text = els.text.value;
    const lineNumber = getLineNumberAtIndex(text, index);
    const ends = opts.getGutterLineEndOffsets();
    if (ends.length <= lineNumber) {
      opts.updateLineNumbers();
    }
    const offsets = opts.getGutterLineEndOffsets();
    const top = offsets[lineNumber - 1] ?? 0;
    const bottom = offsets[lineNumber] ?? top;
    const viewTop = els.text.scrollTop;
    const viewBottom = viewTop + els.text.clientHeight;
    const margin = 22;
    if (top < viewTop + margin) {
      els.text.scrollTop = Math.max(0, top - margin);
    } else if (bottom > viewBottom - margin) {
      els.text.scrollTop = Math.max(0, bottom - (els.text.clientHeight - margin));
    }
    opts.syncGutterScroll();
  };

  const selectFindMatch = (start: number, length: number) => {
    const end = start + length;
    els.text.setSelectionRange(start, end);
    revealMemoIndex(start);
    opts.syncLastKnownCursorAndScroll();
    els.text.focus();
  };

  const getFindStartIndex = () => {
    if (typeof els.text.selectionEnd === 'number') return els.text.selectionEnd;
    const fallback = opts.getLastKnownSelectionRange();
    if (fallback) return fallback.end;
    return 0;
  };

  const getFindPrevStartIndex = () => {
    const fallback = opts.getLastKnownSelectionRange();
    const raw = typeof els.text.selectionStart === 'number' ? els.text.selectionStart : fallback?.start ?? 0;
    return Math.max(0, raw - 1);
  };

  const findNextMatch = () => {
    const query = els.findQuery.value;
    if (!query) {
      setFindStatus('Find is empty.');
      return;
    }

    const text = els.text.value;
    const startIndex = getFindStartIndex();
    let index = text.indexOf(query, startIndex);
    let wrapped = false;
    if (index === -1 && text.length > 0) {
      index = text.indexOf(query, 0);
      wrapped = index !== -1;
    }
    if (index === -1) {
      setFindStatus('Not found.');
      return;
    }
    setFindStatus(wrapped ? 'Wrapped.' : '');
    selectFindMatch(index, query.length);
  };

  const findPrevMatch = () => {
    const query = els.findQuery.value;
    if (!query) {
      setFindStatus('Find is empty.');
      return;
    }

    const text = els.text.value;
    const startIndex = getFindPrevStartIndex();
    let index = text.lastIndexOf(query, startIndex);
    let wrapped = false;
    if (index === -1 && text.length > 0) {
      index = text.lastIndexOf(query);
      wrapped = index !== -1;
    }
    if (index === -1) {
      setFindStatus('Not found.');
      return;
    }
    setFindStatus(wrapped ? 'Wrapped.' : '');
    selectFindMatch(index, query.length);
  };

	  const getReplaceSelectionRange = (): { start: number; end: number } | null => {
	    const selectionStart = els.text.selectionStart;
	    const selectionEnd = els.text.selectionEnd;
	    if (typeof selectionStart === 'number' && typeof selectionEnd === 'number') {
	      if (selectionStart === selectionEnd) return null;
	      return { start: selectionStart, end: selectionEnd };
	    }
	    const fallback = opts.getLastKnownSelectionRange();
	    if (!fallback) return null;
	    if (fallback.start === fallback.end) return null;
	    return fallback;
	  };

  const replaceCurrentMatch = () => {
    const query = els.findQuery.value;
    if (!query) {
      setFindStatus('Find is empty.');
      return;
    }

    const range = getReplaceSelectionRange();
    if (!range) {
      setFindStatus('No active match.');
      return;
    }

    const text = els.text.value;
    const selected = text.slice(range.start, range.end);
    if (selected !== query) {
      setFindStatus('Selection does not match.');
      return;
    }

    opts.syncLastKnownCursorAndScroll();
    if (typeof els.text.setRangeText === 'function') {
      els.text.setRangeText(els.replaceText.value, range.start, range.end, 'end');
    } else {
      const next = `${text.slice(0, range.start)}${els.replaceText.value}${text.slice(range.end)}`;
      els.text.value = next;
      const caret = range.start + els.replaceText.value.length;
      els.text.setSelectionRange(caret, caret);
    }

    opts.afterTextMutated();
    findNextMatch();
  };

  const replaceAllMatches = () => {
    const query = els.findQuery.value;
    if (!query) {
      setFindStatus('Find is empty.');
      return;
    }

    const before = els.text.value;
    const parts = before.split(query);
    if (parts.length <= 1) {
      setFindStatus('Not found.');
      return;
    }

    const next = parts.join(els.replaceText.value);
    if (next === before) {
      setFindStatus('No changes.');
      return;
    }

    opts.syncLastKnownCursorAndScroll();
    const beforeScrollTop = els.text.scrollTop;
    els.text.value = next;
    els.text.scrollTop = beforeScrollTop;
    opts.afterTextMutated();
    setFindStatus(`Replaced ${parts.length - 1}.`);
  };

  els.findClose.addEventListener('click', voidSync(closeFindBar));
  els.findNext.addEventListener('click', voidSync(findNextMatch));
  els.findPrev.addEventListener('click', voidSync(findPrevMatch));
  els.replaceOne.addEventListener('click', voidSync(replaceCurrentMatch));
  els.replaceAll.addEventListener('click', voidSync(replaceAllMatches));

  els.findQuery.addEventListener('input', voidSyncEvent(() => setFindStatus('')));
  els.replaceText.addEventListener('input', voidSyncEvent(() => setFindStatus('')));

  els.findQuery.addEventListener('keydown', voidSyncEvent((event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      if (event.shiftKey) {
        findPrevMatch();
      } else {
        findNextMatch();
      }
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFindBar();
    }
  }));

  els.replaceText.addEventListener('keydown', voidSyncEvent((event: KeyboardEvent) => {
    if (event.key === 'Enter') {
      event.preventDefault();
      replaceCurrentMatch();
      return;
    }
    if (event.key === 'Escape') {
      event.preventDefault();
      closeFindBar();
    }
  }));

  return { openFindBar, closeFindBar };
}
