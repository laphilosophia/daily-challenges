# Day-06 Challenge

## Graceful Degradation vs Silent Failure

**Designing failure behavior that does not lie**

### Problem

Up to Day-05, the system learned **when to stop trying**.

* Gate limits capacity
* Retry persists with bounded causality
* Circuit breaker cuts intent deliberately

Day-06 asks a different question:

> When the system does *not* perform the intended work,
> **what observable behavior replaces it?**

Most systems answer this poorly:

* they retry too long
* they buffer too much
* they return garbage
* or worse — they succeed *dishonestly*

---

### Core Challenge

Design a **failure behavior policy** that decides, *at runtime*:

> Whether the system should
> **fail**, **degrade**, **delay**, or **stay silent**
> — without breaking semantic guarantees.

This is **not** about availability.
It is about **truthfulness under failure**.

---

### Constraints

* No new primitives
  (use Day-01 → Day-05 concepts only)
* No framework abstractions
* No global “mode” flags
* Single process, single thread
* Node.js ≥ 18, TypeScript

This is a **design challenge**, not an implementation exercise.

---

### Mandatory Questions (must be answered)

You must answer **all** of these, explicitly.

---

#### 1. What is a *silent failure*?

Define precisely:

* Is silent failure the absence of a response?
* Or the absence of *side effects*?
* Or the absence of *observability*?

State **one definition** and reject the others.

---

#### 2. When is silence more honest than an error?

Give at least **two concrete scenarios** where:

* throwing an error would be misleading
* retrying would be unethical
* degrading would be incorrect

Explain **why silence is the correct behavior**.

---

#### 3. How does silence compose with previous primitives?

For each primitive, answer **yes/no + why**:

| Primitive           | Can it cause silence? |
| ------------------- | --------------------- |
| AsyncGate           | ?                     |
| Retry               | ?                     |
| Circuit Breaker     | ?                     |
| Context propagation | ?                     |

If the answer is “yes”, define **where** silence happens.

---

#### 4. Is silent failure observable?

You must pick **one**:

* Silent failure is *not observable by design*
* Silent failure is observable, but *out-of-band*

And then defend that choice.

You may not answer “it depends”.

---

#### 5. What invariant does silence protect?

Silence must protect **something**.

Examples (pick your own, these are hints):

* causality integrity
* downstream correctness
* user trust
* system intent

State **exactly one invariant** that silence exists to preserve.

---

#### 6. When is silent failure a bug?

Define a **clear boundary** where silence becomes:

* lying
* data loss
* broken semantics

This boundary must be sharp enough that a test *could* exist, even if you don’t write it.

---

### Explicit Non-Goals

You may **not** solve these here:

* SLA management
* user experience copy
* distributed consensus
* eventual consistency theory
* business retries

This is about **system semantics**, not product behavior.

---

### Acceptance Criteria

A valid Day-06 solution must:

* Treat silence as a **deliberate decision**, not a fallback
* Integrate cleanly with Day-01 → Day-05 reasoning
* Define at least one **hard “no”** (where silence is forbidden)
* Avoid “it depends” reasoning
* Be internally consistent (no contradictions)

No code is required.
But every claim must be **testable in principle**.

---

### Why This Is Day-06

* Day-01 — Capacity: *how much*
* Day-02 — Rate: *how fast*
* Day-03 — Meaning: *what does this represent*
* Day-04 — Continuity: *what happens on failure*
* Day-05 — Ethics: *when do we stop*
* **Day-06 — Silence: *what do we say when we stop***

Most systems fail loudly or incorrectly.
Very few know **when to say nothing**.

---

### Final note (important)

If you solve Day-06 honestly,
you will realize why:

* most “high availability” systems are semantically broken
* most dashboards lie
* and why Atrion *had to exist*

Ama Day-06 **ürün üretmez**.
Sadece **yanılsamayı bitirir**.

---

Day-06 bir design essay with executable invariants olacak.
