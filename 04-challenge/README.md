# Day-04: Retry Semantics Under Preserved Causality

> **Retry is where systems quietly lie. This challenge forces them to tell the truth.**

## Problem

Retry mechanisms are often treated as operational details:
- exponential backoff
- max attempts
- jitter

But in async systems, retry directly affects **causality**.

> When a task is retried: **is it the same work continuing, or is new work being born?**

Without answering this question, context propagation, observability, gate fairness, and backpressure cannot be consistent.

---

## Design Decisions

| Decision | Choice | Trade-off |
|----------|--------|-----------|
| **Causality Model** | Derived (Parent/Child) | Every attempt gets unique ID, traces stay linked |
| **Gate Slot Strategy** | Hold During Backoff | FIFO preserved, but throughput reduced |
| **Context Capture** | Schedule-time | Captured once at initial call, not per-attempt |
| **Context Derivation** | Execution-time | Each attempt derives child from captured parent |

---

## Derived Causality Model

```
Parent Context (captured at schedule-time)
│   traceId: "abc"
│
├── Attempt 1 (derived at execution-time)
│   traceId: "abc", attemptId: "abc.1", attempt: 1
│   └── FAIL → backoff
│
├── Attempt 2 (derived at execution-time)
│   traceId: "abc", attemptId: "abc.2", attempt: 2
│   └── FAIL → backoff
│
└── Attempt 3 (derived at execution-time)
    traceId: "abc", attemptId: "abc.3", attempt: 3
    └── SUCCESS
```

### Invariants

1. **Trace Continuity**: All attempts share same `traceId`
2. **Attempt Distinctness**: Each attempt has unique `attemptId`
3. **Capture-Once**: Parent context captured at initial schedule, not re-captured
4. **Derive-Per-Attempt**: Child context derived fresh for each execution

---

## Hold-Slot-During-Backoff Strategy

```
Gate (concurrency: 2)

t=0:     [Task A] [Retry Task (attempt 1)]
          running   FAIL, starts backoff

t=50:    [Task A] [████ HELD - backoff ████]
          running   waiting, slot NOT released
                    ⚠️ New tasks queue behind

t=100:   [--free] [Retry Task (attempt 2)]
          A done    executing again
```

### Why Hold?

**Release-and-reacquire breaks FIFO causality:**

```
⚠️ Anti-Pattern:

t=0:   [Task A] [Retry] → Retry fails, releases slot
t=1:   [Task A] [Task B] → Task B jumps queue!
t=100: [Task A] [Task B] → Retry re-acquires, waits
```

---

## Risks Avoided

This implementation explicitly guards against common retry bugs:

| Risk | How Avoided |
|------|-------------|
| **Slot release during backoff** | `retryWithGate` acquires once, releases only in `finally` |
| **Wrong capture timing** | Parent captured at function entry, before any await |
| **Context restore after abort** | Abort throws immediately, no restore attempted |
| **Gate invariant weakening** | Single `try/finally` block, no nested release paths |

---

## API

### Basic Usage

```ts
import { AsyncLocalStorage } from "node:async_hooks";
import { createRetrier } from "./retrier.js";

interface TraceContext {
  traceId: string;
  attemptId?: string;
  attempt?: number;
}

const store = new AsyncLocalStorage<TraceContext>();

const retrier = createRetrier(store, {
  maxAttempts: 3,
  baseDelay: 100,
  deriveContext: (parent, retryCtx) => ({
    ...parent,
    attemptId: `${parent.traceId}.${retryCtx.attempt}`,
    attempt: retryCtx.attempt,
  }),
});

await store.run({ traceId: "abc" }, async () => {
  const result = await retrier.run(async () => {
    const ctx = store.getStore();
    console.log(ctx?.attemptId); // "abc.1", "abc.2", "abc.3"
    return await doWork();
  });
});
```

### With Gate (Hold-Slot Strategy)

```ts
import { AsyncGate } from "../day-3/async-gate.js";
import { retryWithGate, createRetrier } from "./retrier.js";

const gate = new AsyncGate({ concurrency: 5, store });

await store.run({ traceId: "abc" }, async () => {
  // Slot acquired ONCE, held through all retries + backoffs
  await retryWithGate(retrier, gate, async () => {
    return await doWork();
  });
});
```

### Cancellation

```ts
const controller = new AbortController();

// Cancel after 5 seconds
setTimeout(() => controller.abort(), 5000);

try {
  await retrier.run(async () => doWork(), {
    signal: controller.signal,
  });
} catch (error) {
  if (error instanceof RetryAbortedError) {
    console.log(`Aborted during ${error.phase} at attempt ${error.attempt}`);
  }
}
```

---

## Exponential Backoff

```
Attempt 1: baseDelay * 2^0 = 100ms
Attempt 2: baseDelay * 2^1 = 200ms
Attempt 3: baseDelay * 2^2 = 400ms
Attempt 4: baseDelay * 2^3 = 800ms
...
Capped at maxDelay (default: 10000ms)
Jitter: ±10% randomness to prevent thundering herd
```

---

## Explicit Non-Guarantees

> **These guarantees are intentionally NOT provided:**

| Non-Guarantee | Reason |
|---------------|--------|
| Fair Scheduling | Holding slot during backoff starves waiting tasks |
| Throughput Optimization | Trade-off: fairness > throughput |
| Partial Success Tracking | No attempt history kept after completion |
| Cross-Gate Coordination | Each gate is independent |
| Distributed Retry | Single-process only |

---

## Starvation Risk

With hold-slot strategy, long backoffs can starve other tasks:

```
Gate: concurrency=2
Task B: retries 3x with 1s backoff each

t=0:    [A] [B-attempt-1]
t=100:  [A] [B-backoff ███████] ← 1s hold, new tasks wait
t=1100: [A] [B-attempt-2]
t=1200: [A] [B-backoff ███████] ← another 1s hold
...

⚠️ Tasks C, D, E queue indefinitely
```

### Mitigation

1. Keep `maxDelay` reasonable (e.g., 10s not 60s)
2. Use jitter to spread retry storms
3. Consider circuit breaker for high-failure scenarios
4. Monitor queue depth as health signal

---

## Composition

| Day | Primitive | Composability |
|-----|-----------|---------------|
| Day-01 | `AsyncGate` | `retryWithGate()` holds slot during retry sequence |
| Day-02 | Backpressure Iterator | Use `retrier.run()` inside `for await` body |
| Day-03 | `ContextCarrier` | Automatic: Retrier captures context at schedule-time |

---

## Running Tests

```bash
npx tsx retrier.test.ts
```

---

## Why This Is Day-04

- **Day-01 (Capacity)**: How much work can we handle?
- **Day-02 (Rate)**: How fast should we pull work?
- **Day-03 (Meaning)**: What does this work signify?
- **Day-04 (Continuity)**: How does work survive failure?

Retry is where systems quietly lie. This implementation forces them to tell the truth.
