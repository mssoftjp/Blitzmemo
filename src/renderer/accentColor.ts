function clampByte(value: number): number | null {
  if (!Number.isFinite(value)) return null;
  const rounded = Math.round(value);
  if (rounded < 0 || rounded > 255) return null;
  return rounded;
}

function rgbTupleToHex([r, g, b]: [number, number, number]): string {
  const toHex = (value: number) => value.toString(16).padStart(2, '0');
  return `#${toHex(r)}${toHex(g)}${toHex(b)}`;
}

function parseRgbTuple(value: string): [number, number, number] | null {
  const match = value.match(/(\d+)\s*,\s*(\d+)\s*,\s*(\d+)/);
  if (!match) return null;
  const r = clampByte(Number.parseInt(match[1], 10));
  const g = clampByte(Number.parseInt(match[2], 10));
  const b = clampByte(Number.parseInt(match[3], 10));
  if (r === null || g === null || b === null) return null;
  return [r, g, b];
}

function normalizeAccentColor(value: unknown): string | null {
  if (value === null) return null;
  if (typeof value !== 'string') return null;
  const trimmed = value.trim();
  if (!trimmed) return null;
  const normalized = trimmed.toLowerCase();
  if (!/^#[0-9a-f]{6}$/.test(normalized)) return null;
  return normalized;
}

function hexToRgbTuple(value: string): [number, number, number] | null {
  const normalized = normalizeAccentColor(value);
  if (!normalized) return null;
  const r = clampByte(Number.parseInt(normalized.slice(1, 3), 16));
  const g = clampByte(Number.parseInt(normalized.slice(3, 5), 16));
  const b = clampByte(Number.parseInt(normalized.slice(5, 7), 16));
  if (r === null || g === null || b === null) return null;
  return [r, g, b];
}

export function applyAccentColor(color: string | null): void {
  const normalized = normalizeAccentColor(color);
  if (!normalized) {
    document.documentElement.style.removeProperty('--avi-accent-rgb');
    return;
  }
  const rgb = hexToRgbTuple(normalized);
  if (!rgb) {
    document.documentElement.style.removeProperty('--avi-accent-rgb');
    return;
  }
  document.documentElement.style.setProperty('--avi-accent-rgb', `${rgb[0]}, ${rgb[1]}, ${rgb[2]}`);
}

export function getComputedAccentColorHex(): string | null {
  const rgb = getComputedStyle(document.documentElement).getPropertyValue('--avi-accent-rgb');
  const tuple = parseRgbTuple(rgb);
  if (!tuple) return null;
  return rgbTupleToHex(tuple);
}

