declare class AudioWorkletProcessor {
  readonly port: MessagePort;
  constructor();
  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][],
    parameters: Record<string, Float32Array>
  ): boolean;
}

declare function registerProcessor(
  name: string,
  processorCtor: new () => AudioWorkletProcessor
): void;

class AviVadCaptureProcessor extends AudioWorkletProcessor {
  private readonly bufferSize = 2048;
  private buffer = new Float32Array(this.bufferSize);
  private index = 0;

  process(
    inputs: Float32Array[][],
    outputs: Float32Array[][]
  ): boolean {
    const input = inputs[0];
    if (!input || input.length === 0) return true;
    const channel = input[0];
    if (!channel) return true;

    const output = outputs[0]?.[0];
    if (output && output.length === channel.length) {
      output.set(channel);
    }

    let offset = 0;
    while (offset < channel.length) {
      const remaining = this.bufferSize - this.index;
      const copyCount = Math.min(remaining, channel.length - offset);
      this.buffer.set(channel.subarray(offset, offset + copyCount), this.index);
      this.index += copyCount;
      offset += copyCount;

      if (this.index >= this.bufferSize) {
        const out = this.buffer;
        this.buffer = new Float32Array(this.bufferSize);
        this.index = 0;
        this.port.postMessage(out, [out.buffer]);
      }
    }

    return true;
  }
}

registerProcessor('avi-vad-capture', AviVadCaptureProcessor);
