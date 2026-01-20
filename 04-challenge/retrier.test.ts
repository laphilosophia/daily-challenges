/**
 * Retrier Test Suite
 *
 * Tests for derived causality, gate composition, and retry semantics.
 */

import assert from "node:assert";
import { AsyncLocalStorage } from "node:async_hooks";
import {
  createRetrier,
  RetryAbortedError,
  RetryExhaustedError,
  retryWithGate
} from "./retrier.js";

// ─── Test Utilities ─────────────────────────────────────────────────────────

interface TraceContext {
  traceId: string;
  attemptId?: string;
  attempt?: number;
}

const store = new AsyncLocalStorage<TraceContext>();

function createTestRetrier(options?: {
  maxAttempts?: number;
  baseDelay?: number;
}) {
  return createRetrier(store, {
    maxAttempts: options?.maxAttempts ?? 3,
    baseDelay: options?.baseDelay ?? 10, // Fast for tests
    maxDelay: 100,
    jitter: 0, // Deterministic for tests
    deriveContext: (parent, retryCtx) => ({
      ...parent,
      attemptId: `${parent.traceId}.${retryCtx.attempt}`,
      attempt: retryCtx.attempt,
    }),
  });
}

// Minimal AsyncGate mock for testing
class MockAsyncGate {
  private running = 0;
  private readonly concurrency: number;
  private queue: Array<{
    resolve: (release: () => void) => void;
    reject: (error: Error) => void;
  }> = [];

  constructor(concurrency: number) {
    this.concurrency = concurrency;
  }

  async acquire(options?: { signal?: AbortSignal }): Promise<() => void> {
    if (options?.signal?.aborted) {
      throw new Error("Aborted");
    }

    if (this.running < this.concurrency) {
      this.running++;
      return this.createRelease();
    }

    return new Promise((resolve, reject) => {
      this.queue.push({ resolve, reject });
    });
  }

  private createRelease(): () => void {
    let released = false;
    return () => {
      if (released) throw new Error("Double release");
      released = true;
      this.running--;
      this.dispatch();
    };
  }

  private dispatch() {
    if (this.running >= this.concurrency || this.queue.length === 0) return;
    const waiter = this.queue.shift()!;
    this.running++;
    waiter.resolve(this.createRelease());
  }

  get runningCount() {
    return this.running;
  }

  get queueLength() {
    return this.queue.length;
  }
}

// ─── Tests ──────────────────────────────────────────────────────────────────

const tests: Array<{ name: string; fn: () => Promise<void> }> = [];
function test(name: string, fn: () => Promise<void>) {
  tests.push({ name, fn });
}

// ─── Derived Context Tests ──────────────────────────────────────────────────

test("derives unique context per attempt", async () => {
  const retrier = createTestRetrier({ maxAttempts: 3 });
  const observedContexts: TraceContext[] = [];
  let callCount = 0;

  await store.run({ traceId: "test-1" }, async () => {
    await retrier.run(async () => {
      const ctx = store.getStore()!;
      observedContexts.push({ ...ctx });
      callCount++;
      if (callCount < 3) throw new Error("Fail");
    });
  });

  assert.strictEqual(observedContexts.length, 3);
  assert.strictEqual(observedContexts[0].attemptId, "test-1.1");
  assert.strictEqual(observedContexts[1].attemptId, "test-1.2");
  assert.strictEqual(observedContexts[2].attemptId, "test-1.3");
  assert.strictEqual(observedContexts[0].attempt, 1);
  assert.strictEqual(observedContexts[1].attempt, 2);
  assert.strictEqual(observedContexts[2].attempt, 3);
});

test("preserves parent traceId across all attempts", async () => {
  const retrier = createTestRetrier({ maxAttempts: 3 });
  const traceIds: string[] = [];
  let callCount = 0;

  await store.run({ traceId: "parent-trace" }, async () => {
    await retrier.run(async () => {
      traceIds.push(store.getStore()!.traceId);
      callCount++;
      if (callCount < 2) throw new Error("Fail");
    });
  });

  assert.strictEqual(traceIds.length, 2);
  assert.ok(traceIds.every((id) => id === "parent-trace"));
});

// ─── Success/Failure Tests ──────────────────────────────────────────────────

test("returns immediately on first success", async () => {
  const retrier = createTestRetrier();
  let callCount = 0;

  const result = await store.run({ traceId: "success" }, async () => {
    return retrier.run(async () => {
      callCount++;
      return "ok";
    });
  });

  assert.strictEqual(result, "ok");
  assert.strictEqual(callCount, 1);
});

test("retries on failure and succeeds", async () => {
  const retrier = createTestRetrier({ maxAttempts: 3 });
  let callCount = 0;

  const result = await store.run({ traceId: "retry-success" }, async () => {
    return retrier.run(async () => {
      callCount++;
      if (callCount < 2) throw new Error("Transient");
      return "recovered";
    });
  });

  assert.strictEqual(result, "recovered");
  assert.strictEqual(callCount, 2);
});

test("throws RetryExhaustedError after max attempts", async () => {
  const retrier = createTestRetrier({ maxAttempts: 3 });
  let callCount = 0;

  try {
    await store.run({ traceId: "exhaust" }, async () => {
      return retrier.run(async () => {
        callCount++;
        throw new Error("Always fail");
      });
    });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof RetryExhaustedError);
    assert.strictEqual(error.attempts, 3);
    assert.strictEqual(callCount, 3);
  }
});

// ─── Cancellation Tests ─────────────────────────────────────────────────────

test("aborts immediately when signal is already aborted", async () => {
  const retrier = createTestRetrier();
  const controller = new AbortController();
  controller.abort();

  try {
    await store.run({ traceId: "pre-abort" }, async () => {
      return retrier.run(async () => "should not run", {
        signal: controller.signal,
      });
    });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof RetryAbortedError);
    assert.strictEqual(error.phase, "execution");
  }
});

