export type SegmentResult = { text: string; didPaste?: boolean; pasteError?: string };

export type SegmentResultsBuffer = {
  set: (sequence: number, result: SegmentResult) => void;
  clear: () => void;
  resetNextSequence: (sequence: number) => void;
  flush: () => void;
};

export function createSegmentResultsBuffer(opts: { appendText: (text: string) => void }): SegmentResultsBuffer {
  const results: Map<number, SegmentResult> = new Map();
  let nextSequence = 0;

  function set(sequence: number, result: SegmentResult): void {
    results.set(sequence, result);
  }

  function clear(): void {
    results.clear();
  }

  function resetNextSequence(sequence: number): void {
    nextSequence = sequence;
  }

  function flush(): void {
    while (true) {
      const result = results.get(nextSequence);
      if (!result) return;
      results.delete(nextSequence);
      nextSequence += 1;
      opts.appendText(result.text);
    }
  }

  return { set, clear, resetNextSequence, flush };
}
