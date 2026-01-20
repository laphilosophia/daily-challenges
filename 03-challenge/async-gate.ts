import { AsyncLocalStorage } from "node:async_hooks";

/**
 * AsyncGate - Context-aware async concurrency limiter with backpressure iteration
 *
 * INVARIANT: Every task observes the context active at SCHEDULE-TIME,
 * not the context active when it happens to run.
 *
 * Features: FIFO, cancellation, timeout, backpressure iterator, context propagation
 */

export type ReleaseFunction = () => void;
export interface AcquireOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export class TimeoutError extends Error {
  constructor() {
    super("Gate acquisition timed out");
    this.name = "TimeoutError";
  }
}

export class AbortError extends Error {
  constructor() {
    super("Gate acquisition aborted");
    this.name = "AbortError";
  }
}

interface WaitNode {
  resolve: (release: ReleaseFunction) => void;
  reject: (error: Error) => void;
  prev: WaitNode | null;
  next: WaitNode | null;
  settled: boolean;
}

/**
 * Wrapped item with context runner - allows consumer to execute in captured context
 */
export interface ContextualItem<T, C> {
  item: T;
  /** Execute function in the context that was active when this item's next() was called */
  run: <R>(fn: () => R | Promise<R>) => Promise<R>;
  /** The captured context (read-only snapshot) */
  context: C | undefined;
}

export class AsyncGate<C = unknown> {
  private readonly concurrency: number;
  private running = 0;
  private head: WaitNode | null = null;
  private tail: WaitNode | null = null;
  private readonly store: AsyncLocalStorage<C> | null;

  constructor(options: { concurrency: number; store?: AsyncLocalStorage<C> }) {
    if (options.concurrency <= 0) throw new Error("Concurrency must be > 0");
    this.concurrency = options.concurrency;
    this.store = options.store ?? null;
  }

  /**
   * Acquire a slot from the gate.
   * Does NOT capture context - use run() for context-aware execution.
   */
  async acquire(options: AcquireOptions = {}): Promise<ReleaseFunction> {
    const { timeout, signal } = options;
    if (signal?.aborted) throw new AbortError();
    if (this.running < this.concurrency) {
      this.running++;
      return this.createRelease();
    }

    return new Promise<ReleaseFunction>((resolve, reject) => {
      const node: WaitNode = {
        resolve,
        reject,
        prev: null,
        next: null,
        settled: false,
      };
      this.enqueue(node);

      let timeoutId: ReturnType<typeof setTimeout> | undefined;
      const cleanup = () => {
        this.unlink(node);
        signal?.removeEventListener("abort", onAbort);
        if (timeoutId) clearTimeout(timeoutId);
      };
      const onAbort = () => {
        if (node.settled) return;
        node.settled = true;
        cleanup();
        reject(new AbortError());
      };
      signal?.addEventListener("abort", onAbort, { once: true });

      if (timeout !== undefined && timeout > 0) {
        timeoutId = setTimeout(() => {
          if (node.settled) return;
          node.settled = true;
          cleanup();
          reject(new TimeoutError());
        }, timeout);
      }
      const originalResolve = node.resolve;
      node.resolve = (release) => {
        if (node.settled) return;
        node.settled = true;
        if (timeoutId) clearTimeout(timeoutId);
        signal?.removeEventListener("abort", onAbort);
        originalResolve(release);
      };
    });
  }

  /**
   * Execute function with automatic slot management AND context propagation.
   *
   * Context is captured BEFORE acquire (at schedule-time).
   * Context is restored BEFORE fn execution (at execution-time).
   */
  async run<T>(fn: () => Promise<T>, options: AcquireOptions = {}): Promise<T> {
    // STEP 1: Capture context at schedule-time (before any wait)
    const capturedContext = this.store?.getStore();

    // STEP 2: Acquire slot (may queue and wait)
    const release = await this.acquire(options);

    try {
      // STEP 3: Restore context and execute
      if (this.store && capturedContext !== undefined) {
        return await this.store.run(capturedContext, fn);
      }
      return await fn();
    } finally {
      release();
    }
  }

  /**
   * Wrap async iterable with backpressure AND per-iteration context capture.
   *
   * DESIGN DECISION: Per-iteration capture
   * - wrap() does NOT capture context
   * - Each next() captures context at call-time
   * - Consumer uses item.run() to execute in captured context
   */
  wrap<T>(source: AsyncIterable<T>): AsyncIterableIterator<ContextualItem<T, C>> {
    const gate = this;
    const store = this.store;
    const iter = source[Symbol.asyncIterator]();
    let pendingRelease: ReleaseFunction | null = null;
    let done = false;

    const releasePending = () => {
      if (pendingRelease) {
        pendingRelease();
        pendingRelease = null;
      }
    };

    return {
      async next(): Promise<IteratorResult<ContextualItem<T, C>>> {
        // Release slot from previous iteration (Next-Triggers-Previous-Release)
        releasePending();

        if (done) return { done: true, value: undefined };

        // STEP 1: Capture context at this next() call
        const capturedContext = store?.getStore();

        // STEP 2: Acquire slot (may queue)
        const release = await gate.acquire();

        try {
          const result = await iter.next();

          if (result.done) {
            done = true;
            release();
            return { done: true, value: result.value };
          }

          pendingRelease = release;

          // STEP 3: Create contextual item with runner
          const contextualItem: ContextualItem<T, C> = {
            item: result.value,
            context: capturedContext,
            run: async <R>(fn: () => R | Promise<R>): Promise<R> => {
              if (store && capturedContext !== undefined) {
                return store.run(capturedContext, fn);
              }
              return fn() as Promise<R>;
            },
          };

          return { done: false, value: contextualItem };
        } catch (e) {
          release();
          throw e;
        }
      },

      async return(value?: unknown): Promise<IteratorResult<ContextualItem<T, C>>> {
        releasePending();
        done = true;
        await iter.return?.(value);
        return { done: true, value: undefined };
      },

      async throw(error?: unknown): Promise<IteratorResult<ContextualItem<T, C>>> {
        releasePending();
        done = true;
        if (iter.throw) return (await iter.throw(error)) as IteratorResult<ContextualItem<T, C>>;
        throw error;
      },

      [Symbol.asyncIterator]() {
        return this;
      },
    };
  }

  private createRelease(): ReleaseFunction {
    let released = false;
    return () => {
      if (released) throw new Error("Release called twice");
      released = true;
      this.running--;
      this.dispatch();
    };
  }

  private dispatch(): void {
    if (this.running >= this.concurrency || !this.head) return;
    const node = this.dequeue();
    if (node) {
      this.running++;
      node.resolve(this.createRelease());
    }
  }

  private enqueue(node: WaitNode): void {
    if (!this.tail) {
      this.head = this.tail = node;
    } else {
      node.prev = this.tail;
      this.tail.next = node;
      this.tail = node;
    }
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
