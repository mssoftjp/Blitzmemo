import type { UiStringKey } from '../../shared/i18n';
import type { SilenceProcessingMode, UiLanguage } from '../../shared/types';
import { formatApiError } from '../../shared/apiError';
import { detectSpeechInAudioData } from '../localVad';
import { getAudioStream } from './audioStream';
import { formatStartRecordingErrorMessage } from './errors';
import type { SegmentResultsBuffer } from './segmentResults';
import { createRecordingLimitTimer } from './recordingLimitTimer';
import type { MicLevelMeterApi } from './micLevelMeter';
import { startNewSegment, stopSegment, type RecordingSegment } from './segments';
import { stopStreamTracks } from './media';
import { refreshAudioInputDevices, notifyActiveMicrophone } from './microphone';
import type { SilenceAutoStopController } from './silenceAutoStop';
import type { WarmAudioStreamManager } from './warmAudioStream';

export type RecordingStatus = 'idle' | 'recording' | 'transcribing' | 'error';

export type RecordingSession = {
  start: () => Promise<void>;
  stop: (message?: string) => void;
  cancel: () => void;
  toggle: () => Promise<void>;
  isRecording: () => boolean;
  rescheduleLimitTimer: () => void;
};

export type CreateRecordingSessionOptions = {
  getUiLanguage: () => UiLanguage;
  getSilenceProcessingMode: () => SilenceProcessingMode;
  getActivePage: () => string;
  tr: (key: UiStringKey, params?: Record<string, string | number>) => string;
  setStatus: (status: RecordingStatus, message?: string) => void;
  getStatus: () => RecordingStatus;

  getRecordingMaxSeconds: () => number;
  getMicDeviceId: () => string | null;
  setMicDeviceId: (deviceId: string | null) => void;
  getMicWarmGraceMs: () => number;

  micLevelMeter: MicLevelMeterApi;
  silenceAutoStop: SilenceAutoStopController;
  warmAudioStreamManager: WarmAudioStreamManager;
  segmentResultsBuffer: SegmentResultsBuffer;

  refreshUsage: () => Promise<void>;
  refreshStats: () => Promise<void>;
};

