# Day-02 Challenge

## Backpressure-Aware Async Iterators in Node.js (TypeScript)

### Problem

In the Node.js ecosystem, **async task concurrency** and **backpressure** are treated as two separate concerns:

* Concurrency is managed with gates, pools, or queues
* Backpressure exists only in streams and iterators

In real systems, this separation is artificial.

> When async work is produced faster than it can be consumed, the **producer must slow down automatically**.

What’s missing is a primitive that connects these two worlds.

---

### Objective

Using (or adapting) your **Day-01 AsyncGate**, design a **backpressure-aware async iterator**.

The iterator must **pause production** when concurrency slots are exhausted and **resume automatically** when capacity is freed.

---

### Target API

```ts
for await (const item of gate.iter(source())) {
  await process(item);
}
```

or:

```ts
const wrapped = gate.wrap(source());

for await (const item of wrapped) {
  await process(item);
}
```

Where:

* `source()` is any `AsyncIterable<T>`
* When the gate is full, `next()` must **block**
* No items are buffered
* No polling is allowed

---

### Hard Constraints

* No `ReadableStream`
* No buffering (`Array<T>` or internal queues)
* No polling (`setInterval`, `setTimeout`)
* No external libraries
* Node.js ≥ 18
* TypeScript

Timeouts and cancellation are allowed **only if they are part of the gate**, not the iterator itself.

---

### Design Questions (must be answered in the post)

1. **Where is backpressure applied?**
   On the producer or the consumer?

2. At which point does the `for await` loop suspend execution?

3. When is a concurrency slot acquired?

   * On `next()`?
   * On `yield`?
   * When the consumer awaits processing?

4. If the consumer throws or crashes:

   * Is the slot leaked?
   * What happens to iterator state?

5. In which scenarios does this design **intentionally fail or behave incorrectly**?

---

### Acceptance Criteria

* Code size ≈ ≤180 lines
* At least one explicit, documented trade-off
* FIFO ordering preserved
* No deadlocks
* Clear statement that this is **not a Node stream**

---

### Why This Is Day-02

Because:

* Most Node developers treat async iterators as syntax sugar
* Very few understand their relationship to backpressure
* Solving this correctly unifies:

  * queues
  * streams
  * workers
  * agent loops

under a single concurrency model.
