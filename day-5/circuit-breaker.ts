/**
 * CircuitBreaker - Semantic boundary for async causality
 *
 * DESIGN DECISIONS:
 * - OPEN severs causality, not just execution
 * - Fail-before-gate: check circuit before acquiring resources
 * - Circuit overrides retry: CircuitOpenError is non-retryable
 * - Rejection is a causality event: traceable, not silent
 * - Half-open single probe: no FIFO bypass
 *
 * @module day-5/circuit-breaker
 */

// ─── Types ──────────────────────────────────────────────────────────────────

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

export interface CircuitBreakerOptions {
  /** Number of failures before opening (default: 5) */
  failureThreshold?: number;
  /** Milliseconds before attempting half-open (default: 30000) */
  resetTimeout?: number;
  /** Successes needed to close from half-open (default: 1) */
  successThreshold?: number;
  /** Predicate to determine if error counts as failure (default: all errors) */
  isFailure?: (error: unknown) => boolean;
}

export interface CircuitStats {
  state: CircuitState;
  failures: number;
  successes: number;
  lastFailureAt: number | null;
  lastStateChange: number;
  totalRejections: number;
}

// ─── Errors ─────────────────────────────────────────────────────────────────

export class CircuitOpenError extends Error {
  readonly state: CircuitState;
  readonly nextAttemptAt: number;
  readonly failures: number;

  constructor(state: CircuitState, nextAttemptAt: number, failures: number) {
    const waitMs = Math.max(0, nextAttemptAt - Date.now());
    super(`Circuit is ${state}, retry after ${waitMs}ms`);
    this.name = "CircuitOpenError";
    this.state = state;
    this.nextAttemptAt = nextAttemptAt;
    this.failures = failures;
  }
}

// ─── CircuitBreaker ─────────────────────────────────────────────────────────

export class CircuitBreaker {
  private readonly failureThreshold: number;
  private readonly resetTimeout: number;
  private readonly successThreshold: number;
  private readonly isFailure: (error: unknown) => boolean;

  private _state: CircuitState = "CLOSED";
  private failures = 0;
  private successes = 0;
  private lastFailureAt: number | null = null;
  private lastStateChange = Date.now();
  private totalRejections = 0;
  private probeInFlight = false;

  constructor(options: CircuitBreakerOptions = {}) {
    this.failureThreshold = options.failureThreshold ?? 5;
    this.resetTimeout = options.resetTimeout ?? 30000;
    this.successThreshold = options.successThreshold ?? 1;
    this.isFailure = options.isFailure ?? (() => true);

    if (this.failureThreshold < 1) {
      throw new Error("failureThreshold must be >= 1");
    }
    if (this.resetTimeout < 0) {
      throw new Error("resetTimeout must be >= 0");
    }
    if (this.successThreshold < 1) {
      throw new Error("successThreshold must be >= 1");
    }
  }

  get state(): CircuitState {
    // Check if OPEN should transition to HALF_OPEN
    if (this._state === "OPEN" && this.shouldAttemptReset()) {
      this.transitionTo("HALF_OPEN");
    }
    return this._state;
  }

  /**
   * Execute function with circuit breaker protection.
   *
   * CAUSALITY SEMANTICS:
   * - OPEN: Immediate rejection, no execution, causality severed
   * - HALF_OPEN: Single probe allowed, others rejected
   * - CLOSED: Normal execution with failure tracking
   */
  async run<T>(fn: () => Promise<T>): Promise<T> {
    const currentState = this.state; // Triggers OPEN → HALF_OPEN if needed

    // ─── OPEN: Causality severed ────────────────────────────────────
    if (currentState === "OPEN") {
      this.totalRejections++;
      throw new CircuitOpenError(
        currentState,
        this.lastFailureAt! + this.resetTimeout,
        this.failures
      );
    }

    // ─── HALF_OPEN: Single probe gate ───────────────────────────────
    if (currentState === "HALF_OPEN") {
      if (this.probeInFlight) {
        // Another probe is already testing, reject this one
        this.totalRejections++;
        throw new CircuitOpenError(
          currentState,
          this.lastFailureAt! + this.resetTimeout,
          this.failures
        );
      }
      this.probeInFlight = true;
    }

    // ─── Execute with tracking ──────────────────────────────────────
    try {
      const result = await fn();
      this.onSuccess();
      return result;
    } catch (error) {
      this.onFailure(error);
      throw error;
    } finally {
      if (currentState === "HALF_OPEN") {
        this.probeInFlight = false;
      }
    }
  }

  /**
   * Get current circuit statistics.
   * Useful for observability and debugging.
   */
  getStats(): CircuitStats {
    return {
      state: this.state,
      failures: this.failures,
      successes: this.successes,
      lastFailureAt: this.lastFailureAt,
      lastStateChange: this.lastStateChange,
      totalRejections: this.totalRejections,
    };
  }

  /**
   * Force circuit to specific state (testing/admin only).
   */
  forceState(state: CircuitState): void {
    this.transitionTo(state);
    if (state === "CLOSED") {
      this.failures = 0;
      this.successes = 0;
    }
  }

  // ─── Private ──────────────────────────────────────────────────────

  private onSuccess(): void {
    if (this._state === "CLOSED") {
      // Reset failure count on success in CLOSED state
      this.failures = 0;
      this.successes++;
    } else if (this._state === "HALF_OPEN") {
      this.successes++;
      if (this.successes >= this.successThreshold) {
        this.transitionTo("CLOSED");
        this.failures = 0;
        this.successes = 0;
      }
    }
  }

  private onFailure(error: unknown): void {
    // Check if this error counts as a circuit failure
    if (!this.isFailure(error)) {
      return;
    }

    this.lastFailureAt = Date.now();

    if (this._state === "CLOSED") {
      this.failures++;
      if (this.failures >= this.failureThreshold) {
        this.transitionTo("OPEN");
      }
    } else if (this._state === "HALF_OPEN") {
      // Probe failed, back to OPEN
      this.transitionTo("OPEN");
      this.successes = 0;
    }
  }

  private shouldAttemptReset(): boolean {
    if (this.lastFailureAt === null) return false;
    return Date.now() >= this.lastFailureAt + this.resetTimeout;
  }

  private transitionTo(state: CircuitState): void {
    if (this._state === state) return;
    this._state = state;
    this.lastStateChange = Date.now();
  }
}

// ─── Factory ────────────────────────────────────────────────────────────────

export function createCircuitBreaker(
  options?: CircuitBreakerOptions
): CircuitBreaker {
  return new CircuitBreaker(options);
}

// ─── Composition Helpers ────────────────────────────────────────────────────

/**
 * Type guard to identify CircuitOpenError.
 * Use in retry's isRetryable predicate.
 */
export function isCircuitOpenError(error: unknown): error is CircuitOpenError {
  return error instanceof CircuitOpenError;
}

/**
 * Default isRetryable that excludes circuit rejections.
 * Pass to Retrier to respect circuit decisions.
 */
export function respectCircuit(error: unknown): boolean {
  return !isCircuitOpenError(error);
}
