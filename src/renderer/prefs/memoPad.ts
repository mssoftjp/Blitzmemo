type MemoPadPreferencesElements = {
  autoPaste: HTMLInputElement;
  memoPadAutoMemo: HTMLInputElement;
  memoPadInsertAtCursor: HTMLInputElement;
  memoPadPersistText: HTMLInputElement;
  softStartOpenMemoPad: HTMLInputElement;
  softStartOpenHistory: HTMLInputElement;
};

export type SetupMemoPadPreferencesOptions = {
  els: MemoPadPreferencesElements;
  syncMemoPadInsertAtCursorAvailability: (autoMemoEnabled: boolean) => void;
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

export function setupMemoPadPreferences(opts: SetupMemoPadPreferencesOptions): void {
  const { els, syncMemoPadInsertAtCursorAvailability } = opts;

  els.autoPaste.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setAutoPaste(els.autoPaste.checked);
    })
  );

  els.memoPadAutoMemo.addEventListener(
    'change',
    voidAsync(async () => {
      syncMemoPadInsertAtCursorAvailability(els.memoPadAutoMemo.checked);
      await window.voiceInput.setMemoPadAutoMemo(els.memoPadAutoMemo.checked);
    })
  );

  els.memoPadInsertAtCursor.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setMemoPadInsertAtCursor(els.memoPadInsertAtCursor.checked);
    })
  );

  els.memoPadPersistText.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setMemoPadPersistText(els.memoPadPersistText.checked);
    })
  );

  els.softStartOpenMemoPad.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setSoftStartOpenMemoPad(els.softStartOpenMemoPad.checked);
    })
  );

  els.softStartOpenHistory.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setSoftStartOpenHistory(els.softStartOpenHistory.checked);
    })
  );
}

