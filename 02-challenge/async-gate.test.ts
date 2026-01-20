import { describe, expect, it } from 'vitest';
import { AsyncGate } from './async-gate';

// Helper: Create async generator with delays
async function* delayed<T>(items: T[], delayMs = 10): AsyncGenerator<T> {
  for (const item of items) {
    await new Promise(r => setTimeout(r, delayMs));
    yield item;
  }
}

// Helper: Create instant async generator
async function* instant<T>(items: T[]): AsyncGenerator<T> {
  for (const item of items) {
    yield item;
  }
}

// Helper: Track call order
function createTracker() {
  const events: string[] = [];
  return {
    events,
    log: (msg: string) => events.push(msg),
  };
}

describe('AsyncGate.wrap() - Backpressure Iterator', () => {
  describe('Basic Iteration', () => {
    it('should iterate through all items', async () => {
      const gate = new AsyncGate({ concurrency: 2 });
      const items = [1, 2, 3, 4, 5];
      const result: number[] = [];

      for await (const item of gate.wrap(instant(items))) {
        result.push(item);
      }

      expect(result).toEqual([1, 2, 3, 4, 5]);
    });

    it('should preserve FIFO ordering', async () => {
      const gate = new AsyncGate({ concurrency: 1 });
      const result: number[] = [];

      for await (const item of gate.wrap(instant([1, 2, 3]))) {
        result.push(item);
      }

      expect(result).toEqual([1, 2, 3]);
    });

    it('should handle empty source', async () => {
      const gate = new AsyncGate({ concurrency: 2 });
      const result: number[] = [];

      for await (const item of gate.wrap(instant([]))) {
        result.push(item);
      }

      expect(result).toEqual([]);
    });
  });

  describe('Backpressure Mechanics', () => {
    it('should block when gate is full', async () => {
      const gate = new AsyncGate({ concurrency: 1 });
      const tracker = createTracker();

      // First: occupy the slot
      const releasePromise = gate.acquire();
      const release = await releasePromise;
      tracker.log('slot-occupied');

      // Create iterator
      const iter = gate.wrap(instant([1, 2, 3]));

      // next() should block because gate is full
      let nextResolved = false;
      const nextPromise = iter.next().then(r => {
        nextResolved = true;
        tracker.log('next-resolved');
        return r;
      });

      // Give it a tick
      await new Promise(r => setTimeout(r, 10));
      expect(nextResolved).toBe(false);
      tracker.log('still-blocked');

      // Release the slot
      release();
      tracker.log('slot-released');

      await nextPromise;
      expect(nextResolved).toBe(true);

      expect(tracker.events).toEqual([
        'slot-occupied',
        'still-blocked',
        'slot-released',
        'next-resolved',
      ]);
    });

    it('next-triggers-previous-release pattern works', async () => {
      const gate = new AsyncGate({ concurrency: 1 });
      const tracker = createTracker();

      async function* trackedSource() {
        tracker.log('yield-1');
        yield 1;
        tracker.log('yield-2');
        yield 2;
      }

      const iter = gate.wrap(trackedSource());

      // First next() - acquires slot, gets item 1
      const r1 = await iter.next();
      expect(r1.value).toBe(1);
      tracker.log('got-1');

      // Second next() - should release slot 1, acquire new slot, get item 2
      const r2 = await iter.next();
      expect(r2.value).toBe(2);
      tracker.log('got-2');

      // This proves release happens on next() call
      expect(tracker.events).toEqual([
        'yield-1',
        'got-1',
        'yield-2',
        'got-2',
      ]);
    });
  });

  describe('Cleanup on break/return', () => {
    it('should release slot on break', async () => {
      const gate = new AsyncGate({ concurrency: 1 });
      let breakHappened = false;

      for await (const item of gate.wrap(instant([1, 2, 3, 4, 5]))) {
        if (item === 2) {
          breakHappened = true;
          break;
        }
      }

      expect(breakHappened).toBe(true);

      // Gate should be available - acquire should succeed immediately
      const release = await gate.acquire();
      release();
    });

    it('should call source.return() on break', async () => {
      const gate = new AsyncGate({ concurrency: 1 });
      let returnCalled = false;

      async function* trackedSource() {
        try {
          yield 1;
          yield 2;
          yield 3;
        } finally {
          returnCalled = true;
        }
      }

      for await (const item of gate.wrap(trackedSource())) {
        if (item === 1) break;
      }

      expect(returnCalled).toBe(true);
    });
  });

  describe('Exception Handling', () => {
    it('should release slot when source throws', async () => {
      const gate = new AsyncGate({ concurrency: 1 });

      async function* failingSource() {
        yield 1;
        throw new Error('Source failed');
      }

      const iter = gate.wrap(failingSource());
      await iter.next(); // gets 1, holds slot

      await expect(iter.next()).rejects.toThrow('Source failed');

      // Slot should be released - gate should be available
      const release = await gate.acquire();
      release();
    });

    it('should release slot when consumer throws', async () => {
      const gate = new AsyncGate({ concurrency: 1 });

      try {
        for await (const item of gate.wrap(instant([1, 2, 3]))) {
          if (item === 2) {
            throw new Error('Consumer crashed');
          }
        }
      } catch {
        // Expected
      }

      // Gate should be available
      const release = await gate.acquire();
      release();
    });
  });

  describe('Iterator Exhaustion', () => {
    it('should return done: true after exhaustion', async () => {
      const gate = new AsyncGate({ concurrency: 2 });
      const iter = gate.wrap(instant([1]));

      const r1 = await iter.next();
      expect(r1.done).toBe(false);
      expect(r1.value).toBe(1);

      const r2 = await iter.next();
      expect(r2.done).toBe(true);

      // Subsequent calls should also return done
      const r3 = await iter.next();
      expect(r3.done).toBe(true);
    });

    it('should release slot when source exhausted', async () => {
      const gate = new AsyncGate({ concurrency: 1 });

      for await (const _ of gate.wrap(instant([1]))) {
        // consume
      }

      // Gate should be fully available
      const release = await gate.acquire();
      release();
    });
  });

  describe('With Gate Timeout/Abort', () => {
    it('iterator respects gate timeout via run()', async () => {
      // Note: wrap() itself doesn't take timeout options
      // but the gate's acquire() is used internally
      const gate = new AsyncGate({ concurrency: 1 });

      // Occupy the slot
      const release = await gate.acquire();

      // Try to iterate with timeout by using a workaround
      // (timeout is not directly supported in wrap, documented trade-off)
      const iter = gate.wrap(instant([1, 2, 3]));

      // next() will block because gate is full
      const nextPromise = iter.next();

      // After some delay, release
      setTimeout(() => release(), 50);

      const result = await nextPromise;
      expect(result.value).toBe(1);
    });
  });
});

describe('Original AsyncGate functionality', () => {
  it('run() still works', async () => {
    const gate = new AsyncGate({ concurrency: 2 });
    const result = await gate.run(async () => 42);
    expect(result).toBe(42);
  });

  it('acquire() and release() still work', async () => {
    const gate = new AsyncGate({ concurrency: 1 });
    const release = await gate.acquire();
    release();
  });
});
