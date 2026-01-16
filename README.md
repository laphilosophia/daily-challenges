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
├── day-1/   # AsyncGate - Async concurrency limiter
├── day-2/   # Backpressure-Aware Async Iterators
├── day-3/   # ...
└── ...
```

## Philosophy

Frameworks are built on primitives. This repository focuses on the primitives.

- **Real problems** — Production issues, not theoretical exercises
- **Constrained solutions** — No external libraries, build from first principles
- **Line limits** — Sharp, minimal, testable code
- **Critical questions** — Every challenge interrogates design decisions

## Challenges

| Day | Challenge | Keywords |
|-----|-----------|----------|
| 1 | [Bounded Async Execution (AsyncGate)](./day-1/) | concurrency, semaphore, FIFO, cancellation |
| 2 | [Backpressure-Aware Async Iterators](./day-2/) | backpressure, async iterators, streams |
