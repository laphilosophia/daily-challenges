# Day 1: AsyncGate

**Production-grade async concurrency limiter** with FIFO ordering, cancellation, and timeout support.

## Problem

Build an async semaphore that:
- Limits concurrent async operations
- Maintains FIFO order
- Supports cancellation via AbortSignal
- Supports timeout
- No external dependencies (`p-limit`, `bottleneck`, etc.)
- No polling (`setInterval`)

## Solution: AsyncGate

```typescript
import { AsyncGate } from './async-gate';

const gate = new AsyncGate({ concurrency: 3 });

// Option 1: Manual acquire/release
const release = await gate.acquire({ timeout: 5000 });
try {
  await doWork();
} finally {
  release();
}

// Option 2: Automatic with run()
await gate.run(async () => {
  await doWork();
}, { timeout: 5000 });
```

## Key Design Decisions

1. **Intrusive Linked-List** — O(1) cancellation, no polling
2. **Deferred Pattern** — Store callbacks, not Promises
3. **Single-shot Guard** — `settled` flag prevents resolve/reject race
4. **AbortController Native** — Modern timeout/cancellation API

## Running

```bash
npm test
```

## Files

| File | Lines | Purpose |
|------|-------|---------|
| `async-gate.ts` | 137 | Core implementation |
| `async-gate.test.ts` | 130 | Test suite |
| `challenge.md` | — | Original problem statement |
