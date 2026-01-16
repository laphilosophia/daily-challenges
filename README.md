# 🎯 Daily Coding Challenges

Daily coding challenges — one problem, one solution, one blog post.

## Structure

```
challenge/
├── day-1/   # AsyncGate - Async concurrency limiter
├── day-2/   # ...
├── day-3/   # ...
└── ...
```

## Philosophy

- **Real problems** — Production issues, not theoretical exercises
- **Constrained solutions** — No external libraries, build from first principles
- **150-line limit** — Sharp, minimal, testable code
- **5 critical questions** — Every challenge interrogates design decisions

## Challenges

| Day | Challenge | Keywords |
|-----|-----------|----------|
| 1 | [AsyncGate](./day-1/) | concurrency, semaphore, FIFO, cancellation |

## Running

```bash
# Install all dependencies
npm install

# Run all tests
npm test

# Run specific day
cd day-1 && npm test
```

## License

MIT
