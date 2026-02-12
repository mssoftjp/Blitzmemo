import { DEFAULT_SILENCE_AUTO_STOP_SECONDS, normalizeKeyboardCharsPerMinuteFromUi } from '../../shared/settingsConstraints';

type RecordingPreferencesElements = {
  recordingMaxSeconds: HTMLInputElement;
  recordingMaxSecondsValue: HTMLDivElement;
  keyboardCharsPerMinute: HTMLInputElement;
  silenceAutoStopSeconds: HTMLInputElement;
  silenceAutoStopSecondsValue: HTMLDivElement;
};

export type SetupRecordingPreferencesOptions = {
  els: RecordingPreferencesElements;
  defaultRecordingMaxSeconds: number;
  getActivePage: () => string;
  refreshStats: () => Promise<void>;
  normalizeRecordingMaxSeconds: (value: unknown) => number;
  applyRecordingMaxSecondsFromUi: (value: unknown) => Promise<void>;
  applySilenceAutoStopSecondsFromUi: (value: unknown) => Promise<void>;
  setKeyboardCharsPerMinute: (value: number) => void;
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

export function setupRecordingPreferences(opts: SetupRecordingPreferencesOptions): void {
  const {
    els,
    defaultRecordingMaxSeconds,
    getActivePage,
    refreshStats,
    normalizeRecordingMaxSeconds,
    applyRecordingMaxSecondsFromUi,
    applySilenceAutoStopSecondsFromUi,
    setKeyboardCharsPerMinute
  } = opts;

  els.recordingMaxSeconds.addEventListener('input', () => {
    els.recordingMaxSecondsValue.textContent = String(normalizeRecordingMaxSeconds(els.recordingMaxSeconds.value));
  });

  els.recordingMaxSeconds.addEventListener(
    'change',
    voidAsync(async () => {
      await applyRecordingMaxSecondsFromUi(els.recordingMaxSeconds.value);
    })
  );

  els.recordingMaxSecondsValue.addEventListener(
    'dblclick',
    voidAsync(async () => {
      els.recordingMaxSeconds.value = String(defaultRecordingMaxSeconds);
      els.recordingMaxSecondsValue.textContent = String(defaultRecordingMaxSeconds);
      await applyRecordingMaxSecondsFromUi(defaultRecordingMaxSeconds);
    })
  );

  els.keyboardCharsPerMinute.addEventListener(
    'change',
    voidAsync(async () => {
      const value = Number(els.keyboardCharsPerMinute.value);
      const res = await window.voiceInput.setKeyboardCharsPerMinute(value);
      if (!res.ok) return;
      const next = normalizeKeyboardCharsPerMinuteFromUi(value);
      setKeyboardCharsPerMinute(next);
      els.keyboardCharsPerMinute.value = String(next);
      if (getActivePage() === 'stats') {
        await refreshStats();
      }
    })
  );

  els.silenceAutoStopSeconds.addEventListener(
    'change',
    voidAsync(async () => {
      await applySilenceAutoStopSecondsFromUi(els.silenceAutoStopSeconds.value);
    })
  );

  els.silenceAutoStopSecondsValue.addEventListener(
    'dblclick',
    voidAsync(async () => {
      els.silenceAutoStopSeconds.value = String(DEFAULT_SILENCE_AUTO_STOP_SECONDS);
      els.silenceAutoStopSecondsValue.textContent = String(DEFAULT_SILENCE_AUTO_STOP_SECONDS);
      await applySilenceAutoStopSecondsFromUi(DEFAULT_SILENCE_AUTO_STOP_SECONDS);
    })
  );
}
