import type { OverlayPlacement, ThemeMode, TrayLeftClickAction } from '../../shared/types';
import { normalizeOverlayOffsetFromUi } from '../../shared/overlayOffset';
import {
  DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX,
  normalizeMemoPadEditorFontSizePxFromUi
} from '../../shared/settingsConstraints';

type AppearancePreferencesElements = {
  memoPadEditorFontSize: HTMLInputElement;
  memoPadEditorFontSizeValue: HTMLDivElement;
  themeMode: HTMLSelectElement;
  accentColor: HTMLInputElement;
  accentColorReset: HTMLButtonElement;
  overlayPlacement: HTMLSelectElement;
  overlayOffsetX: HTMLInputElement;
  overlayOffsetY: HTMLInputElement;
  trayLeftClickAction: HTMLSelectElement;
  updateCheckEnabled: HTMLInputElement;
};

export type SetupAppearancePreferencesOptions = {
  els: AppearancePreferencesElements;
  applyAccentColor: (accentColor: string | null) => void;
  syncAccentColorControls: (accentColor: string | null) => void;
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

function normalizeMemoPadEditorFontSizePx(value: unknown): number {
  return normalizeMemoPadEditorFontSizePxFromUi(value);
}

function formatFontSizePx(value: number): string {
  return String(value);
}

async function applyMemoPadEditorFontSizePxFromUi(els: AppearancePreferencesElements, value: unknown): Promise<void> {
  const next = normalizeMemoPadEditorFontSizePx(value);
  const res = await window.voiceInput.setMemoPadEditorFontSizePx(next);
  if (!res.ok) return;
  els.memoPadEditorFontSize.value = String(next);
  els.memoPadEditorFontSizeValue.textContent = formatFontSizePx(next);
}

export function setupAppearancePreferences(opts: SetupAppearancePreferencesOptions): void {
  const { els, applyAccentColor, syncAccentColorControls } = opts;

  els.memoPadEditorFontSize.addEventListener('input', () => {
    els.memoPadEditorFontSizeValue.textContent = formatFontSizePx(
      normalizeMemoPadEditorFontSizePx(els.memoPadEditorFontSize.value)
    );
  });

  els.memoPadEditorFontSize.addEventListener(
    'change',
    voidAsync(async () => {
      await applyMemoPadEditorFontSizePxFromUi(els, els.memoPadEditorFontSize.value);
    })
  );

  els.memoPadEditorFontSizeValue.addEventListener(
    'dblclick',
    voidAsync(async () => {
      els.memoPadEditorFontSize.value = String(DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX);
      els.memoPadEditorFontSizeValue.textContent = formatFontSizePx(DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX);
      await applyMemoPadEditorFontSizePxFromUi(els, DEFAULT_MEMO_PAD_EDITOR_FONT_SIZE_PX);
    })
  );

  els.themeMode.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setThemeMode(els.themeMode.value as ThemeMode);
    })
  );

  els.accentColor.addEventListener(
    'change',
    voidAsync(async () => {
      const res = await window.voiceInput.setAccentColor(els.accentColor.value);
      if (!res.ok) {
        const settings = await window.voiceInput.getSettings();
        applyAccentColor(settings.accentColor);
        syncAccentColorControls(settings.accentColor);
      }
    })
  );

  els.accentColorReset.addEventListener(
    'click',
    voidAsync(async () => {
      const res = await window.voiceInput.setAccentColor(null);
      if (!res.ok) {
        const settings = await window.voiceInput.getSettings();
        applyAccentColor(settings.accentColor);
        syncAccentColorControls(settings.accentColor);
      }
    })
  );

  els.overlayPlacement.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setOverlayPlacement(els.overlayPlacement.value as OverlayPlacement);
    })
  );

  els.trayLeftClickAction.addEventListener(
    'change',
    voidAsync(async () => {
      const next = els.trayLeftClickAction.value as TrayLeftClickAction;
      const res = await window.voiceInput.setTrayLeftClickAction(next);
      if (!res.ok) {
        const settings = await window.voiceInput.getSettings();
        els.trayLeftClickAction.value = settings.trayLeftClickAction;
      }
    })
  );

  els.updateCheckEnabled.addEventListener(
    'change',
    voidAsync(async () => {
      await window.voiceInput.setUpdateCheckEnabled(els.updateCheckEnabled.checked);
    })
  );

  els.overlayOffsetX.addEventListener(
    'change',
    voidAsync(async () => {
      const next = normalizeOverlayOffsetFromUi(els.overlayOffsetX.value);
      const res = await window.voiceInput.setOverlayOffsetX(next);
      if (!res.ok) return;
      els.overlayOffsetX.value = String(next);
    })
  );

  els.overlayOffsetY.addEventListener(
    'change',
    voidAsync(async () => {
      const next = normalizeOverlayOffsetFromUi(els.overlayOffsetY.value);
      const res = await window.voiceInput.setOverlayOffsetY(next);
      if (!res.ok) return;
      els.overlayOffsetY.value = String(next);
    })
  );
}
