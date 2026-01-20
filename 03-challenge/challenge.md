# Day-03 Challenge

## Async Context Propagation Under Load (Node.js / TypeScript)

### Problem

In Node.js, `AsyncLocalStorage` is often treated as a solved problem.

In isolation, it is.

Under load — combined with **concurrency primitives** such as:

* gates
* async iterators
* retries
* timeouts
* delayed execution

**async context silently breaks**.

No crashes.
No errors.
Just *wrong context in production*.

---

### Core Failure Mode

```ts
// Request A — traceId: "abc"
ctx.run({ traceId: "abc" }, async () => {
  await gate.run(async () => {
    // Gate was full → task queued
    // Meanwhile, Request B arrived — traceId: "xyz"
    console.log(ctx.get("traceId"));
  });
});
```

At execution time, which context is visible?

* `"abc"` — the context active when the task was scheduled?
* `"xyz"` — the context active when the task finally ran?

`AsyncLocalStorage` exposes **execution-time context**,
but the system invariant we want is **schedule-time context**.

That mismatch is the bug.

---

### Objective

Design a mechanism that guarantees:

> **Async context is captured when a task is scheduled
> and restored when that task is executed**,
> regardless of delays, queuing, or concurrency.

This must compose correctly with:

* Day-01 `AsyncGate`
* Day-02 backpressure-aware async iterator

---

### Target Invariant

> Every async task observes the context that was active
> **at the moment it was scheduled**,
> not the context active when it happened to run.

---

### Constraints

* `AsyncLocalStorage` ✅
* Global mutable context ❌
* Promise monkey-patching ❌
* Framework-level magic ❌
* Node.js ≥ 18
* TypeScript
* Single process, single thread

---

### Required Design Questions (must be answered)

1. **When is context captured?**

   * task creation?
   * enqueue?
   * execution?

2. **Where is context restored?**

   * before `await`?
   * inside the gate?
   * inside the iterator?

3. What happens if:

   * a task times out?
   * a task is cancelled?
   * a task never runs?

4. How does this interact with:

   * retries
   * re-entrancy
   * nested gates?

5. Which guarantees are **explicitly not provided**?

---

### Iterator-Specific Ambiguity (intentional)

```ts
for await (const item of gate.wrap(source())) {
  await process(item);
}
```

Which context should `process(item)` observe?

* the context active when `wrap()` was called?
* the context active when `next()` was called?
* the context active when the item was produced?

This is a **design decision**, not an implementation detail.
It must be chosen, justified, and documented.

---

### Acceptance Criteria

* Context propagation is deterministic
* No context bleed between concurrent tasks
* Cancellation and timeouts do not leak context
* FIFO ordering is preserved
* Failure boundaries are explicit and documented

---

### Why This Is Day-03

* Capacity (Day-01) breaks systems loudly
* Rate (Day-02) breaks systems slowly
* **Context breaks systems silently**

This challenge is about making hidden state **honest**.

---

### Series Index

* Day-01 — Bounded async execution
* Day-02 — Iterator-level backpressure
* Day-03 — Async context propagation under load
