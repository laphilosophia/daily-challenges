/**
 * AsyncGate - Production-grade async concurrency limiter
 * Features: FIFO ordering, cancellation, timeout | No external deps
 */

export type ReleaseFunction = () => void;
export interface AcquireOptions { timeout?: number; signal?: AbortSignal; }

export class TimeoutError extends Error {
  constructor() { super('Gate acquisition timed out'); this.name = 'TimeoutError'; }
}
export class AbortError extends Error {
  constructor() { super('Gate acquisition aborted'); this.name = 'AbortError'; }
}

// Intrusive Linked-List Node
interface WaitNode {
  resolve: (release: ReleaseFunction) => void;
  reject: (error: Error) => void;
  prev: WaitNode | null;
  next: WaitNode | null;
  settled: boolean; // Single-shot guard against resolve/reject race
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

  /** Acquire a slot. Returns a release function that MUST be called. */
  async acquire(options: AcquireOptions = {}): Promise<ReleaseFunction> {
    const { timeout, signal } = options;

    // Fast path: already aborted
    if (signal?.aborted) throw new AbortError();

    // Fast path: slot available
    if (this.running < this.concurrency) {
      this.running++;
      return this.createRelease();
    }

    // Slow path: wait in queue
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
        if (node.settled) return; // Guard: already resolved/rejected
        node.settled = true;
        cleanup();
        reject(new AbortError());
      };
      signal?.addEventListener('abort', onAbort, { once: true });

      if (timeout !== undefined && timeout > 0) {
        timeoutId = setTimeout(() => {
          if (node.settled) return; // Guard: already resolved/rejected
          node.settled = true;
          cleanup();
          reject(new TimeoutError());
        }, timeout);
      }

      // Wrap resolve to clear timers and set settled
      const originalResolve = node.resolve;
      node.resolve = (release) => {
        if (node.settled) return; // Guard: already timed out or aborted
        node.settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener('abort', onAbort);
        originalResolve(release);
      };
    });
  }

  /** Run a task with automatic release */
  async run<T>(fn: () => Promise<T>, options: AcquireOptions = {}): Promise<T> {
    const release = await this.acquire(options);
    try { return await fn(); }
    finally { release(); }
  }

  // ─── Private ───────────────────────────────────────────────

  private createRelease(): ReleaseFunction {
    let released = false;
    return () => {
      if (released) throw new Error('Release called twice - this is a bug');
      released = true;
      this.running--;
      this.dispatch();
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
    if (!this.head) this.tail = null;
    else this.head.prev = null;
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