export function createRecordingSession(opts: CreateRecordingSessionOptions): RecordingSession {
  let isRecordingSession = false;
  let recordingStartToken = 0;
  let recordingStream: MediaStream | null = null;
  let recordingStreamRequestedDeviceId: string | null = null;

  let activeSegment: RecordingSegment | null = null;
  let recordingGeneration = 0;
  let nextSegmentSequence = 0;
  let transcribeRequestCounter = 0;
  const activeTranscribeRequests: Set<number> = new Set();

  let lastTranscriptionFeedback: {
    hasText: boolean;
    didCopy: boolean;
    didPaste?: boolean;
    pasteError?: string;
  } | null = null;

  function buildIdleMessage(): string | undefined {
    if (!lastTranscriptionFeedback) return;
    if (!lastTranscriptionFeedback.hasText) return opts.tr('recording.idle.noSpeech');
    if (lastTranscriptionFeedback.didPaste) return opts.tr('recording.idle.pasted');
    if (lastTranscriptionFeedback.pasteError) {
      const short =
        lastTranscriptionFeedback.pasteError.length > 120
          ? `${lastTranscriptionFeedback.pasteError.slice(0, 120).trim()}…`
          : lastTranscriptionFeedback.pasteError;
      return opts.tr('recording.idle.copiedPasteFailed', { error: short });
    }
    if (lastTranscriptionFeedback.didCopy) return opts.tr('recording.idle.copiedToClipboard');
    return opts.tr('recording.idle.transcribed');
  }

  function updateIdleStatusIfReady(generation: number): void {
    if (generation !== recordingGeneration) return;
    if (isRecordingSession) return;
    if (activeTranscribeRequests.size > 0) return;
    if (opts.getStatus() === 'error') return;
    opts.setStatus('idle', buildIdleMessage());
  }

  async function handleSegmentStop(segment: RecordingSegment): Promise<void> {
    let requestId: number | null = null;
    try {
      if (segment.generation !== recordingGeneration) return;
      if (!segment.shouldSend) {
        opts.segmentResultsBuffer.set(segment.sequence, { text: '' });
        opts.segmentResultsBuffer.flush();
        lastTranscriptionFeedback = { hasText: false, didCopy: false };
        updateIdleStatusIfReady(segment.generation);
        return;
      }

      const recorderMimeType = segment.recorder.mimeType || 'audio/webm';
      const blob = new Blob(segment.chunks, { type: recorderMimeType });
      let audioData = await blob.arrayBuffer();

      if (audioData.byteLength === 0) {
        opts.segmentResultsBuffer.set(segment.sequence, { text: '' });
        opts.segmentResultsBuffer.flush();
        lastTranscriptionFeedback = { hasText: false, didCopy: false };
        updateIdleStatusIfReady(segment.generation);
        return;
      }

      // IMPORTANT: Skip sending silent segments to reduce cost and prevent unstable results.
      // If you change/remove this guard, verify with `BLITZMEMO_DEBUG=1` that 1–2s silent recordings do not trigger `[transcribe] start`.
      const speechDetected = await detectSpeechInAudioData(audioData);
      if (segment.generation !== recordingGeneration) return;
      if (speechDetected === false) {
        opts.segmentResultsBuffer.set(segment.sequence, { text: '' });
        opts.segmentResultsBuffer.flush();
        lastTranscriptionFeedback = { hasText: false, didCopy: false };
        updateIdleStatusIfReady(segment.generation);
        return;
      }

      if (audioData.byteLength === 0) {
        audioData = await blob.arrayBuffer();
        if (segment.generation !== recordingGeneration) return;
        if (audioData.byteLength === 0) {
          opts.segmentResultsBuffer.set(segment.sequence, { text: '' });
          opts.segmentResultsBuffer.flush();
          lastTranscriptionFeedback = { hasText: false, didCopy: false };
          updateIdleStatusIfReady(segment.generation);
          return;
        }
      }

      requestId = ++transcribeRequestCounter;
      activeTranscribeRequests.add(requestId);

      try {
        const res = await window.voiceInput.transcribe(
          audioData,
          blob.type,
          segment.durationSeconds,
          opts.getSilenceProcessingMode(),
          segment.endedAt ?? Date.now()
        );
        void opts.refreshUsage();
        if (opts.getActivePage() === 'stats') {
          void opts.refreshStats();
        }

        if (segment.generation !== recordingGeneration) return;

        if (!res.ok) {
          if (res.canceled || res.errorCode === 'canceled') {
            opts.segmentResultsBuffer.set(segment.sequence, { text: '' });
            opts.segmentResultsBuffer.flush();
            return;
          }
          const errorMessage = formatApiError(opts.getUiLanguage(), res, 'transcribe.error.failed');
          opts.segmentResultsBuffer.set(segment.sequence, { text: '' });
          opts.segmentResultsBuffer.flush();
          if (isRecordingSession) {
            opts.setStatus('recording', `${opts.tr('memo.status.recording')} — ${errorMessage}`);
          } else {
            opts.setStatus('error', errorMessage);
          }
          return;
        }

        const text = res.text ?? '';
        const hasText = text.trim().length > 0;
        opts.segmentResultsBuffer.set(segment.sequence, { text, didPaste: res.didPaste, pasteError: res.pasteError });
        lastTranscriptionFeedback = {
          hasText,
          didCopy: res.didCopy ?? hasText,
          didPaste: Boolean(res.didPaste),
          ...(res.pasteError ? { pasteError: res.pasteError } : {})
        };
        opts.segmentResultsBuffer.flush();
      } catch (error) {
        if (segment.generation !== recordingGeneration) return;
        const errorMessage = error instanceof Error ? error.message : opts.tr('transcribe.error.failed');
        opts.segmentResultsBuffer.set(segment.sequence, { text: '' });
        opts.segmentResultsBuffer.flush();
        if (isRecordingSession) {
          opts.setStatus('recording', `${opts.tr('memo.status.recording')} — ${errorMessage}`);
        } else {
          opts.setStatus('error', errorMessage);
        }
      } finally {
        if (requestId !== null) {
          activeTranscribeRequests.delete(requestId);
          updateIdleStatusIfReady(segment.generation);
        }
      }
    } finally {
      if (segment.stopTracksAfterStop) {
        stopStreamTracks(segment.stream);
      }
    }
  }

  function rotateRecordingSegment(): void {
    if (!isRecordingSession) return;
    if (opts.getRecordingMaxSeconds() <= 0) return;
    if (!activeSegment) return;
    if (!recordingStream) return;

    const segment = activeSegment;
    stopSegment(segment, { shouldSend: true, stopTracksAfterStop: false });

    activeSegment = startNewSegment({
      stream: recordingStream,
      generation: recordingGeneration,
      sequence: nextSegmentSequence++,
      onStop: handleSegmentStop
    });
    recordingLimitTimer.schedule();
  }

  const recordingLimitTimer = createRecordingLimitTimer({
    isRecordingSession: () => isRecordingSession,
    getRecordingMaxSeconds: opts.getRecordingMaxSeconds,
    getActiveSegmentStartedAt: () => activeSegment?.startedAt ?? null,
    rotateRecordingSegment
  });

  async function start(): Promise<void> {
    if (isRecordingSession) return;
    const startToken = (recordingStartToken += 1);
    try {
      isRecordingSession = true;
      lastTranscriptionFeedback = null;
      recordingStreamRequestedDeviceId = null;

      let preferredDeviceId: string | null = opts.getMicDeviceId();
      try {
        const settings = await window.voiceInput.getSettings();
        opts.setMicDeviceId(settings.micDeviceId);
        preferredDeviceId = settings.micDeviceId;
      } catch {
        // ignore
      }

      const streamResult = await getAudioStream(preferredDeviceId, opts.warmAudioStreamManager.take);
      const stream = streamResult.stream;
      if (!isRecordingSession || startToken !== recordingStartToken) {
        stopStreamTracks(stream);
        return;
      }

      if (streamResult.didFallback && preferredDeviceId) {
        try {
          const res = await window.voiceInput.setMicDeviceId(null);
          if (res.ok) {
            opts.setMicDeviceId(null);
          }
        } catch {
          // ignore
        }
      }

      recordingStreamRequestedDeviceId = streamResult.requestedDeviceId;
      recordingStream = stream;
      void refreshAudioInputDevices();
      notifyActiveMicrophone(stream);
      opts.micLevelMeter.start(stream);
      activeSegment = startNewSegment({
        stream,
        generation: recordingGeneration,
        sequence: nextSegmentSequence++,
        onStop: handleSegmentStop
      });
      recordingLimitTimer.schedule();
      opts.setStatus('recording');
      void opts.silenceAutoStop.start(stream);
    } catch (error) {
      if (!isRecordingSession || startToken !== recordingStartToken) return;
      console.warn('Failed to start recording', error);
      isRecordingSession = false;
      recordingStream = null;
      recordingStreamRequestedDeviceId = null;
      activeSegment = null;
      opts.micLevelMeter.stop();
      opts.silenceAutoStop.stop();
      opts.setStatus('error', formatStartRecordingErrorMessage(opts.tr, error));
    }
  }

  function stop(message?: string): void {
    recordingLimitTimer.clear();
    if (!isRecordingSession) return;
    isRecordingSession = false;
    opts.micLevelMeter.stop();
    opts.silenceAutoStop.stop();
    const keepMicWarm = opts.getMicWarmGraceMs() > 0;

    const segment = activeSegment;
    activeSegment = null;

    if (!segment) {
      if (keepMicWarm) {
        opts.warmAudioStreamManager.keep(recordingStream, recordingStreamRequestedDeviceId);
      } else {
        stopStreamTracks(recordingStream);
      }
      recordingStream = null;
      recordingStreamRequestedDeviceId = null;
      opts.setStatus('idle', message ?? opts.tr('common.canceled'));
      return;
    }

    stopSegment(segment, { shouldSend: true, stopTracksAfterStop: !keepMicWarm });
    if (keepMicWarm) {
      opts.warmAudioStreamManager.keep(segment.stream, recordingStreamRequestedDeviceId);
    }
    recordingStream = null;
    recordingStreamRequestedDeviceId = null;
    opts.setStatus('transcribing', message);
  }

  function cancel(): void {
    if (isRecordingSession) {
      recordingLimitTimer.clear();
      isRecordingSession = false;
      opts.micLevelMeter.stop();
      opts.silenceAutoStop.stop();
      opts.warmAudioStreamManager.stop();
      recordingGeneration += 1;
      opts.segmentResultsBuffer.clear();
      opts.segmentResultsBuffer.resetNextSequence(nextSegmentSequence);
      activeTranscribeRequests.clear();
      lastTranscriptionFeedback = null;

      try {
        window.voiceInput.cancelTranscription();
      } catch {
        // ignore
      }

      const segment = activeSegment;
      activeSegment = null;

      if (segment) {
        stopSegment(segment, { shouldSend: false, stopTracksAfterStop: true });
      } else {
        stopStreamTracks(recordingStream);
      }

      recordingStream = null;
      recordingStreamRequestedDeviceId = null;
      opts.setStatus('idle', opts.tr('common.canceled'));
      return;
    }

    if (opts.getStatus() === 'transcribing') {
      opts.warmAudioStreamManager.stop();
      recordingGeneration += 1;
      opts.segmentResultsBuffer.clear();
      opts.segmentResultsBuffer.resetNextSequence(nextSegmentSequence);
      activeTranscribeRequests.clear();
      lastTranscriptionFeedback = null;
      try {
        window.voiceInput.cancelTranscription();
      } catch {
        // ignore
      }
      opts.setStatus('idle', opts.tr('common.canceled'));
    }
  }

  async function toggle(): Promise<void> {
    if (isRecordingSession) {
      stop();
      return;
    }
    const status = opts.getStatus();
    if (status === 'idle' || status === 'error' || status === 'transcribing') {
      await start();
    }
  }

  function rescheduleLimitTimer(): void {
    if (!isRecordingSession) return;
    recordingLimitTimer.schedule();
  }

  return {
    start,
    stop,
    cancel,
    toggle,
    isRecording: () => isRecordingSession,
    rescheduleLimitTimer
  };
}
