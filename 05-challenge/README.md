# Day-05: Circuit Breaking as a Semantic Boundary

> **Retry is ısrar (persistence). Circuit is kabul (acceptance). They cannot both win.**

## Problem

Circuit breakers are typically used for downstream protection and latency limiting. But in async, context-aware systems:

> **A circuit breaker is a boundary where causality is intentionally severed.**

If this boundary isn't correctly modeled:
- Retry becomes meaningless
- Context lies about state
- Gate invariants break
- System appears to work but is semantically collapsed

## Solution

A circuit breaker that composes correctly with Day-01 through Day-04 primitives and makes explicit **when the system decides to stop trying**.

## Usage

### Basic

```ts
import { createCircuitBreaker, CircuitOpenError } from "./circuit-breaker.js";

const circuit = createCircuitBreaker({
  failureThreshold: 5,    // Trip after 5 failures
  resetTimeout: 30000,    // Try half-open after 30s
  successThreshold: 1,    // Close after 1 probe success
});

try {
  const result = await circuit.run(async () => {
    return await callDownstream();
  });
} catch (error) {
  if (error instanceof CircuitOpenError) {
    console.log(`Circuit ${error.state}, retry after ${error.nextAttemptAt}`);
  }
}
```

### With Gate (Fail-Before-Gate Pattern)

```ts
import { createCircuitBreaker } from "./circuit-breaker.js";
import { AsyncGate } from "../day-1/async-gate.js";

const circuit = createCircuitBreaker({ failureThreshold: 5 });
const gate = new AsyncGate({ concurrency: 10 });

// CORRECT: Circuit check → Gate acquire → Work
// If OPEN, no slot is wasted
await circuit.run(async () => {
  return gate.run(async () => {
    return await work();
  });
});
```

### With Retry (Circuit Overrides Retry)

```ts
import { createCircuitBreaker, respectCircuit } from "./circuit-breaker.js";
import { createRetrier } from "../day-4/retrier.js";

const circuit = createCircuitBreaker({ failureThreshold: 5 });
const retrier = createRetrier(store, {
  maxAttempts: 3,
  isRetryable: respectCircuit,  // Don't retry circuit rejections
});

await retrier.run(async () => {
  return circuit.run(work);
});
```

### Full Stack: Context + Retry + Gate + Circuit

```ts
await store.run({ traceId: "abc" }, async () => {
  await retrier.run(async () => {
    await circuit.run(async () => {
      await gate.run(work);
    });
  }, { isRetryable: respectCircuit });
});
```

## State Machine

```
     failure threshold
CLOSED ────────────────────> OPEN
   │                           │
   │ success                   │ cooldown
   │                           │
   ▼                           ▼
CLOSED <────────────────── HALF_OPEN
          probe success            │
                                   │ probe failure
                                   ▼
                                 OPEN
```

## Design Decisions

| Decision | Implication |
|----------|-------------|
| OPEN severs causality | No gate slot acquired, no retry triggered |
| Fail-before-gate | Check circuit → acquire slot → work |
| Circuit overrides retry | `CircuitOpenError` is non-retryable |
| Rejection is traceable | Error contains state, timing, failure count |
| Single probe | Only one request during HALF_OPEN |

## API

```ts
// Factory
createCircuitBreaker(options?: CircuitBreakerOptions): CircuitBreaker

// Options
interface CircuitBreakerOptions {
  failureThreshold?: number;    // default: 5
  resetTimeout?: number;        // default: 30000 (ms)
  successThreshold?: number;    // default: 1
  isFailure?: (error) => bool;  // default: all errors
}

// Instance
circuit.run<T>(fn): Promise<T>    // Execute with protection
circuit.state: CircuitState       // CLOSED | OPEN | HALF_OPEN
circuit.getStats(): CircuitStats  // Observability
circuit.forceState(state): void   // Testing/admin

// Helpers
isCircuitOpenError(error): boolean
respectCircuit(error): boolean    // Use as isRetryable
```

## Tests

```bash
npx --yes tsx circuit-breaker.test.ts
```

## Philosophy

```
Day-01 (Capacity):   How much work can we handle?
Day-02 (Rate):       How fast should we pull work?
Day-03 (Meaning):    What does this work signify?
Day-04 (Continuity): How does work survive failure?
Day-05 (Ethics):     When do we choose to stop?
```

> Circuit breaking is not an optimization. It is a **decision**.
