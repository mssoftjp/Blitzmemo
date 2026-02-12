type VadStatus = 'speech' | 'silence';

type LocalVadSessionOptions = {
  onStatusChange?: (status: VadStatus) => void;
  onAutoStop?: () => void;
  autoStopMs?: number;
};

type FvadModule = {
  _fvad_new: () => number;
  _fvad_free: (handle: number) => void;
  _fvad_set_mode: (handle: number, mode: number) => number;
  _fvad_set_sample_rate: (handle: number, sampleRate: number) => number;
  _fvad_process: (handle: number, audioPtr: number, frameSize: number) => number;
  _malloc: (size: number) => number;
  _free: (ptr: number) => void;
  HEAP16: Int16Array;
};

type FvadFactory = (options?: {
  locateFile?: (path: string, scriptDirectory: string) => string;
  wasmBinary?: Uint8Array;
  instantiateWasm?: (
    imports: WebAssembly.Imports,
    successCallback: (instance: WebAssembly.Instance) => void
  ) => void;
}) => Promise<FvadModule>;

const TARGET_SAMPLE_RATE = 16000;
const FRAME_SIZE = 480;
const FRAME_DURATION_MS = 30;
const MIN_SPEECH_MS = 100;
const MIN_SILENCE_MS = 1000;
const DEFAULT_AUTO_STOP_MS = 2000;
const FVAD_MODE: 0 | 1 | 2 | 3 = 3;
// IMPORTANT: This VAD is used as a guard before sending audio to the transcription API
// (to avoid unnecessary requests for silence/short noises).
// Keep it intentionally aggressive, and require a minimum speech duration in `detectSpeechInPcm()`.
// If you change/remove this, re-verify with `BLITZMEMO_DEBUG=1` that 1–2s silent recordings do not trigger `[transcribe] start`.
const FVAD_DETECT_MODE: 0 | 1 | 2 | 3 = 3;

function getAudioContextCtor(): typeof AudioContext | null {
  return window.AudioContext ?? (window as unknown as { webkitAudioContext?: typeof AudioContext }).webkitAudioContext ?? null;
}

function resampleAudio(audioData: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return audioData;
  const ratio = fromRate / toRate;
  const newLength = Math.floor(audioData.length / ratio);
  const resampled = new Float32Array(newLength);
  for (let i = 0; i < newLength; i += 1) {
    const srcIndex = i * ratio;
    const srcIndexInt = Math.floor(srcIndex);
    const srcIndexFrac = srcIndex - srcIndexInt;
    if (srcIndexInt + 1 < audioData.length) {
      resampled[i] =
        audioData[srcIndexInt] * (1 - srcIndexFrac) + audioData[srcIndexInt + 1] * srcIndexFrac;
    } else {
      resampled[i] = audioData[srcIndexInt] ?? 0;
    }
  }
  return resampled;
}

let cachedFvadModulePromise: Promise<FvadModule> | null = null;

async function loadFvadModule(): Promise<FvadModule> {
  if (cachedFvadModulePromise) return cachedFvadModulePromise;

  cachedFvadModulePromise = (async () => {
    const moduleUrl = new URL('./lib/fvad-wasm/fvad.js', import.meta.url);
    const mod = (await import(moduleUrl.toString())) as { default: FvadFactory };
    const locateFile = (path: string) => new URL(`./lib/fvad-wasm/${path}`, import.meta.url).toString();
    return mod.default({ locateFile });
  })().catch((error) => {
    cachedFvadModulePromise = null;
    throw error;
  });

  return cachedFvadModulePromise;
}

function createDecodeContext(AudioContextCtor: typeof AudioContext): AudioContext {
  try {
    return new AudioContextCtor({ sampleRate: TARGET_SAMPLE_RATE });
  } catch {
    return new AudioContextCtor();
  }
}

async function decodeToMonoSamples(audioData: ArrayBuffer): Promise<{ samples: Float32Array; sampleRate: number } | null> {
  const AudioContextCtor = getAudioContextCtor();
  if (!AudioContextCtor) return null;

  let context: AudioContext;
  try {
    context = createDecodeContext(AudioContextCtor);
  } catch {
    return null;
  }

  try {
    const buffer = await context.decodeAudioData(audioData);
    if (buffer.length <= 0) return { samples: new Float32Array(0), sampleRate: buffer.sampleRate };
    if (buffer.numberOfChannels <= 1) {
      const ch0 = buffer.getChannelData(0);
      return { samples: ch0.slice(0), sampleRate: buffer.sampleRate };
    }

    const mixed = new Float32Array(buffer.length);
    for (let channel = 0; channel < buffer.numberOfChannels; channel += 1) {
      const ch = buffer.getChannelData(channel);
      for (let i = 0; i < mixed.length; i += 1) {
        mixed[i] += ch[i] ?? 0;
      }
    }
    const inv = buffer.numberOfChannels > 0 ? 1 / buffer.numberOfChannels : 1;
    for (let i = 0; i < mixed.length; i += 1) {
      mixed[i] *= inv;
    }
    return { samples: mixed, sampleRate: buffer.sampleRate };
  } catch {
    return null;
  } finally {
    void context.close().catch(() => {});
  }
}

