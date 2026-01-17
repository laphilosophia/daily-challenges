# Day-2: Backpressure-Aware Async Iterator

**Status:** ✅ Complete
**Lines:** 140 (target: ≤180)
**Tests:** 14 passing

## Quick Start

```bash
npm install
npm test
```

## Usage

```ts
import { AsyncGate } from './async-gate';

const gate = new AsyncGate({ concurrency: 3 });

// Backpressure-aware iteration
for await (const item of gate.wrap(asyncSource())) {
  await process(item);  // Gate limits concurrent processing
}
```

## Design Summary

### Backpressure Mechanics

| Question | Answer |
|----------|--------|
| Where is backpressure applied? | On producer - `next()` blocks when gate is full |
| Where does `for await` suspend? | At `await iterator.next()` |
| When is slot acquired? | Before `source.next()` is called |
| When is slot released? | On *subsequent* `next()` call or cleanup |

### Next-Triggers-Previous-Release Pattern

```
next() #1 → acquire slot → source.next() → return item #1
                                           ↓
next() #2 → RELEASE slot #1 → acquire → source.next() → return item #2
                                                        ↓
iteration ends → return() → RELEASE slot #2
```

This guarantees no slot leaks without requiring consumer to call `release()`.

### Intentional Failure Scenarios

| Scenario | Behavior |
|----------|----------|
| Parallel `next()` calls | Undefined behavior |
| Re-entrant `next()` in process | Undefined behavior |
| Iterator reuse after exhaustion | Returns `done: true` |

### Trade-off

Slot is held from `next()` return until the *next* `next()` call. This means the slot is held during consumer processing + idle time until next iteration. Accepted because:
- No API pollution (plain `T` returned, not wrapped)
- No leak risk (iterator manages release)
- Backpressure goal achieved (producer blocked)

## Not a Node Stream

This implementation:
- ❌ Does not use `ReadableStream`
- ❌ Does not buffer items
- ❌ Does not poll (`setInterval`/`setTimeout` for checking)
- ✅ Uses native `AbortSignal` for cancellation
- ✅ Preserves FIFO ordering
- ✅ Guarantees slot release on break/throw/exhaustion

## Files

- `async-gate.ts` - Implementation (140 lines)
- `async-gate.test.ts` - Test suite (14 tests)
- `challenge.md` - Problem statement + design document
