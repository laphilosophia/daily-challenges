# Day-03 Design Notes

## Locked Design Decisions

### 1. Iterator Context Strategy: Per-Iteration Capture

**Decision:** `wrap()` does NOT capture context. Each `next()` captures its own schedule-time context.

```ts
for await (const item of gate.wrap(source())) {
  // process(item) sees the context active when THIS next() was called
  await process(item);
}
```

**Rationale:**
- Event/agent/stream processing: ✅ correct
- Request-scoped logging: ⚠️ risky (acknowledged)

This is intentional. Stream processing semantics win over request tracing convenience.

---

### 2. ContextCarrier — The Core Primitive

**Single responsibility:** Carry schedule-time context, restore at execution-time.

**Contract:**
- Captures context at construction
- Restores context in `run()`
- Single-shot (no re-entrancy)
- No global state awareness

```ts
class ContextCarrier<T> {
  constructor(fn: () => Promise<T>, store: AsyncLocalStorage<any>)
  run(): Promise<T>  // restores captured context, executes fn
}
```

**Why single-shot:**
- Re-running with stale context = hidden bug
- Forces caller to create new carrier for each attempt
- Retry logic stays explicit in caller

---

### 3. AsyncGate Context Flow

```
run(fn):
  1. capture context          ← HERE
  2. await acquire            (may queue, may delay)
  3. try:
       restore context        ← HERE
       await fn()
     finally:
       release
```

**Timeout/Cancellation Behavior:**
- If task times out before acquire → fn never runs → context never restored
- This is **correct behavior**, not a bug
- Captured context is garbage collected with the carrier

---

### 4. GatedIterator Context Flow

```
async *wrap(source):
  for await (item of source):
    1. capture context        ← at next() call
    2. await gate.acquire()
    3. try:
         yield item           ← consumer runs in their own context
       finally:
         gate.release()
```

**Important:**
- `yield` returns plain `T`, not wrapped
- Release is iterator's responsibility, not consumer's
- `return()`, `throw()`, early `break` all trigger finally → release guaranteed

---

### 5. Context Restoration Point

**Where does `process(item)` see the captured context?**

The iterator captures but cannot force consumer's context. Two options:

**Option A:** Iterator yields `{ item, run: (fn) => ... }`
- Pro: Context restoration is explicit
- Con: API pollution

**Option B:** Consumer wraps with captured context externally
- Pro: Clean yield
- Con: Requires discipline

**Decision:** Option A for Day-03 — explicit is better than implicit.

```ts
for await (const { item, run } of gate.wrap(source())) {
  await run(() => process(item));  // runs in captured context
}
```

---

## Explicitly NOT Guaranteed (Non-Goals)

> **⚠️ CRITICAL: Parallel `next()` is UNDEFINED BEHAVIOR**
>
> ```ts
> const it = gate.wrap(source());
> const p1 = it.next(); // context A
> const p2 = it.next(); // context B — RACE CONDITION
> ```
>
> This is **intentionally unsupported**. The iterator assumes sequential consumption.
> If you need parallel consumption, use separate iterators.

1. **Parallel `next()` calls** — undefined behavior, not supported
2. **Cross-thread propagation** — single-thread only
3. **Request-scope isolation** — per-iteration capture may cross request boundaries
4. **ALS alternatives** — only `AsyncLocalStorage` is used
5. **Context mutation** — captured context is a snapshot, mutations don't propagate
6. **Automatic restoration** — consumer must call `run()` explicitly

---

## Failure Boundaries

| Scenario | Context Captured? | Context Restored? | Notes |
|----------|-------------------|-------------------|-------|
| Normal execution | ✅ | ✅ | Happy path |
| Queued then executed | ✅ | ✅ | Design goal |
| Timeout before acquire | ✅ | ❌ | Correct: task never ran |
| Cancellation (AbortSignal) | ✅ | ❌ | Correct: task aborted |
| Task never runs (queue full forever) | ✅ | ❌ | GC cleans up carrier |
| Iterator early break | ✅ | ✅ (partial) | Finally runs, slot released |
| Nested gates | ✅ each level | ✅ each level | Outermost context per gate |

---

## Test Strategy (TDD)

Write these tests BEFORE implementation:

### a) Context Bleed
```ts
// A enters gate (full), queued
// B enters gate, runs immediately
// A eventually runs
// Assert: A sees A's context, not B's
```

### b) Timeout
```ts
// capture context
// task times out before acquire
// Assert: context never restored, no side effects
```

### c) Cancellation
```ts
// capture context
// abort before execution
// Assert: context never appears anywhere
```

### d) Iterator Interleaving
```ts
// next() in context A
// next() in context B
// process() each item
// Assert: each process() sees its own captured context
```

---

## Implementation Order

1. `ContextCarrier.ts` — foundation
2. `AsyncGate` upgrade — capture/restore in run()
3. `GatedIterator` upgrade — per-next capture, yield with runner
4. Test suite — validate invariants
