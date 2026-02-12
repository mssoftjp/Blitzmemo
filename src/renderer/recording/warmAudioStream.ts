import { stopStreamTracks } from './media';

export type WarmAudioStream = { stream: MediaStream; requestedDeviceId: string | null };

export type WarmAudioStreamManager = {
  stop: () => void;
  take: (deviceId: string | null) => WarmAudioStream | null;
  keep: (stream: MediaStream | null, requestedDeviceId: string | null) => void;
};

export type CreateWarmAudioStreamManagerOptions = {
  getGraceMs: () => number;
};

export function createWarmAudioStreamManager(opts: CreateWarmAudioStreamManagerOptions): WarmAudioStreamManager {
  let warmAudioStream: MediaStream | null = null;
  let warmAudioStreamRequestedDeviceId: string | null = null;
  let warmAudioStreamStopTimer: number | null = null;

  function clearStopTimer(): void {
    if (warmAudioStreamStopTimer === null) return;
    window.clearTimeout(warmAudioStreamStopTimer);
    warmAudioStreamStopTimer = null;
  }

  function stop(): void {
    clearStopTimer();
    if (!warmAudioStream) return;
    stopStreamTracks(warmAudioStream);
    warmAudioStream = null;
    warmAudioStreamRequestedDeviceId = null;
  }

  function scheduleStop(graceMs: number): void {
    clearStopTimer();
    if (!warmAudioStream) return;
    warmAudioStreamStopTimer = window.setTimeout(() => {
      warmAudioStreamStopTimer = null;
      stop();
    }, graceMs);
  }

  function take(deviceId: string | null): WarmAudioStream | null {
    if (!warmAudioStream) return null;

    const graceMs = opts.getGraceMs();
    if (graceMs <= 0) {
      stop();
      return null;
    }

    const track = warmAudioStream.getAudioTracks()[0];
    if (!track || track.readyState !== 'live') {
      stop();
      return null;
    }

    if (warmAudioStreamRequestedDeviceId !== deviceId) {
      stop();
      return null;
    }

    clearStopTimer();
    const stream = warmAudioStream;
    const requestedDeviceId = warmAudioStreamRequestedDeviceId;
    warmAudioStream = null;
    warmAudioStreamRequestedDeviceId = null;
    return { stream, requestedDeviceId };
  }

  function keep(stream: MediaStream | null, requestedDeviceId: string | null): void {
    if (!stream) return;
    const graceMs = opts.getGraceMs();
    if (graceMs <= 0) {
      stopStreamTracks(stream);
      return;
    }

    if (warmAudioStream && warmAudioStream !== stream) {
      stop();
    }
    warmAudioStream = stream;
    warmAudioStreamRequestedDeviceId = requestedDeviceId;
    scheduleStop(graceMs);
  }

  return { stop, take, keep };
}
