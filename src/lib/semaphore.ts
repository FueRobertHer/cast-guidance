/**
 * A counting semaphore: at most `permits` holders run concurrently; the rest
 * queue FIFO. Used to bound how many data-file fetches hit the network at once,
 * no matter how many packs are being ensured in parallel.
 */
export class Semaphore {
  private available: number;
  private readonly waiters: Array<() => void> = [];

  constructor(permits: number) {
    if (!Number.isInteger(permits) || permits < 1) {
      throw new Error(`Semaphore needs a positive integer permit count, got ${permits}`);
    }
    this.available = permits;
  }

  private acquire(): Promise<void> {
    if (this.available > 0) {
      this.available -= 1;
      return Promise.resolve();
    }
    return new Promise<void>((resolve) => this.waiters.push(resolve));
  }

  private release(): void {
    const next = this.waiters.shift();
    if (next !== undefined) {
      // Hand the permit straight to the next waiter (count stays reserved).
      next();
    } else {
      this.available += 1;
    }
  }

  /** Run `fn` while holding a permit; the permit is always released. */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    await this.acquire();
    try {
      return await fn();
    } finally {
      this.release();
    }
  }
}