test("aborts during backoff", async () => {
  const retrier = createRetrier(store, {
    maxAttempts: 3,
    baseDelay: 1000, // Long delay to test abort
    jitter: 0,
  });
  const controller = new AbortController();
  let callCount = 0;

  setTimeout(() => controller.abort(), 50);

  try {
    await store.run({ traceId: "backoff-abort" }, async () => {
      return retrier.run(
        async () => {
          callCount++;
          throw new Error("Fail");
        },
        { signal: controller.signal }
      );
    });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof RetryAbortedError);
    assert.strictEqual(error.phase, "backoff");
    assert.strictEqual(callCount, 1);
  }
});

// ─── Gate Composition Tests ─────────────────────────────────────────────────

test("holds gate slot during entire retry sequence", async () => {
  const retrier = createTestRetrier({ maxAttempts: 3, baseDelay: 10 });
  const gate = new MockAsyncGate(1);
  let callCount = 0;
  const slotStateDuringCalls: number[] = [];

  await store.run({ traceId: "gate-hold" }, async () => {
    await retryWithGate(retrier, gate, async () => {
      callCount++;
      slotStateDuringCalls.push(gate.runningCount);
      if (callCount < 3) throw new Error("Fail");
    });
  });

  assert.strictEqual(callCount, 3);
  // Slot should be held (running=1) during all attempts
  assert.ok(slotStateDuringCalls.every((count) => count === 1));
  // Slot should be released after
  assert.strictEqual(gate.runningCount, 0);
});

test("releases gate slot on exhaustion", async () => {
  const retrier = createTestRetrier({ maxAttempts: 2, baseDelay: 5 });
  const gate = new MockAsyncGate(1);

  try {
    await store.run({ traceId: "gate-exhaust" }, async () => {
      await retryWithGate(retrier, gate, async () => {
        throw new Error("Always fail");
      });
    });
  } catch {
    // Expected
  }

  assert.strictEqual(gate.runningCount, 0);
});

test("releases gate slot on abort", async () => {
  const retrier = createRetrier(store, {
    maxAttempts: 3,
    baseDelay: 500,
    jitter: 0,
  });
  const gate = new MockAsyncGate(1);
  const controller = new AbortController();

  setTimeout(() => controller.abort(), 50);

  try {
    await store.run({ traceId: "gate-abort" }, async () => {
      await retryWithGate(
        retrier,
        gate,
        async () => {
          throw new Error("Fail");
        },
        { signal: controller.signal }
      );
    });
  } catch {
    // Expected
  }

  assert.strictEqual(gate.runningCount, 0);
});

// ─── Backoff Timing Tests ───────────────────────────────────────────────────

test("applies exponential backoff between attempts", async () => {
  const baseDelay = 50;
  const retrier = createRetrier(store, {
    maxAttempts: 4,
    baseDelay,
    jitter: 0,
  });
  const timestamps: number[] = [];

  try {
    await store.run({ traceId: "backoff-timing" }, async () => {
      return retrier.run(async () => {
        timestamps.push(Date.now());
        throw new Error("Fail");
      });
    });
  } catch {
    // Expected
  }

  assert.strictEqual(timestamps.length, 4);

  // Expected delays: 50, 100, 200 (exponential)
  const delay1 = timestamps[1] - timestamps[0];
  const delay2 = timestamps[2] - timestamps[1];
  const delay3 = timestamps[3] - timestamps[2];

  // Allow 20ms tolerance for timing
  assert.ok(delay1 >= 40 && delay1 <= 70, `delay1=${delay1}`);
  assert.ok(delay2 >= 90 && delay2 <= 120, `delay2=${delay2}`);
  assert.ok(delay3 >= 190 && delay3 <= 220, `delay3=${delay3}`);
});

// ─── isRetryable Tests ──────────────────────────────────────────────────────

test("respects isRetryable predicate", async () => {
  const retrier = createRetrier(store, {
    maxAttempts: 3,
    baseDelay: 10,
    isRetryable: (error) => {
      return error instanceof Error && error.message !== "Fatal";
    },
  });
  let callCount = 0;

  try {
    await store.run({ traceId: "non-retryable" }, async () => {
      return retrier.run(async () => {
        callCount++;
        throw new Error("Fatal");
      });
    });
    assert.fail("Should have thrown");
  } catch (error) {
    assert.ok(error instanceof Error);
    assert.strictEqual(error.message, "Fatal");
    assert.strictEqual(callCount, 1); // No retry attempted
  }
});

// ─── No Context Tests ───────────────────────────────────────────────────────

test("works without parent context", async () => {
  const retrier = createTestRetrier();
  let callCount = 0;

  // No store.run() wrapper - no parent context
  const result = await retrier.run(async () => {
    callCount++;
    if (callCount < 2) throw new Error("Fail");
    return "ok";
  });

  assert.strictEqual(result, "ok");
  assert.strictEqual(callCount, 2);
});

// ─── Test Runner ────────────────────────────────────────────────────────────

async function runTests() {
  console.log("\n🧪 Retrier Test Suite\n");
  console.log("─".repeat(60));

  let passed = 0;
  let failed = 0;

  for (const { name, fn } of tests) {
    try {
      await fn();
      console.log(`  ✓ ${name}`);
      passed++;
    } catch (error) {
      console.log(`  ✗ ${name}`);
      console.log(`    ${error instanceof Error ? error.message : error}`);
      failed++;
    }
  }

  console.log("─".repeat(60));
  console.log(`\n  ${passed} passed, ${failed} failed\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch(console.error);
