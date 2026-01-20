# Daily Coding Challenges

Daily coding challenges — one problem, one solution, one blog post.

---

Daily, self-contained engineering challenges focused on **Node.js, TypeScript, and async system primitives**.

These are not tutorials.

Each challenge is based on real production problems that are
often solved ad-hoc, inconsistently, or not at all.

## Rules

- One problem per day
- Small scope, sharp edges
- No external dependencies unless explicitly allowed
- Incomplete solutions are acceptable if boundaries are clear

## Structure

```
challenge/
├── 01-challenge/   # AsyncGate - Async concurrency limiter
├── 02-challenge/   # Backpressure-Aware Async Iterators
├── 03-challenge/   # Context Propagation Under Load
├── 04-challenge/   # Retry Semantics Under Preserved Causality
├── 05-challenge/   # Circuit Breaking as Semantic Boundary
└── 06-conclusion/  # Graceful Degradation vs Silent Failure
```

## Challenges

| Day | Challenge | Keywords |
|-----|-----------|----------|
| 1 | [Bounded Async Execution (AsyncGate)](./01-challenge/) | concurrency, semaphore, FIFO, cancellation |
| 2 | [Backpressure-Aware Async Iterators](./02-challenge/) | backpressure, async iterators, streams |
| 3 | [Context Propagation Under Load](./03-challenge/) | AsyncLocalStorage, context capture, schedule-time |
| 4 | [Retry Semantics Under Preserved Causality](./04-challenge/) | retry, causality, exponential backoff, derived context |
| 5 | [Circuit Breaking as Semantic Boundary](./05-challenge/) | circuit breaker, causality severance, fail-before-gate |
| 6 | [Graceful Degradation vs Silent Failure](./06-conclusion/) | silence, epistemic integrity, decision observability |

## Philosophy

```
Day-01 (Capacity):   How much work can we handle?
Day-02 (Rate):       How fast should we pull work?
Day-03 (Meaning):    What does this work signify?
Day-04 (Continuity): How does work survive failure?
Day-05 (Ethics):     When do we stop?
Day-06 (Silence):    What do we say when we stop?
```

> Frameworks are built on primitives. This repository focuses on the primitives.

## Product

This challenge series led to **[TCR-Lite: Async Stack Observer](./tcr-lite.md)** — a decision-level observability tool that records *why* async decisions were made, not just *what* happened.
