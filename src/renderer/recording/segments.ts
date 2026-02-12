import { pickMimeType, stopStreamTracks } from './media';

export type RecordingSegment = {
  generation: number;
  sequence: number;
  recorder: MediaRecorder;
  chunks: BlobPart[];
  stream: MediaStream;
  startedAt: number;
  endedAt: number | null;
  durationSeconds: number;
  shouldSend: boolean;
  stopTracksAfterStop: boolean;
};

export function startNewSegment(options: {
  stream: MediaStream;
  generation: number;
  sequence: number;
  onStop: (segment: RecordingSegment) => Promise<void>;
}): RecordingSegment {
  const mimeType = pickMimeType();
  const recorder = new MediaRecorder(options.stream, mimeType ? { mimeType } : undefined);
  const segment: RecordingSegment = {
    generation: options.generation,
    sequence: options.sequence,
    recorder,
    chunks: [],
    stream: options.stream,
    startedAt: Date.now(),
    endedAt: null,
    durationSeconds: 0,
    shouldSend: false,
    stopTracksAfterStop: false
  };

  recorder.ondataavailable = (event) => {
    if (event.data && event.data.size > 0) segment.chunks.push(event.data);
  };

  recorder.onstop = () => {
    options.onStop(segment).catch((error) => {
      console.error(error);
    });
  };

  recorder.start();
  return segment;
}

export function stopSegment(
  segment: RecordingSegment,
  options: { shouldSend: boolean; stopTracksAfterStop: boolean }
): void {
  if (segment.recorder.state === 'inactive') {
    if (options.stopTracksAfterStop) stopStreamTracks(segment.stream);
    return;
  }

  segment.endedAt = Date.now();
  segment.durationSeconds = Math.max(0, (segment.endedAt - segment.startedAt) / 1000);
  segment.shouldSend = options.shouldSend;
  segment.stopTracksAfterStop = options.stopTracksAfterStop;

  try {
    segment.recorder.stop();
  } catch {
    if (options.stopTracksAfterStop) stopStreamTracks(segment.stream);
  }
}
