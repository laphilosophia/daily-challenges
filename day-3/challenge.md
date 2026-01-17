# Day-03 Challenge

## Async Context Propagation Under Load (Node.js / TypeScript)

### Problem

In Node.js, **async context propagation** is commonly treated as a solved problem:

* `AsyncLocalStorage`
* request IDs
* trace IDs
* scoped logging

In practice, it **breaks under load**.

Not because `AsyncLocalStorage` is broken —
but because **concurrency primitives don’t compose with it cleanly**.

---

### Real-world failure mode

You have:

* a concurrency gate
* async iterators
* background tasks
* retries
* timeouts

You expect this invariant to hold:

> “Every async task sees the context that was active when it was scheduled.”

Under load, this invariant **silently breaks**.

---

### Objective

Design a mechanism that ensures:

> **Async context is captured at scheduling time and restored at execution time**,
> even when tasks are:
>
> * delayed
> * queued
> * gated
> * cancelled
> * resumed later

This must work with:

* your Day-01 `AsyncGate`
* your Day-02 backpressure-aware iterator

---

### Target API (conceptual)

```ts
ctx.run({ traceId: "abc" }, async () => {
  await gate.run(async () => {
    await doWork(); // must see traceId = "abc"
  });
});
```

or:

```ts
for await (const item of gate.wrap(source())) {
  await ctx.run(currentCtx, async () => {
    await process(item);
  });
}
```

But **how** this is implemented is entirely up to you.

---

### Hard Constraints

* `AsyncLocalStorage` is allowed
* No global mutable context
* No monkey-patching Promise
* No framework-level magic
* Node.js ≥ 18
* TypeScript

You may assume:

* single process
* single thread (no Worker threads)

---

### Design Questions (must be answered in the post)

1. **When is context captured?**

   * task creation?
   * enqueue?
   * execution?

2. **Where is context restored?**

   * before `await`?
   * inside gate?
   * inside iterator?

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

### Acceptance Criteria

* Context propagation is deterministic
* No context bleed between concurrent tasks
* Cancellation does not leak context
* FIFO ordering is preserved
* Clear failure boundaries are documented

---

### Why This Is Day-03

Because:

* Context is the **hidden state** of async systems
* Most bugs here are invisible until production
* Gates and iterators **amplify** context bugs
* Frameworks hide this; primitives expose it

If Day-01 was *capacity*
and Day-02 was *rate*
then Day-03 is **meaning**.

---

### Series Index (so far)

* Day-01 — Bounded async execution
* Day-02 — Iterator-level backpressure
* Day-03 — Async context propagation under load
