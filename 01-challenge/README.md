# Day 1: AsyncGate — Async Concurrency Limiter From Scratch

> **TL;DR:** A production-grade async semaphore in 137 lines of TypeScript. Zero external dependencies.

---

## 🎯 The Problem

Imagine a long-running Node.js service. It receives async work from various sources — HTTP requests, message queues, agent loops, webhooks.

**You want to limit concurrent async operations, but:**

- ✅ Jobs must be processed in FIFO order
- ✅ Pending jobs must be cancellable
- ✅ Timeout support is required
- ✅ `await` ergonomics must be preserved
- ✅ Event loop must not be blocked
- ✅ No Promise leaks

**Constraints:**
- No `p-limit`, `bull`, `bottleneck`, etc.
- No `setInterval` / polling
- No global mutable state

---

## 💡 The Solution: AsyncGate

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

---

## 🏗️ Architectural Decisions

### 1. Intrusive Linked-List

We used a doubly-linked list instead of an array for the queue. Why?

```
┌──────┐    ┌──────┐    ┌──────┐
│ Node │◄──►│ Node │◄──►│ Node │
│ res()│    │ res()│    │ res()│
└──────┘    └──────┘    └──────┘
   ▲                        ▲
  head                     tail
```

- **O(1) cancellation** — Unlink the node, connect left to right
- **O(1) enqueue/dequeue** — Head and tail pointers
- **No polling** — Push-based architecture

### 2. Deferred Pattern

Instead of storing the Promise itself in the queue, we store the `resolve/reject` callbacks:

```typescript
interface WaitNode {
  resolve: (release: ReleaseFunction) => void;
  reject: (error: Error) => void;
  prev: WaitNode | null;
  next: WaitNode | null;
  settled: boolean;  // Race condition guard
}
```

Benefits:
- Promise stays with the caller (no memory leaks)
- Cancellation is just calling `unlink()`
- Timeout is just calling `reject()`

### 3. Single-Shot Guard

Edge case: What if `dispatch()` and `onAbort` fire in the same tick?

```typescript
const onAbort = () => {
  if (node.settled) return;  // ← Guard
  node.settled = true;
  cleanup();
  reject(new AbortError());
};
```

These 3 lines prevent the resolve/reject race condition.

---

## 🔍 5 Critical Questions (and Answers)

### 1. Where do I track concurrency?

In the `this.running` counter. Incremented when `acquire()` grants a slot, decremented when `release()` is called.

### 2. Where do pending Promises live?

In the intrusive doubly-linked list. Each node holds the `resolve/reject` callbacks — not the Promise itself.

### 3. How are invariants preserved on timeout?

- Node is removed from the list via `unlink()`
- Promise is rejected with `TimeoutError`
- `running` counter is **never incremented** — slot was never granted

### 4. How is queue state guaranteed if a task rejects?

The `run()` helper calls `release()` in a `finally` block. For manual `acquire()` usage, the caller is responsible.

### 5. When does this intentionally crash?

- `concurrency ≤ 0` → Constructor throws
- `release()` called twice → Error (bug detection)
- AbortSignal already aborted → Immediate reject

---

## ✅ Test Results

```
🧪 AsyncGate Test Suite

✅ FIFO ordering
✅ Concurrency limit
✅ Timeout rejects correctly
✅ AbortSignal cancellation
✅ Double-release protection
✅ Rejection doesnt break queue
✅ Pre-aborted signal rejects immediately

✨ All tests complete!
```

---

## 📊 Summary

| Metric | Value |
|--------|-------|
| Lines of code | 137 (limit: 150) |
| External dependencies | 0 |
| Test coverage | 7/7 |
| Time complexity | O(1) all operations |

**Lesson learned:** 90% of developers think this problem is "easy." 90% of solutions have memory leaks or race conditions. The correct solution is small but sharp.

---

## 🔗 Files

| File | Description |
|------|-------------|
| [`async-gate.ts`](./async-gate.ts) | Core implementation |
| [`async-gate.test.ts`](./async-gate.test.ts) | Test suite |
| [`challenge.md`](./challenge.md) | Original problem statement |

```bash
npm test  # Run tests
```
