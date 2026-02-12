import { clamp01 } from '../micLevel';

type MicLevelMeterState = {
  context: AudioContext;
  analyser: AnalyserNode;
  source: MediaStreamAudioSourceNode;
  gain: GainNode;
  timeDomainData: Uint8Array;
  intervalId: number;
  smoothedLevel: number;
};

export type MicLevelMeterApi = {
  start: (stream: MediaStream) => void;
  stop: () => void;
};

export type CreateMicLevelMeterOptions = {
  isActive: () => boolean;
  applyLevel: (level: number) => void;
  notifyLevel: (level: number) => void;
};

export function createMicLevelMeter(options: CreateMicLevelMeterOptions): MicLevelMeterApi {
  let meter: MicLevelMeterState | null = null;

  function notify(level: number): void {
    try {
      options.notifyLevel(level);
    } catch {
      // ignore
    }
  }

  function stop(): void {
    if (!meter) {
      options.applyLevel(0);
      notify(0);
      return;
    }

    window.clearInterval(meter.intervalId);
    const context = meter.context;
    meter = null;
    options.applyLevel(0);
    notify(0);
    void context.close().catch(() => {});
  }

  function start(stream: MediaStream): void {
    stop();
    const AudioContextCtor =
      window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext;
    if (!AudioContextCtor) return;

    let context: AudioContext;
    try {
      context = new AudioContextCtor({ latencyHint: 'interactive' });
    } catch {
      return;
    }

    const source = context.createMediaStreamSource(stream);
    const analyser = context.createAnalyser();
    analyser.fftSize = 1024;
    analyser.smoothingTimeConstant = 0.6;
    source.connect(analyser);

    const gain = context.createGain();
    gain.gain.value = 0;
    analyser.connect(gain);
    gain.connect(context.destination);

    const timeDomainData = new Uint8Array(analyser.fftSize);
    const MIN_DB = -72;
    const LEVEL_FLOOR_DB = -55;
    const LEVEL_CEIL_DB = -20;
    const LEVEL_CURVE: number = 1.6;
    const ATTACK_ALPHA = 0.35;
    const RELEASE_ALPHA = 0.12;

    const nextMeter: MicLevelMeterState = {
      context,
      analyser,
      source,
      gain,
      timeDomainData,
      intervalId: 0,
      smoothedLevel: 0
    };

    const tick = () => {
      if (!meter) return;
      if (!options.isActive()) {
        nextMeter.smoothedLevel = 0;
        options.applyLevel(0);
        notify(0);
        return;
      }

      analyser.getByteTimeDomainData(timeDomainData);
      let sumSquares = 0;
      for (let i = 0; i < timeDomainData.length; i += 1) {
        const normalized = (timeDomainData[i] - 128) / 128;
        sumSquares += normalized * normalized;
      }
      const rms = Math.sqrt(sumSquares / timeDomainData.length);
      const dbRaw = rms > 0 ? 20 * Math.log10(rms) : -Infinity;
      const db = Number.isFinite(dbRaw) ? Math.max(MIN_DB, dbRaw) : MIN_DB;
      const rangeDb = LEVEL_CEIL_DB - LEVEL_FLOOR_DB;
      const normalized = rangeDb > 0 ? clamp01((db - LEVEL_FLOOR_DB) / rangeDb) : 0;
      const rawLevel = LEVEL_CURVE === 1 ? normalized : Math.pow(normalized, LEVEL_CURVE);

      const alpha = rawLevel > nextMeter.smoothedLevel ? ATTACK_ALPHA : RELEASE_ALPHA;
      nextMeter.smoothedLevel = nextMeter.smoothedLevel + (rawLevel - nextMeter.smoothedLevel) * alpha;

      options.applyLevel(nextMeter.smoothedLevel);
      notify(nextMeter.smoothedLevel);
    };

    void context.resume().catch(() => {});
    nextMeter.intervalId = window.setInterval(tick, 50);
    meter = nextMeter;
  }

  return { start, stop };
}

