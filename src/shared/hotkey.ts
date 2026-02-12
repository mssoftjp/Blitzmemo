export const PUSH_TO_TALK_THRESHOLD_MS = 300;
export const PUSH_TO_TALK_RESET_DELAY_MS = 100;

// user-note: These shortcuts are fixed (not user-configurable) to avoid layout differences (JIS/US) and reduce complexity.
export const FIXED_CANCEL_HOTKEY = 'Escape';
export const FIXED_MEMO_FIND_HOTKEY = 'CommandOrControl+F';
export const FIXED_MEMO_REPLACE_HOTKEY = 'CommandOrControl+H';

const ALLOWED_CONFIGURABLE_HOTKEY_KEYS = new Set([
  'space',
  'enter',
  'return',
  'tab',
  'up',
  'down',
  'left',
  'right'
]);

function isAllowedConfigurableHotkeyKey(key: string): boolean {
  const trimmed = key.trim();
  if (!trimmed) return false;
  const lower = trimmed.toLowerCase();
  if (lower === 'escape' || lower === 'esc') return false;
  if (ALLOWED_CONFIGURABLE_HOTKEY_KEYS.has(lower)) return true;
  if (/^f\d{1,2}$/i.test(trimmed)) {
    const n = Number.parseInt(trimmed.slice(1), 10);
    return Number.isFinite(n) && n >= 1 && n <= 24;
  }
  if (/^[a-z]$/i.test(trimmed)) return true;
  if (/^[0-9]$/.test(trimmed)) return true;
  return false;
}

// user-note: Only allow layout-independent keys for user-configurable shortcuts (e.g. avoid +/- differences between JIS/US).
export function isUserConfigurableHotkeyAccelerator(accelerator: string): boolean {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return false;

  const parts = normalized
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length < 2) return false;

  const key = parts[parts.length - 1] ?? '';
  if (!isAllowedConfigurableHotkeyKey(key)) return false;

  let hasPrimaryModifier = false;
  for (const part of parts.slice(0, -1)) {
    const lower = part.toLowerCase();
    if (lower === 'commandorcontrol') {
      hasPrimaryModifier = true;
      continue;
    }
    if (lower === 'command' || lower === 'cmd') {
      hasPrimaryModifier = true;
      continue;
    }
    if (lower === 'control' || lower === 'ctrl') {
      hasPrimaryModifier = true;
      continue;
    }
    if (lower === 'alt' || lower === 'option') {
      hasPrimaryModifier = true;
      continue;
    }
    if (lower === 'shift') {
      continue;
    }
    return false;
  }

  return hasPrimaryModifier;
}

function normalizeAcceleratorForComparison(accelerator: string): string {
  const parts = normalizeAccelerator(accelerator)
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return '';

  const keyRaw = parts[parts.length - 1] ?? '';
  const modsRaw = parts.slice(0, -1);

  const mods = modsRaw
    .map((part) => {
      const lower = part.toLowerCase();
      if (lower === 'commandorcontrol' || lower === 'command' || lower === 'cmd' || lower === 'control' || lower === 'ctrl') {
        return 'commandorcontrol';
      }
      if (lower === 'alt' || lower === 'option') return 'alt';
      if (lower === 'shift') return 'shift';
      return lower;
    })
    .filter(Boolean)
    .sort();

  let key = keyRaw.trim();
  const keyLower = key.toLowerCase();
  if (keyLower === 'esc') key = 'escape';
  if (keyLower === 'return') key = 'enter';
  if (keyLower === 'arrowup') key = 'up';
  if (keyLower === 'arrowdown') key = 'down';
  if (keyLower === 'arrowleft') key = 'left';
  if (keyLower === 'arrowright') key = 'right';

  return [...mods, key.toLowerCase()].filter(Boolean).join('+');
}

// user-note: Prevent user-configurable shortcuts from conflicting with built-in app shortcuts.
export function isHotkeyConflictingWithFixedShortcuts(accelerator: string): boolean {
  const normalized = normalizeAccelerator(accelerator);
  if (!normalized) return false;
  const target = normalizeAcceleratorForComparison(normalized);
  if (!target) return false;
  const reserved = new Set([
    normalizeAcceleratorForComparison(FIXED_MEMO_FIND_HOTKEY),
    normalizeAcceleratorForComparison(FIXED_MEMO_REPLACE_HOTKEY)
  ]);
  return reserved.has(target);
}

export function normalizeAccelerator(accelerator: string): string {
  return accelerator
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean)
    .join('+');
}

export function getAcceleratorKey(accelerator: string): string | null {
  const parts = normalizeAccelerator(accelerator)
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);
  if (parts.length === 0) return null;
  return parts[parts.length - 1] ?? null;
}