async function detectSpeechInPcm(samples: Float32Array, sampleRate: number): Promise<boolean | null> {
  const fvadModule = await loadFvadModule().catch(() => null);
  if (!fvadModule) return null;

  const vadInstance = fvadModule._fvad_new();
  if (!vadInstance) return null;

  const sampleRateResult = fvadModule._fvad_set_sample_rate(vadInstance, TARGET_SAMPLE_RATE);
  if (sampleRateResult !== 0) {
    fvadModule._fvad_free(vadInstance);
    return null;
  }

  const modeResult = fvadModule._fvad_set_mode(vadInstance, FVAD_DETECT_MODE);
  if (modeResult !== 0) {
    fvadModule._fvad_free(vadInstance);
    return null;
  }

  const bufferPtr = fvadModule._malloc(FRAME_SIZE * 2);
  if (!bufferPtr) {
    fvadModule._fvad_free(vadInstance);
    return null;
  }

  try {
    const resampled =
      sampleRate === TARGET_SAMPLE_RATE
        ? samples
        : resampleAudio(samples, sampleRate, TARGET_SAMPLE_RATE);
    const bufferView = new Int16Array(fvadModule.HEAP16.buffer, bufferPtr, FRAME_SIZE);
    const int16Buffer = new Int16Array(FRAME_SIZE);
    // IMPORTANT: Require consecutive speech frames to avoid false positives from start/stop "click" noise.
    // This gate directly affects whether silent segments are sent to the API.
    const minSpeechFrames = Math.ceil(MIN_SPEECH_MS / FRAME_DURATION_MS);
    let consecutiveSpeechFrames = 0;

    let offset = 0;
    while (offset < resampled.length) {
      for (let i = 0; i < FRAME_SIZE; i += 1) {
        const sample = Math.max(-1, Math.min(1, resampled[offset + i] ?? 0));
        int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
      }

      bufferView.set(int16Buffer);
      const isSpeech = fvadModule._fvad_process(vadInstance, bufferPtr, FRAME_SIZE) === 1;
      consecutiveSpeechFrames = isSpeech ? consecutiveSpeechFrames + 1 : 0;
      if (consecutiveSpeechFrames >= minSpeechFrames) return true;
      offset += FRAME_SIZE;
    }

    return false;
  } finally {
    fvadModule._free(bufferPtr);
    fvadModule._fvad_free(vadInstance);
  }
}

export async function detectSpeechInAudioData(audioData: ArrayBuffer): Promise<boolean | null> {
  const decoded = await decodeToMonoSamples(audioData);
  if (!decoded) return null;
  return detectSpeechInPcm(decoded.samples, decoded.sampleRate);
}

export class LocalVadSession {
  static preload(): void {
    void loadFvadModule().catch(() => {});
  }

  private readonly onStatusChange?: (status: VadStatus) => void;
  private readonly onAutoStop?: () => void;
  private readonly autoStopMs: number;
  private context: AudioContext | null = null;
  private source: MediaStreamAudioSourceNode | null = null;
  private worklet: AudioWorkletNode | null = null;
  private gain: GainNode | null = null;
  private fvadModule: FvadModule | null = null;
  private vadInstance: number | null = null;
  private bufferPtr: number | null = null;
  private sampleRate = TARGET_SAMPLE_RATE;
  private frameBuffer = new Float32Array(FRAME_SIZE);
  private frameIndex = 0;
  private int16Buffer = new Int16Array(FRAME_SIZE);
  private status: VadStatus = 'silence';
  private speechFrames = 0;
  private silenceFrames = 0;
  private lastSpeechAt = 0;
  private autoStopTriggered = false;

  constructor(options: LocalVadSessionOptions) {
    this.onStatusChange = options.onStatusChange;
    this.onAutoStop = options.onAutoStop;
    const rawAutoStopMs = options.autoStopMs ?? DEFAULT_AUTO_STOP_MS;
    this.autoStopMs = Number.isFinite(rawAutoStopMs)
      ? Math.max(0, Math.min(24 * 60 * 60 * 1000, Math.floor(rawAutoStopMs)))
      : DEFAULT_AUTO_STOP_MS;
  }

