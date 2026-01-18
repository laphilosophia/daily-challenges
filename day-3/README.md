# Day-3: Async Context Propagation Under Load

**Status:** ✅ Complete
**Lines:** ~275 (async-gate.ts) + ~70 (context-carrier.ts)
**Tests:** 14 passing

## Quick Start

```bash
npm install
npm test
```

## The Problem

`AsyncLocalStorage` works perfectly — in isolation.

Under load, combined with **concurrency primitives** (gates, iterators, retries, timeouts), async context *silently breaks*.

```ts
// Request A — traceId: "abc"
ctx.run({ traceId: "abc" }, async () => {
  await gate.run(async () => {
    // Gate was full → task queued
    // Meanwhile, Request B arrived — traceId: "xyz"
    console.log(ctx.get("traceId")); // "abc" or "xyz"?
  });
});
```

`AsyncLocalStorage` exposes **execution-time context**, but what we need is **schedule-time context**.

## The Solution

### Core Invariant

> Every async task observes the context active **at the moment it was scheduled**, not the context active when it happened to run.

### Usage

```ts
import { AsyncLocalStorage } from 'node:async_hooks';
import { AsyncGate } from './async-gate';

const store = new AsyncLocalStorage<{ traceId: string }>();
const gate = new AsyncGate({ concurrency: 3, store });

// Gate.run() — automatic capture/restore
await store.run({ traceId: "abc" }, () =>
  gate.run(async () => {
    // Always sees "abc", even if delayed/queued
    console.log(store.getStore()?.traceId);
  })
);

// Gate.wrap() — per-iteration capture
for await (const { item, run } of gate.wrap(asyncSource())) {
  await run(() => {
    // Sees context from when THIS next() was called
    await process(item);
  });
}
```

## Design Decisions

### 1. When is context captured?

| Method | Capture Point |
|--------|---------------|
| `run(fn)` | Before `acquire()` |
| `wrap().next()` | At each `next()` call |

### 2. Where is context restored?

| Method | Restore Point |
|--------|---------------|
| `run(fn)` | Inside `try`, before `fn()` |
| `wrap()` | Inside `item.run()` |

### 3. Iterator Strategy: Per-Iteration Capture

**Decision:** `wrap()` does NOT capture context. Each `next()` captures its own schedule-time context.

```ts
for await (const { item, run } of gate.wrap(source())) {
  // process(item) sees the context active when THIS next() was called
  await run(() => process(item));
}
```

**Rationale:**
- ✅ Correct for event/agent/stream processing
- ⚠️ Risky for request-scoped logging (intentional trade-off)

## Failure Boundaries

| Scenario | Context Captured? | Context Restored? |
|----------|-------------------|-------------------|
| Normal execution | ✅ | ✅ |
| Queued then executed | ✅ | ✅ |
| Timeout before acquire | ✅ | ❌ (correct) |
| Cancellation | ✅ | ❌ (correct) |
| Iterator early break | ✅ | ✅ (partial) |
| Nested gates | ✅ each level | ✅ each level |

## ⚠️ Explicitly NOT Guaranteed

> **CRITICAL: Parallel `next()` is UNDEFINED BEHAVIOR**
>
> ```ts
> const it = gate.wrap(source());
> const p1 = it.next(); // context A
> const p2 = it.next(); // context B — RACE CONDITION
> ```

1. **Parallel `next()` calls** — undefined behavior
2. **Cross-thread propagation** — single-thread only
3. **Request-scope isolation** — per-iteration may cross boundaries
4. **Context mutation** — captured context is a snapshot
5. **Automatic restoration** — consumer must call `run()`

## ContextCarrier — The Core Primitive

Single-shot context carrier for manual use:

```ts
import { ContextCarrier } from './context-carrier';

const carrier = new ContextCarrier(
  async () => doWork(),
  store
);

// Later, possibly in different context...
await carrier.run(); // Executes in original context
```

**Contract:**
- Captures at construction
- Restores at `run()`
- Single-shot (throws if called twice)
- No global state

## Why Day-03?

- Day-01 (capacity) breaks systems **loudly**
- Day-02 (rate) breaks systems **slowly**
- Day-03 (context) breaks systems **silently**

This challenge is about making hidden state **honest**.

## Files

- `async-gate.ts` — Context-aware gate (275 lines)
- `context-carrier.ts` — Single-shot carrier (70 lines)
- `async-gate.test.ts` — Test suite (14 tests)
- `challenge.md` — Problem statement
- `NOTES.md` — Design decisions
