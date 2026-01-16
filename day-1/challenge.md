## Day-01 Challenge

### Problem

Consider a long-running service in Node.js.
This service receives asynchronous jobs from external sources (HTTP, queue, agent loop, webhook).

> You want to limit the number of async jobs running simultaneously **but**:
>
> * Jobs should be FIFO
> * Pending jobs should be cancelable
> * There should be a timeout
> * `await` ergonomics should not be broken
> * The event loop should not be blocked
> * There should be no promise leaks

### Constraints

* **No** `p-limit`, `bull`, `bottleneck`, etc.
* **No** `setInterval` / polling
* **No** global mutable state
* **No** Worker Thread
* Node ≥18, TypeScript

---

### Expected output

Define an **abstraction**. Name it yourself. But **clearly answer** these questions in writing:

1. Where do I count **concurrency**?
2. Where does the pending Promise **reside**?
3. When there is a timeout, which invariants does the system preserve?
4. How is the queue state guaranteed if a task is rejected?
5. In which scenario does this structure **deliberately crash**?

---

### Acceptance criteria

* Code must not exceed 150 lines
* You don't have to write tests, but it **must be testable**
* You cannot say “This is not production-ready”
  (either defend it, or clearly state its limitations)

---

### Why is this really a challenge?

Because:

* 90% of developers think this is “easy”
* 90% of solutions have memory leaks or race conditions
* The correct solution is **small but sharp**
