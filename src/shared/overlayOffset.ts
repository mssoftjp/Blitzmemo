export const MIN_OVERLAY_OFFSET = -4000;
export const MAX_OVERLAY_OFFSET = 4000;

export function normalizeOverlayOffsetFromSettings(value: unknown): number | null {
  if (typeof value !== 'number' || !Number.isFinite(value)) return null;
  return Math.max(MIN_OVERLAY_OFFSET, Math.min(MAX_OVERLAY_OFFSET, Math.floor(value)));
}

export function normalizeOverlayOffsetFromUi(value: unknown): number {
  const normalized = typeof value === 'string' || typeof value === 'number' ? Number(value) : NaN;
  if (!Number.isFinite(normalized)) return 0;
  return Math.max(MIN_OVERLAY_OFFSET, Math.min(MAX_OVERLAY_OFFSET, Math.floor(normalized)));
}