  async start(stream: MediaStream): Promise<void> {
    const AudioContextCtor = getAudioContextCtor();
    if (!AudioContextCtor) {
      throw new Error('AudioContext is not available');
    }

    try {
      this.context = new AudioContextCtor({ latencyHint: 'interactive', sampleRate: TARGET_SAMPLE_RATE });
    } catch {
      this.context = new AudioContextCtor({ latencyHint: 'interactive' });
    }
    this.sampleRate = this.context.sampleRate;

    this.fvadModule = await loadFvadModule();
    this.vadInstance = this.fvadModule._fvad_new();
    if (!this.vadInstance) {
      throw new Error('Failed to create VAD instance');
    }
    const sampleRateResult = this.fvadModule._fvad_set_sample_rate(this.vadInstance, TARGET_SAMPLE_RATE);
    if (sampleRateResult !== 0) {
      throw new Error('Failed to set VAD sample rate');
    }
    const modeResult = this.fvadModule._fvad_set_mode(this.vadInstance, FVAD_MODE);
    if (modeResult !== 0) {
      throw new Error('Failed to set VAD mode');
    }
    this.bufferPtr = this.fvadModule._malloc(FRAME_SIZE * 2);
    if (!this.bufferPtr) {
      throw new Error('Failed to allocate VAD buffer');
    }

    this.source = this.context.createMediaStreamSource(stream);

    const workletUrl = new URL('./vadWorklet.js', import.meta.url);
    await this.context.audioWorklet.addModule(workletUrl.toString());
    this.worklet = new AudioWorkletNode(this.context, 'avi-vad-capture');

    this.gain = this.context.createGain();
    this.gain.gain.value = 0;

    this.worklet.port.onmessage = (event: MessageEvent<unknown>) => {
      const payload = event.data;
      const input =
        payload instanceof Float32Array
          ? payload
          : payload instanceof ArrayBuffer
            ? new Float32Array(payload)
            : null;
      if (!input) return;
      const samples =
        this.sampleRate === TARGET_SAMPLE_RATE
          ? input
          : resampleAudio(input, this.sampleRate, TARGET_SAMPLE_RATE);
      this.processSamples(samples);
    };

    this.source.connect(this.worklet);
    this.worklet.connect(this.gain);
    this.gain.connect(this.context.destination);

    await this.context.resume();
  }

  stop(): void {
    if (this.worklet) {
      this.worklet.port.onmessage = null;
      try {
        this.worklet.disconnect();
      } catch {
        // ignore
      }
    }
    try {
      this.source?.disconnect();
    } catch {
      // ignore
    }
    try {
      this.gain?.disconnect();
    } catch {
      // ignore
    }
    if (this.context) {
      void this.context.close().catch(() => {});
    }

    if (this.fvadModule) {
      if (this.bufferPtr !== null) {
        this.fvadModule._free(this.bufferPtr);
        this.bufferPtr = null;
      }
      if (this.vadInstance !== null) {
        this.fvadModule._fvad_free(this.vadInstance);
        this.vadInstance = null;
      }
      this.fvadModule = null;
    }

    this.context = null;
    this.source = null;
    this.worklet = null;
    this.gain = null;
    this.frameIndex = 0;
    this.status = 'silence';
    this.speechFrames = 0;
    this.silenceFrames = 0;
    this.lastSpeechAt = 0;
    this.autoStopTriggered = false;
  }

  private processSamples(samples: Float32Array): void {
    let offset = 0;
    while (offset < samples.length) {
      const remaining = FRAME_SIZE - this.frameIndex;
      const copyCount = Math.min(remaining, samples.length - offset);
      this.frameBuffer.set(samples.subarray(offset, offset + copyCount), this.frameIndex);
      this.frameIndex += copyCount;
      offset += copyCount;

      if (this.frameIndex >= FRAME_SIZE) {
        this.frameIndex = 0;
        this.processFrame(this.frameBuffer);
      }
    }
  }

  private processFrame(frame: Float32Array): void {
    const isSpeech = this.detectFvadSpeech(frame);

    if (isSpeech) {
      this.speechFrames += 1;
      this.silenceFrames = 0;
      if (this.speechFrames >= Math.ceil(MIN_SPEECH_MS / FRAME_DURATION_MS)) {
        if (this.status !== 'speech') {
          this.status = 'speech';
          this.onStatusChange?.('speech');
        }
      }
      this.lastSpeechAt = Date.now();
      this.autoStopTriggered = false;
      return;
    }

    this.silenceFrames += 1;
    this.speechFrames = 0;
    if (this.silenceFrames >= Math.ceil(MIN_SILENCE_MS / FRAME_DURATION_MS)) {
      if (this.status !== 'silence') {
        this.status = 'silence';
        this.onStatusChange?.('silence');
      }
    }

    if (
      this.status === 'silence' &&
      !this.autoStopTriggered &&
      this.autoStopMs > 0 &&
      this.lastSpeechAt > 0 &&
      Date.now() - this.lastSpeechAt >= this.autoStopMs
    ) {
      this.autoStopTriggered = true;
      this.onAutoStop?.();
    }
  }

  private detectFvadSpeech(frame: Float32Array): boolean {
    if (!this.fvadModule || this.vadInstance === null || this.bufferPtr === null) return false;

    for (let i = 0; i < FRAME_SIZE; i += 1) {
      const sample = Math.max(-1, Math.min(1, frame[i] ?? 0));
      this.int16Buffer[i] = sample < 0 ? sample * 0x8000 : sample * 0x7fff;
    }

    const bufferView = new Int16Array(this.fvadModule.HEAP16.buffer, this.bufferPtr, FRAME_SIZE);
    bufferView.set(this.int16Buffer);

    return this.fvadModule._fvad_process(this.vadInstance, this.bufferPtr, FRAME_SIZE) === 1;
  }
}