export function acceleratorKeyMatchesEvent(event: KeyboardEvent, key: string): boolean {
  if (key === 'Space') return event.code === 'Space' || event.key === ' ';
  if (key === 'Enter') return event.key === 'Enter' || event.key === 'Return';
  if (key === 'Tab') return event.key === 'Tab';
  if (key === 'Escape' || key === 'Esc') return event.key === 'Escape';
  if (key === 'Plus') return event.code === 'Equal' || event.key === '+' || event.key === '=';
  if (key === 'Minus') return event.code === 'Minus' || event.key === '-' || event.key === '_';
  if (key === 'Up') return event.key === 'ArrowUp' || event.code === 'ArrowUp';
  if (key === 'Down') return event.key === 'ArrowDown' || event.code === 'ArrowDown';
  if (key === 'Left') return event.key === 'ArrowLeft' || event.code === 'ArrowLeft';
  if (key === 'Right') return event.key === 'ArrowRight' || event.code === 'ArrowRight';
  if (/^F\d{1,2}$/.test(key)) return event.key.toUpperCase() === key;
  if (/^[A-Z]$/.test(key)) return event.code === `Key${key}`;
  if (/^[0-9]$/.test(key)) return event.code === `Digit${key}`;
  if (key.length === 1) return event.key.toUpperCase() === key.toUpperCase();
  return false;
}

export function keyEventToAccelerator(event: KeyboardEvent): string | null {
  if (event.key === 'Escape') return 'Escape';
  if (event.key === 'Shift' || event.key === 'Control' || event.key === 'Alt' || event.key === 'Meta') {
    return null;
  }

  const parts: string[] = [];
  if (event.metaKey || event.ctrlKey) parts.push('CommandOrControl');
  if (event.altKey) parts.push('Alt');

  if (parts.length === 0) return null;

  let key: string | null = null;
  const code = event.code;

  // user-note: Treat + and - as standalone keys for shortcut capture, even when Shift is pressed (+ requires Shift).
  // This keeps the stored accelerator stable (e.g. "CommandOrControl+Plus" instead of "CommandOrControl+Shift+...").
  if (code === 'Equal') key = 'Plus';
  else if (code === 'Minus') key = 'Minus';
  else if (code === 'Space' || event.key === ' ') key = 'Space';
  else if (event.key === 'Enter') key = 'Enter';
  else if (event.key === 'Tab') key = 'Tab';
  else if (/^F\d{1,2}$/.test(event.key)) key = event.key.toUpperCase();
  else if (code.startsWith('Key') && code.length === 4) key = code.slice(3);
  else if (code.startsWith('Digit') && code.length === 6) key = code.slice(5);
  else if (event.key.length === 1 && /[a-z0-9]/i.test(event.key)) key = event.key.toUpperCase();
  else if (event.key === 'ArrowUp') key = 'Up';
  else if (event.key === 'ArrowDown') key = 'Down';
  else if (event.key === 'ArrowLeft') key = 'Left';
  else if (event.key === 'ArrowRight') key = 'Right';

  if (!key) return null;
  if (event.shiftKey && key !== 'Plus' && key !== 'Minus') parts.push('Shift');
  return [...parts, key].join('+');
}

function formatHotkeyKey(value: string): string {
  const key = value.trim();
  if (!key) return '';
  if (key === 'Escape' || key === 'Esc') return 'Esc';
  if (key === 'Space') return 'Space';
  if (key === 'Enter' || key === 'Return') return 'Enter';
  if (key === 'Plus') return '+';
  if (key === 'Minus') return '-';
  if (key === 'Up') return '↑';
  if (key === 'Down') return '↓';
  if (key === 'Left') return '←';
  if (key === 'Right') return '→';
  if (key.length === 1) return key.toUpperCase();
  return key;
}

export function getAcceleratorKeycaps(accelerator: string, platform: string): string[] {
  const parts = normalizeAccelerator(accelerator)
    .split('+')
    .map((p) => p.trim())
    .filter(Boolean);

  let cmdOrCtrl = false;
  let command = false;
  let control = false;
  let alt = false;
  let shift = false;
  let key: string | null = null;

  for (const part of parts) {
    const lower = part.toLowerCase();
    if (lower === 'commandorcontrol') {
      cmdOrCtrl = true;
      continue;
    }
    if (lower === 'command' || lower === 'cmd') {
      command = true;
      continue;
    }
    if (lower === 'control' || lower === 'ctrl') {
      control = true;
      continue;
    }
    if (lower === 'alt' || lower === 'option') {
      alt = true;
      continue;
    }
    if (lower === 'shift') {
      shift = true;
      continue;
    }
    key = part;
  }

  const isMac = platform === 'darwin';
  const keycaps: string[] = [];

  if (cmdOrCtrl) {
    keycaps.push(isMac ? '⌘' : 'Ctrl');
  } else if (command) {
    keycaps.push(isMac ? '⌘' : 'Cmd');
  } else if (control) {
    keycaps.push(isMac ? '⌃' : 'Ctrl');
  }

  if (alt) keycaps.push(isMac ? '⌥' : 'Alt');
  if (shift) keycaps.push(isMac ? '⇧' : 'Shift');
  if (key) keycaps.push(formatHotkeyKey(key));

  return keycaps;
}

export function formatAcceleratorForDisplay(accelerator: string, platform: string): string {
  const keycaps = getAcceleratorKeycaps(accelerator, platform);
  if (keycaps.length <= 1) return keycaps.join('+');
  const last = keycaps[keycaps.length - 1];
  if (last === '+' || last === '-') {
    return `${keycaps.slice(0, -1).join('+')}${last}`;
  }
  return keycaps.join('+');
}
