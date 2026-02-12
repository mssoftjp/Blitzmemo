import type { UiStringKey } from '../../shared/i18n';
import { MAX_SILENCE_AUTO_STOP_SECONDS } from '../../shared/settingsConstraints';
import { LocalVadSession } from '../localVad';

type Translator = (key: UiStringKey, params?: Record<string, string | number>) => string;

export type SilenceAutoStopController = {
  start: (stream: MediaStream) => Promise<void>;
  stop: () => void;
};

export type CreateSilenceAutoStopControllerOptions = {
  getAutoStopSeconds: () => number;
  resetSilenceProcessingMode: () => void;
  isRecordingSession: () => boolean;
  stopRecording: (message?: string) => void;
  tr: Translator;
};

export function createSilenceAutoStopController(opts: CreateSilenceAutoStopControllerOptions): SilenceAutoStopController {
  let startToken = 0;
  let session: LocalVadSession | null = null;
  let triggered = false;

  function stop(): void {
    startToken += 1;
    if (!session) return;
    session.stop();
    session = null;
  }

  async function start(stream: MediaStream): Promise<void> {
    stop();
    const token = startToken;
    opts.resetSilenceProcessingMode();
    triggered = false;
    const seconds = opts.getAutoStopSeconds();
    if (seconds <= 0) return;

    const onAutoStop = () => {
      if (triggered) return;
      if (!opts.isRecordingSession()) return;
      triggered = true;
      opts.stopRecording(opts.tr('recording.autoStopped.silence'));
    };

    try {
      const autoStopMs = Math.max(0, Math.min(MAX_SILENCE_AUTO_STOP_SECONDS * 1000, Math.floor(seconds * 1000)));
      const nextSession = new LocalVadSession({ onAutoStop, autoStopMs });
      session = nextSession;
      await nextSession.start(stream);
      if (token !== startToken || session !== nextSession || !opts.isRecordingSession()) {
        nextSession.stop();
        if (session === nextSession) session = null;
      }
    } catch (error) {
      if (token !== startToken) return;
      console.warn('Failed to initialize local silence auto-stop', error);
      stop();
    }
  }

  return { start, stop };
}

