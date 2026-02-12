export type RecordingLimitTimerController = {
  clear: () => void;
  schedule: () => void;
};

export type CreateRecordingLimitTimerOptions = {
  isRecordingSession: () => boolean;
  getRecordingMaxSeconds: () => number;
  getActiveSegmentStartedAt: () => number | null;
  rotateRecordingSegment: () => void;
};

export function createRecordingLimitTimer(opts: CreateRecordingLimitTimerOptions): RecordingLimitTimerController {
  let timer: number | null = null;

  function clear(): void {
    if (timer === null) return;
    window.clearTimeout(timer);
    timer = null;
  }

  function schedule(): void {
    clear();
    if (!opts.isRecordingSession()) return;
    const maxSeconds = opts.getRecordingMaxSeconds();
    if (maxSeconds <= 0) return;
    const startedAt = opts.getActiveSegmentStartedAt();
    if (startedAt === null) return;

    const elapsedSeconds = (Date.now() - startedAt) / 1000;
    const remainingSeconds = maxSeconds - elapsedSeconds;
    if (remainingSeconds <= 0) {
      opts.rotateRecordingSegment();
      return;
    }

    timer = window.setTimeout(() => {
      timer = null;
      opts.rotateRecordingSegment();
    }, Math.ceil(remainingSeconds * 1000));
  }

  return { clear, schedule };
}
