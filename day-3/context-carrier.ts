import { AsyncLocalStorage } from "node:async_hooks";

/**
 * ContextCarrier — Schedule-time context preservation primitive
 *
 * Captures async context at construction time.
 * Restores that context when run() is called.
 *
 * Single-shot: run() can only be called once.
 * No global state: only knows about the store passed to it.
 */
export class ContextCarrier<T, C> {
  private readonly capturedContext: C | undefined;
  private readonly fn: () => Promise<T>;
  private readonly store: AsyncLocalStorage<C>;
  private executed = false;

  constructor(fn: () => Promise<T>, store: AsyncLocalStorage<C>) {
    this.fn = fn;
    this.store = store;
    // Capture context at construction (schedule-time)
    this.capturedContext = store.getStore();
  }

  /**
   * Execute the wrapped function in the captured context.
   *
   * @throws Error if called more than once
   * @returns Promise resolving to fn's return value
   */
  async run(): Promise<T> {
    if (this.executed) {
      throw new Error("ContextCarrier is single-shot: run() already called");
    }
    this.executed = true;

    // If no context was captured, run without restoration
    if (this.capturedContext === undefined) {
      return this.fn();
    }

    // Restore captured context and execute
    return this.store.run(this.capturedContext, this.fn);
  }

  /**
   * Check if this carrier has already been executed.
   */
  get isExecuted(): boolean {
    return this.executed;
  }

  /**
   * Check if context was captured (store had active context at construction).
   */
  get hasContext(): boolean {
    return this.capturedContext !== undefined;
  }
}

/**
 * Factory function for cleaner API
 */
export function captureContext<T, C>(
  store: AsyncLocalStorage<C>,
  fn: () => Promise<T>
): ContextCarrier<T, C> {
  return new ContextCarrier(fn, store);
}
