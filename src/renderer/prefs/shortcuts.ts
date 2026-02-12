type ShortcutPreferencesElements = {
  changeHotkey: HTMLButtonElement;
  resetHotkey: HTMLButtonElement;
};

export type SetupShortcutPreferencesOptions = {
  els: ShortcutPreferencesElements;
  defaultHotkey: string;
  startHotkeyCapture: () => void;
  stopHotkeyCapture: () => void;
  applyHotkey: (accelerator: string) => Promise<void>;
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

export function setupShortcutPreferences(opts: SetupShortcutPreferencesOptions): void {
  const {
    els,
    defaultHotkey,
    startHotkeyCapture,
    stopHotkeyCapture,
    applyHotkey
  } = opts;

  els.changeHotkey.addEventListener('click', () => {
    startHotkeyCapture();
  });

  els.resetHotkey.addEventListener(
    'click',
    voidAsync(async () => {
      stopHotkeyCapture();
      await applyHotkey(defaultHotkey);
    })
  );
}
