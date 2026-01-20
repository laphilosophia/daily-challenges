# Day-04 Design Notes

## Locked Design Decisions

### 1. Causality Model: Derived (Parent/Child)

**Decision:** Each retry attempt gets a unique derived context, all sharing the same parent trace.

```ts
// Parent: { traceId: "abc" }
// Attempt 1: { traceId: "abc", attemptId: "abc.1", attempt: 1 }
// Attempt 2: { traceId: "abc", attemptId: "abc.2", attempt: 2 }
```

**Rationale:**
- Observability: Each attempt is distinctly traceable
- Causality: Parent-child relationship explicit
- Debugging: Failed attempts have unique IDs for log correlation

**Alternatives Considered:**
- Same context (idempotent): Would hide retry attempts in traces
- New context per attempt: Would break causality chain

---

### 2. Gate Slot Strategy: Hold During Backoff

**Decision:** Gate slot acquired once, held through entire retry sequence including backoff delays.

```
t=0:   [Slot acquired] → attempt 1 fails
t=50:  [████ SLOT HELD ████] → backoff sleep
t=100: [Slot still held] → attempt 2 runs
```

**Rationale:**
- FIFO Preserved: No queue-jumping from release-and-reacquire
- Predictable Ordering: Tasks complete in submission order
- Trade-off: Throughput reduced during long backoffs

**Why NOT Release-and-Reacquire:**
```
⚠️ Anti-Pattern:
t=0:   [A] [B-retry] → B fails, releases slot
t=1:   [A] [C]       → C jumps queue!
t=100: [A] [C]       → B re-acquires, waits behind C
```

---

### 3. Context Capture Point: Schedule-Time (Once)

**Decision:** Parent context captured at initial `retrier.run()` call, not re-captured per attempt.

```ts
store.run({ traceId: "abc" }, async () => {
  // Context captured HERE, once
  await retrier.run(async () => {
    // Derived context used here
  });
});
```

**Rationale:**
- Single Source of Truth: Parent is always the original caller's context
- No Drift: Context doesn't change if external context changes during retries
- Matches Day-03 ContextCarrier Pattern: Capture at schedule, restore at execution

---

### 4. Context Derivation Point: Execution-Time (Per Attempt)

**Decision:** Child context derived fresh for each attempt, using captured parent + attempt number.

```ts
deriveContext: (parent, retryCtx) => ({
  ...parent,
  attemptId: `${parent.traceId}.${retryCtx.attempt}`,
  attempt: retryCtx.attempt,
})
```

**Rationale:**
- Each attempt has current attempt number
- `isFinal` flag available for last-chance logic
- Parent data preserved, not mutated

---

### 5. Backoff Formula: Exponential with Jitter

```ts
delay = min(baseDelay * 2^(attempt-1), maxDelay) ± jitter%
```

**Defaults:**
- `baseDelay`: 100ms
- `maxDelay`: 10000ms
- `jitter`: 0.1 (±10%)

**Rationale:**
- Exponential: Gives systems time to recover
- Capped: Prevents infinite waits
- Jitter: Prevents thundering herd on shared resources

---

## Risks Explicitly Avoided

| Risk | Design Choice |
|------|---------------|
| Slot release during backoff | `retryWithGate` uses single `try/finally`, releases only at end |
| Wrong capture timing | Parent captured at function entry, before any await |
| Context restore after abort | `RetryAbortedError` thrown immediately, no restore |
| Gate invariant weakening | No nested release paths, single ownership model |

---

## Explicitly NOT Guaranteed (Non-Goals)

> **⚠️ CRITICAL: These are intentional design boundaries**

1. **Fair Scheduling** — Hold-slot starves waiting tasks during backoff
2. **Throughput Optimization** — Trade-off: fairness > throughput
3. **Partial Success Tracking** — No attempt history after completion
4. **Cross-Gate Coordination** — Each gate is independent
5. **Distributed Retry** — Single-process only
6. **Priority Queues** — FIFO only, no priority override

---

## Starvation Risk Analysis

```
Scenario: Aggressive retry with long backoff

Gate: concurrency=2
Task B: 3 retries × 1s backoff = 3s slot hold

Timeline:
t=0:    [A] [B-attempt-1]
t=100:  [A] [B-backoff ███] ← 1s
t=1100: [A] [B-attempt-2]
t=1200: [A] [B-backoff ███] ← 1s
t=2200: [A] [B-attempt-3]
...

⚠️ Tasks C, D, E blocked for 3+ seconds
```

**Mitigations (caller responsibility):**
1. Reasonable `maxDelay` (seconds, not minutes)
2. Enable jitter to spread load
3. Circuit breaker for high-failure scenarios
4. Queue depth monitoring

---

## Composition Matrix

| Primitive | Composition Method |
|-----------|-------------------|
| Day-01 AsyncGate | `retryWithGate(retrier, gate, fn)` |
| Day-02 Backpressure Iterator | Use `retrier.run()` inside `for await` body |
| Day-03 ContextCarrier | Automatic: Retrier uses same capture-at-schedule pattern |

---

## Cancellation Semantics

### During Backoff Sleep

```
t=0:   Attempt 1 fails
t=10:  Backoff starts (sleeping 100ms)
t=50:  signal.abort() called
t=50:  ⚡ RetryAbortedError { phase: "backoff", attempt: 1 }
       └─ Gate slot released (if using retryWithGate)
       └─ No context restore attempted
```

### During Attempt Execution

```
t=0:   Attempt 1 executing
t=50:  signal.abort() called
       └─ If fn() checks signal → throws → no retry
       └─ If fn() ignores signal → completes → success/fail as normal
```

**Invariant:** Abort is respected at next check point. No partial causality.

---

## Test Coverage

| Category | Tests |
|----------|-------|
| Derived Context | 2 tests |
| Success/Failure | 3 tests |
| Cancellation | 2 tests |
| Gate Composition | 3 tests |
| Backoff Timing | 1 test |
| isRetryable | 1 test |
| No Context | 1 test |
| **Total** | **13 tests** |

---

## Philosophy

```
Day-01 (Capacity):   How much work can we handle?
Day-02 (Rate):       How fast should we pull work?
Day-03 (Meaning):    What does this work signify?
Day-04 (Continuity): How does work survive failure?
```

> Retry is where systems quietly lie. This implementation forces them to tell the truth.
