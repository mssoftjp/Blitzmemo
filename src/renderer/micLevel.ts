export function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

const DEFAULT_MAX_SCALE = 2;

export function applyMicLevelToDot(
  dot: HTMLElement | null,
  level: number,
  options?: { active?: boolean; maxScale?: number }
): void {
  if (!dot) return;
  const clamped = clamp01(level);
  const active = options?.active ?? true;
  if (!active || clamped <= 0) {
    dot.style.removeProperty('transform');
    dot.style.removeProperty('box-shadow');
    return;
  }

  const rawMaxScale = options?.maxScale ?? DEFAULT_MAX_SCALE;
  const maxScale = Number.isFinite(rawMaxScale) ? Math.max(1, rawMaxScale) : DEFAULT_MAX_SCALE;

  dot.style.setProperty('transform', `scale(${(1 + clamped * (maxScale - 1)).toFixed(3)})`);
}
