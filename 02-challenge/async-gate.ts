/**
 * AsyncGate - Async concurrency limiter with backpressure-aware iteration
 * Features: FIFO, cancellation, timeout, backpressure iterator | No deps | NOT a Node stream
 */
export type ReleaseFunction = () => void;
export interface AcquireOptions { timeout?: number; signal?: AbortSignal; }

export class TimeoutError extends Error {
  constructor() { super('Gate acquisition timed out'); this.name = 'TimeoutError'; }
}
export class AbortError extends Error {
  constructor() { super('Gate acquisition aborted'); this.name = 'AbortError'; }
}

interface WaitNode {
  resolve: (release: ReleaseFunction) => void;
  reject: (error: Error) => void;
  prev: WaitNode | null;
  next: WaitNode | null;
  settled: boolean;
}

export class AsyncGate {
  private readonly concurrency: number;
  private running = 0;
  private head: WaitNode | null = null;
  private tail: WaitNode | null = null;

  constructor(options: { concurrency: number }) {
    if (options.concurrency <= 0) throw new Error('Concurrency must be > 0');
    this.concurrency = options.concurrency;
  }

  async acquire(options: AcquireOptions = {}): Promise<ReleaseFunction> {
    const { timeout, signal } = options;
    if (signal?.aborted) throw new AbortError();
    if (this.running < this.concurrency) { this.running++; return this.createRelease(); }

    return new Promise<ReleaseFunction>((resolve, reject) => {
      const node: WaitNode = { resolve, reject, prev: null, next: null, settled: false };
      this.enqueue(node);

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        this.unlink(node);
        signal?.removeEventListener('abort', onAbort);
        if (timeoutId) clearTimeout(timeoutId);
      };
      const onAbort = () => {
        if (node.settled) return;
        node.settled = true; cleanup(); reject(new AbortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      if (timeout !== undefined && timeout > 0) {
        timeoutId = setTimeout(() => {
          if (node.settled) return;
          node.settled = true; cleanup(); reject(new TimeoutError());
        }, timeout);
      }
      const originalResolve = node.resolve;
      node.resolve = (release) => {
        if (node.settled) return;
        node.settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        originalResolve(release);
      };
    });
  }

  async run<T>(fn: () => Promise<T>, options: AcquireOptions = {}): Promise<T> {
    const release = await this.acquire(options);
    try { return await fn(); } finally { release(); }
  }

  /** Wrap async iterable with backpressure. Slot acquired before source.next(), released on subsequent next() or cleanup. */
  wrap<T>(source: AsyncIterable<T>): AsyncIterableIterator<T> {
    const gate = this, iter = source[Symbol.asyncIterator]();
    let pendingRelease: ReleaseFunction | null = null, done = false;

    const releasePending = () => { if (pendingRelease) { pendingRelease(); pendingRelease = null; } };

    return {
      async next(): Promise<IteratorResult<T>> {
        releasePending();
        if (done) return { done: true, value: undefined };
        const release = await gate.acquire();
        try {
          const result = await iter.next();
          if (result.done) { done = true; release(); return { done: true, value: result.value }; }
          pendingRelease = release;
          return { done: false, value: result.value };
        } catch (e) { release(); throw e; }
      },
      async return(value?: unknown): Promise<IteratorResult<T>> {
        releasePending(); done = true;
        return iter.return?.(value) ?? { done: true, value: undefined };
      },
      async throw(error?: unknown): Promise<IteratorResult<T>> {
        releasePending(); done = true;
        if (iter.throw) return iter.throw(error);
        throw error;
      },
      [Symbol.asyncIterator]() { return this; }
    };
  }

  private createRelease(): ReleaseFunction {
    let released = false;
    return () => {
      if (released) throw new Error('Release called twice');
      released = true; this.running--; this.dispatch();
    };
  }
  private dispatch(): void {
    if (this.running >= this.concurrency || !this.head) return;
    const node = this.dequeue();
    if (node) { this.running++; node.resolve(this.createRelease()); }
  }
  private enqueue(node: WaitNode): void {
    if (!this.tail) { this.head = this.tail = node; }
    else { node.prev = this.tail; this.tail.next = node; this.tail = node; }
  }
  private dequeue(): WaitNode | null {
    const node = this.head;
    if (!node) return null;
    this.head = node.next;
    if (!this.head) this.tail = null; else this.head.prev = null;
    node.next = null;
    return node;
  }
  private unlink(node: WaitNode): void {
    if (node.prev) node.prev.next = node.next;
    if (node.next) node.next.prev = node.prev;
    if (this.head === node) this.head = node.next;
    if (this.tail === node) this.tail = node.prev;
    node.prev = node.next = null;
  }
}
