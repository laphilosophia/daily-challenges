## Day-01 Challenge

### Problem

Imagine a long-running Node.js service.
This service receives async work from external sources (HTTP, queue, agent loop, webhook).

> You want to limit concurrent async operations **but**:
>
> * Jobs must be FIFO
> * Pending jobs must be cancellable
> * Timeout support required
> * `await` ergonomics must be preserved
> * Event loop must not be blocked
> * No Promise leaks

### Constraints

* No `p-limit`, `bull`, `bottleneck`, etc.
* No `setInterval` / polling
* No global mutable state
* No Worker Threads
* Node ≥18, TypeScript

---

### Expected Output

Define an **abstraction**.
Name it yourself.

But provide **explicit answers** to these questions:

1. **Where** am I tracking concurrency?
2. **Where** are pending Promises stored?
3. What invariants are preserved when timeout occurs?
4. How is queue state guaranteed if a task rejects?
5. In which scenario does this structure **intentionally crash**?

---

### Acceptance Criteria

* Code must not exceed 150 lines
* You don't have to write tests, but it **must be testable**
* You don't get to say "This is not production-ready"
  (either defend it, or explicitly define its boundaries)

---

### Why This is Actually a Challenge

Because:

* 90% of developers think this is "easy"
* 90% of solutions have memory leaks or race conditions
* The correct solution is **small but sharp**
