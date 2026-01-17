# Implementation Notes: Critical Design Decisions

This document contains consciously accepted design decisions that must not be left silent.

---

## ⚠️ 1. Release Guarantee Depends on JS Async Iterator Evaluation Order

### Assumption

```ts
for await (const item of wrapped) {
  await process(item);
}
// ↑ After body completes, JS runtime returns control to the iterator
//   before the next next() call is made.
```

This ordering is **implicitly guaranteed by the JS specification** (AsyncIteratorClose, IteratorNext evaluation order), but not explicitly stated.

### Implication

- `release()` is called at the **start** of `next()`
- This relies on consumer completing the `for await` body and yielding control back to the iterator
- If consumer escapes the async context mid-body (e.g., via `setImmediate`), release timing may drift

### Decision

This model is accepted because:
- Works correctly for standard `for await` usage
- Alternative (explicit release to consumer) creates worse ergonomics and leak risk

**Documentation note:** Release guarantee depends on JS async iterator evaluation order.

---

## ⚠️ 2. Parallel `next()` Calls: Undefined Behavior

### Scenario

```ts
const it = gate.wrap(source());
const p1 = it.next();  // Not awaited yet
const p2 = it.next();  // Second call
await Promise.all([p1, p2]);
```

### Behavior

This iterator has **single-consumer** semantics. Parallel `next()` calls:
- If second `next()` is called before first resolves, `pendingRelease` may trigger at wrong time
- Ordering guarantee is lost
- Slot counting may corrupt

### Decision

**Not explicitly detected.** Rationale:
- Detection requires `inFlight` flag → additional complexity
- This pattern is already an anti-pattern (violates async iterator semantics)
- Left as documented UB rather than throwing

**Documentation note:** This is a single-consumer iterator. Parallel `next()` calls are undefined behavior.

### Alternative (Optional Hardening)

```ts
// If strict mode is desired:
private inFlight = false;

async next() {
  if (this.inFlight) throw new Error('Parallel next() not allowed');
  this.inFlight = true;
  try { /* ... */ }
  finally { this.inFlight = false; }
}
```

This adds ~5 lines. Currently out of scope.

---

## ⚠️ 3. Slot Acquire + `done: true` Edge Case

### Scenario

```ts
// Last item in source
next() → acquire slot
       → source.next() → { done: true }
       → release slot immediately
```

### Observation

This creates an "empty" acquire-release cycle. A slot is acquired but no item is processed.

### Why This Is Accepted

**We cannot know in advance whether the source is exhausted.**

Alternatives evaluated:

| Alternative | Problem |
|-------------|---------|
| Check `done` before source | Impossible - can't know without calling source |
| Peek/lookahead | Requires buffering → constraint violation |
| Defer acquire | Backpressure escapes |

### Decision

This trade-off is accepted. The short acquire-release cycle is a natural consequence of the design.

**Documentation note:** At iteration end, a slot may be acquired and immediately released. This is expected behavior.

---

## Summary: Conscious Acceptances

| Risk | Decision | Alternative Rejected Because |
|------|----------|------------------------------|
| JS evaluation order dependency | Accepted | Explicit release → leak risk |
| Parallel next() UB | Documented UB | Detection overhead |
| Empty acquire-release | Accepted | Lookahead → buffering |

These decisions are **consciously made** and **not left silent**.
