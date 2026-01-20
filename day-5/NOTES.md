# Day-05 Design Notes

## Locked Design Decisions

### 1. Circuit Open = Causality Severed

**Decision:** When circuit is OPEN, we sever the **causality chain**, not just execution.

```
CLOSED:  [Context] → [Gate] → [Retry] → [Circuit] → [Work]
OPEN:    [Context] → ⚡CircuitOpenError (immediate)
```

**Implications:**
- Gate slot **not acquired** — no resource waste
- Retry **not triggered** — circuit acceptance overrides retry persistence
- Context **not restored** — severed causality cannot be restored

**Why not just fail execution?**
If we acquired gate slots and triggered retries for OPEN circuits, we'd be:
- Wasting resources on doomed work
- Lying about system state (retry implies recoverable, circuit says not)
- Violating FIFO by queuing work that won't run

---

### 2. Fail-Before-Gate Composition

**Decision:** Circuit check happens **before** gate acquisition.

```ts
// CORRECT: Circuit → Gate → Work
await circuit.run(async () => {
  await gate.run(work);
});

// WRONG: Gate → Circuit (wastes slot when open)
await gate.run(async () => {
  await circuit.run(work);
});
```

**Rationale:**
- FIFO preserved — rejected tasks never enter queue
- No slot waste — OPEN circuits don't consume capacity
- Gate invariants intact

---

### 3. Circuit Overrides Retry

**Decision:** `CircuitOpenError` is non-retryable by design.

```ts
// Hierarchy of decisions
┌─────────────────────────────────┐
│ Circuit says: STOP              │ ← System gave up
├─────────────────────────────────┤
│ Retry says: TRY AGAIN           │ ← Override ignored
├─────────────────────────────────┤
│ Gate says: QUEUE                │ ← Never reached
└─────────────────────────────────┘
```

**Helper provided:**
```ts
import { respectCircuit } from "./circuit-breaker.js";

const retrier = createRetrier(store, {
  isRetryable: respectCircuit
});
```

---

### 4. Rejection is a Causality Event

**Decision:** Circuit rejection creates a distinct, traceable event.

```ts
class CircuitOpenError extends Error {
  readonly state: CircuitState;
  readonly nextAttemptAt: number;
  readonly failures: number;
}
```

**Why this matters:**
- "Neden çalışmadı?" sorusu cevaplanabilir
- Logs show circuit state at rejection time
- Metrics can track: requests vs. rejections vs. executions

---

### 5. Half-Open Single Probe

**Decision:** Only one probe request during HALF_OPEN, no FIFO bypass.

```
OPEN → [cooldown] → HALF_OPEN
                        │
                        └─ First request = probe
                           ├─ Success → CLOSED
                           └─ Failure → OPEN

Concurrent requests during probe → REJECTED
```

**No bypass rationale:**
- Probe respects queue order
- No "priority lane" for test traffic
- System fairness maintained

---

## State Machine

```
     failure threshold
CLOSED ─────────────────────> OPEN
   │                           │
   │ success (reset failures)  │ cooldown expires
   │                           │
   ▼                           ▼
CLOSED <───────────────── HALF_OPEN
          probe success            │
                                   │ probe failure
                                   ▼
                                 OPEN
```

---

## Risks Explicitly Avoided

| Risk | Solution |
|------|----------|
| Silent data loss | CircuitOpenError with full state |
| Gate slot waste | Check circuit before acquire |
| Retry fighting circuit | CircuitOpenError non-retryable |
| Probe thundering herd | Single probe enforcement |
| Ambiguous rejection | Error contains state + timing |

---

## Explicit Non-Goals

1. **Adaptive thresholds** — Fixed config, no ML
2. **Distributed circuits** — Single process only
3. **Partial circuit** — Binary open/closed, no % traffic
4. **Fair scheduling** — Not this primitive's job
5. **Circuit groups** — Each instance independent

---

## Composition Matrix

| Primitive | Composition Pattern |
|-----------|---------------------|
| Day-01 AsyncGate | `circuit.run(() => gate.run(work))` |
| Day-03 ContextCarrier | Context not restored on circuit rejection |
| Day-04 Retrier | `isRetryable: respectCircuit` |

---

## Explicit Trade-off: "Silent Loss" Concern

User raised concern: "Causality severed" might feel like silent data loss.

**Our answer:**
1. `CircuitOpenError` contains full diagnostic data
2. `getStats()` provides observability
3. Rejection is a traceable event, not silent
4. README documents this behavior

> This is a **chosen cost**, not a bug.

---

## Philosophy

```
Day-01 (Capacity):   How much work can we handle?
Day-02 (Rate):       How fast should we pull work?
Day-03 (Meaning):    What does this work signify?
Day-04 (Continuity): How does work survive failure?
Day-05 (Ethics):     When do we choose to stop?
```

> **Retry is ısrar (persistence). Circuit is kabul (acceptance).**
> They cannot both win at the same time.
