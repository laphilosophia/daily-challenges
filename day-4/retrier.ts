/**
 * Retrier - Retry semantics with preserved causality
 *
 * DESIGN DECISIONS:
 * - Derived Causality: Each attempt gets unique child context derived from parent
 * - Hold-Slot-During-Backoff: Gate slot held through entire retry sequence
 * - Context captured at schedule-time, derived at each execution-time
 *
 * @module day-4/retrier
 */

import { AsyncLocalStorage } from "node:async_hooks";

// ─── Types ──────────────────────────────────────────────────────────────────

export interface RetryContext {
  /** Current attempt number (1-indexed) */
  attempt: number;
  /** Maximum attempts allowed */
  maxAttempts: number;
  /** Whether this is the final attempt */
  isFinal: boolean;
}

export type ContextDeriver<C> = (parent: C, retryCtx: RetryContext) => C;

export interface RetrierOptions<C> {
  /** Maximum retry attempts (default: 3) */
  maxAttempts?: number;
  /** Base delay in ms for exponential backoff (default: 100) */
  baseDelay?: number;
  /** Maximum delay cap in ms (default: 10000) */
  maxDelay?: number;
  /** Jitter factor 0-1 (default: 0.1) */
  jitter?: number;
  /** Abort signal for cancellation */
  signal?: AbortSignal;
  /** Function to derive child context from parent */
  deriveContext?: ContextDeriver<C>;
  /** Predicate to determine if error is retryable (default: all errors) */
  isRetryable?: (error: unknown) => boolean;
}

export interface RunOptions {
  signal?: AbortSignal;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class RetryExhaustedError extends Error {
  readonly attempts: number;
  readonly lastError: unknown;

  constructor(attempts: number, lastError: unknown) {
    const message = lastError instanceof Error ? lastError.message : String(lastError);
    super(`Retry exhausted after ${attempts} attempts: ${message}`);
    this.name = "RetryExhaustedError";
    this.attempts = attempts;
    this.lastError = lastError;
  }
}

export class RetryAbortedError extends Error {
  readonly attempt: number;
  readonly phase: "backoff" | "execution";

  constructor(attempt: number, phase: "backoff" | "execution") {
    super(`Retry aborted during ${phase} at attempt ${attempt}`);
    this.name = "RetryAbortedError";
    this.attempt = attempt;
    this.phase = phase;
  }
}

// ─── Helpers ────────────────────────────────────────────────────────────────

function calculateDelay(
  attempt: number,
  baseDelay: number,
  maxDelay: number,
  jitter: number
): number {
  // Exponential: baseDelay * 2^(attempt-1)
  const exponential = baseDelay * Math.pow(2, attempt - 1);

  // Cap at maxDelay
  const capped = Math.min(exponential, maxDelay);

  // Add jitter: ±jitter% randomness
  const jitterRange = capped * jitter;
  const jitterValue = (Math.random() * 2 - 1) * jitterRange;

  return Math.max(0, Math.round(capped + jitterValue));
}

function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal?.aborted) {
      reject(signal.reason ?? new Error("Aborted"));
      return;
    }

    const timeoutId = setTimeout(resolve, ms);

    const onAbort = () => {
      clearTimeout(timeoutId);
      reject(signal!.reason ?? new Error("Aborted"));
    };

    signal?.addEventListener("abort", onAbort, { once: true });
  });
}

// ─── Retrier ────────────────────────────────────────────────────────────────

export class Retrier<C = unknown> {
  private readonly store: AsyncLocalStorage<C>;
  private readonly maxAttempts: number;
  private readonly baseDelay: number;
  private readonly maxDelay: number;
  private readonly jitter: number;
  private readonly deriveContext: ContextDeriver<C> | null;
  private readonly isRetryable: (error: unknown) => boolean;

  constructor(store: AsyncLocalStorage<C>, options: RetrierOptions<C> = {}) {
    this.store = store;
    this.maxAttempts = options.maxAttempts ?? 3;
    this.baseDelay = options.baseDelay ?? 100;
    this.maxDelay = options.maxDelay ?? 10000;
    this.jitter = Math.max(0, Math.min(1, options.jitter ?? 0.1));
    this.deriveContext = options.deriveContext ?? null;
    this.isRetryable = options.isRetryable ?? (() => true);

    if (this.maxAttempts < 1) {
      throw new Error("maxAttempts must be >= 1");
    }
  }

  /**
   * Execute function with retry semantics.
   *
   * Context Flow:
   * 1. Parent context captured at schedule-time (this call)
   * 2. Child context derived at each attempt execution-time
   * 3. fn() runs in derived child context
   */
  async run<T>(fn: () => Promise<T>, options: RunOptions = {}): Promise<T> {
    const { signal } = options;

    // STEP 1: Capture parent context at schedule-time
    const parentContext = this.store.getStore();

    let lastError: unknown;

    for (let attempt = 1; attempt <= this.maxAttempts; attempt++) {
      // Check abort before each attempt
      if (signal?.aborted) {
        throw new RetryAbortedError(attempt, "execution");
      }

      const retryCtx: RetryContext = {
        attempt,
        maxAttempts: this.maxAttempts,
        isFinal: attempt === this.maxAttempts,
      };

      try {
        // STEP 2: Derive child context for this attempt
        const childContext =
          parentContext !== undefined && this.deriveContext
            ? this.deriveContext(parentContext, retryCtx)
            : parentContext;

        // STEP 3: Execute in derived context
        const result =
          childContext !== undefined
            ? await this.store.run(childContext, fn)
            : await fn();

        return result;
      } catch (error) {
        lastError = error;

        // Don't retry if error is not retryable
        if (!this.isRetryable(error)) {
          throw error;
        }

        // Don't retry if this was the final attempt
        if (attempt === this.maxAttempts) {
          break;
        }

        // Calculate backoff delay
        const delay = calculateDelay(
          attempt,
          this.baseDelay,
          this.maxDelay,
          this.jitter
        );

        // STEP 4: Wait (slot held during this time if using withGate)
        try {
          await sleep(delay, signal);
        } catch {
          throw new RetryAbortedError(attempt, "backoff");
        }
      }
    }

    throw new RetryExhaustedError(this.maxAttempts, lastError);
  }
}

// ─── Gate Composition ───────────────────────────────────────────────────────

export interface AcquireOptions {
  timeout?: number;
  signal?: AbortSignal;
}

export interface AsyncGateLike<C = unknown> {
  acquire(options?: AcquireOptions): Promise<() => void>;
}

/**
 * Execute retry sequence with gate slot held throughout.
 *
 * CRITICAL: Gate slot is acquired ONCE at the start,
 * held through all backoffs, released only on success/exhaustion.
 *
 * This preserves FIFO ordering - the retry task does not
 * "jump the queue" by releasing and re-acquiring.
 */
export async function retryWithGate<T, C>(
  retrier: Retrier<C>,
  gate: AsyncGateLike<C>,
  fn: () => Promise<T>,
  options: AcquireOptions & RunOptions = {}
): Promise<T> {
  const { timeout, signal } = options;

  // STEP 1: Acquire slot ONCE (may queue)
  const release = await gate.acquire({ timeout, signal });

  try {
    // STEP 2: Run entire retry sequence while holding slot
    return await retrier.run(fn, { signal });
  } finally {
    // STEP 3: Release slot only after success or exhaustion
    release();
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createRetrier<C>(
  store: AsyncLocalStorage<C>,
  options?: RetrierOptions<C>
): Retrier<C> {
  return new Retrier(store, options);
}
