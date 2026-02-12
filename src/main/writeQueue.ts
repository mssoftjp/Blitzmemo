export class WriteQueue {
  private queue: Promise<void> = Promise.resolve();

  enqueue(op: () => Promise<void>): Promise<void> {
    this.queue = this.queue.then(op, op);
    return this.queue;
  }
}

