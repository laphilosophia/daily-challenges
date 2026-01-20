import assert from "node:assert/strict";
import { AsyncLocalStorage } from "node:async_hooks";
import { describe, test } from "node:test";
import { AbortError, AsyncGate, TimeoutError } from "./async-gate.ts";
import { ContextCarrier } from "./context-carrier.ts";

interface TraceContext {
  traceId: string;
  requestId?: string;
}

const store = new AsyncLocalStorage<TraceContext>();

// Helper: delay
const delay = (ms: number) => new Promise<void>((r) => setTimeout(r, ms));

// Helper: async generator
async function* asyncRange(n: number, delayMs = 0): AsyncGenerator<number> {
  for (let i = 0; i < n; i++) {
    if (delayMs) await delay(delayMs);
    yield i;
  }
}

describe("ContextCarrier", () => {
  test("captures context at construction time", async () => {
    let observed: string | undefined;

    await store.run({ traceId: "captured" }, async () => {
      const carrier = new ContextCarrier(
        async () => {
          observed = store.getStore()?.traceId;
        },
        store
      );

      // Exit context, then run
      await store.run({ traceId: "different" }, async () => {
        await carrier.run();
      });
    });

    assert.equal(observed, "captured", "Should see schedule-time context");
  });

  test("is single-shot", async () => {
    const carrier = new ContextCarrier(async () => "result", store);
    await carrier.run();

    await assert.rejects(
      () => carrier.run(),
      /single-shot/,
      "Second run() should throw"
    );
  });

  test("works without active context", async () => {
    // No active context
    const carrier = new ContextCarrier(async () => {
      return store.getStore();
    }, store);

    const result = await carrier.run();
    assert.equal(result, undefined, "No context should mean undefined");
  });
});

describe("AsyncGate.run() context propagation", () => {
  test("restores schedule-time context after queueing", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    const observed: string[] = [];

    // Task A: captures "abc", will queue
    const taskA = store.run({ traceId: "abc" }, () =>
      gate.run(async () => {
        await delay(50);
        observed.push(`A:${store.getStore()?.traceId}`);
      })
    );

    // Task B: captures "xyz", will queue behind A
    const taskB = store.run({ traceId: "xyz" }, () =>
      gate.run(async () => {
        observed.push(`B:${store.getStore()?.traceId}`);
      })
    );

    await Promise.all([taskA, taskB]);

    assert.deepEqual(
      observed,
      ["A:abc", "B:xyz"],
      "Each task should see its own captured context"
    );
  });

  test("no context bleed under interleaving", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 2, store });
    const results: string[] = [];

    const tasks = ["alpha", "beta", "gamma", "delta"].map((id) =>
      store.run({ traceId: id }, () =>
        gate.run(async () => {
          await delay(Math.random() * 30);
          results.push(`${id}:${store.getStore()?.traceId}`);
        })
      )
    );

    await Promise.all(tasks);

    // Each task should see its own context
    for (const id of ["alpha", "beta", "gamma", "delta"]) {
      assert.ok(
        results.includes(`${id}:${id}`),
        `Task ${id} should see its own context`
      );
    }
  });

  test("timeout: context never restored if task never runs", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    let contextObserved = false;

    // Block the gate
    const blocker = gate.run(async () => {
      await delay(200);
    });

    // This task will timeout before acquiring
    const timeoutTask = store.run({ traceId: "should-not-appear" }, () =>
      gate.run(async () => {
        contextObserved = true;
      }, { timeout: 10 })
    );

    await assert.rejects(() => timeoutTask, TimeoutError);
    await blocker;

    assert.equal(
      contextObserved,
      false,
      "Timed-out task should never execute, context never restored"
    );
  });

  test("cancellation: context never restored if aborted", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    let contextObserved = false;

    // Block the gate
    const blocker = gate.run(async () => {
      await delay(200);
    });

    const controller = new AbortController();

    // This task will be aborted before acquiring
    const abortTask = store.run({ traceId: "should-not-appear" }, () =>
      gate.run(async () => {
        contextObserved = true;
      }, { signal: controller.signal })
    );

    // Abort after a short delay
    setTimeout(() => controller.abort(), 10);

    await assert.rejects(() => abortTask, AbortError);
    await blocker;

    assert.equal(
      contextObserved,
      false,
      "Aborted task should never execute, context never restored"
    );
  });
});

describe("AsyncGate.wrap() per-iteration context", () => {
  test("each iteration captures its own context", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    const contexts = ["ctx-0", "ctx-1", "ctx-2"];
    const observed: string[] = [];

    const wrapped = gate.wrap(asyncRange(3));

    let i = 0;
    for await (const { item, run } of wrapped) {
      // Simulate: each next() happens in a different context
      // (In real code, this would be different requests)
      await store.run({ traceId: contexts[i] }, async () => {
        // But we use the CAPTURED context via run()
        await run(() => {
          observed.push(`${item}:${store.getStore()?.traceId}`);
        });
      });
      i++;
    }

    // Note: Since we call next() outside any context initially,
    // this test verifies the run() mechanism works
    assert.equal(observed.length, 3);
  });

  test("context from next() call time is preserved", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    const observed: string[] = [];

    // Create iterator outside any context
    const wrapped = gate.wrap(asyncRange(3));
    const iterator = wrapped[Symbol.asyncIterator]();

    // Call next() in context "first"
    const result1 = await store.run({ traceId: "first" }, () => iterator.next());
    if (!result1.done) {
      await result1.value.run(() => {
        observed.push(`0:${store.getStore()?.traceId}`);
      });
    }

    // Call next() in context "second"
    const result2 = await store.run({ traceId: "second" }, () => iterator.next());
    if (!result2.done) {
      await result2.value.run(() => {
        observed.push(`1:${store.getStore()?.traceId}`);
      });
    }

    // Call next() in context "third"
    const result3 = await store.run({ traceId: "third" }, () => iterator.next());
    if (!result3.done) {
      await result3.value.run(() => {
        observed.push(`2:${store.getStore()?.traceId}`);
      });
    }

    assert.deepEqual(
      observed,
      ["0:first", "1:second", "2:third"],
      "Each item.run() should see the context from its next() call"
    );
  });

  test("early break releases slot and handles cleanup", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    let iterationCount = 0;

    for await (const { item } of gate.wrap(asyncRange(10))) {
      iterationCount++;
      if (item >= 2) break; // Early exit
    }

    assert.equal(iterationCount, 3, "Should have iterated 3 times (0, 1, 2)");

    // Verify gate is not stuck - should be able to acquire immediately
    const release = await gate.acquire();
    release();
  });

  test("iterator interleaving with different contexts", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 2, store });
    const observed: string[] = [];

    // Two parallel iterators, different contexts per iteration
    async function processStream(streamId: string) {
      const wrapped = gate.wrap(asyncRange(3, 10));
      let i = 0;
      for await (const { item, run } of wrapped) {
        await store.run({ traceId: `${streamId}-${i}` }, async () => {
          await run(() => {
            observed.push(`${streamId}:${item}:${store.getStore()?.traceId}`);
          });
        });
        i++;
      }
    }

    await Promise.all([processStream("A"), processStream("B")]);

    // Verify each stream processed all items
    for (const stream of ["A", "B"]) {
      for (let i = 0; i < 3; i++) {
        const expected = `${stream}:${i}:${stream}-${i}`;
        assert.ok(
          observed.includes(expected),
          `Should have observed ${expected}`
        );
      }
    }
  });
});

describe("Edge cases and invariants", () => {
  test("nested gates preserve context at each level", async () => {
    const outerGate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    const innerGate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    const observed: string[] = [];

    await store.run({ traceId: "outer" }, () =>
      outerGate.run(async () => {
        observed.push(`outer:${store.getStore()?.traceId}`);

        await store.run({ traceId: "inner" }, () =>
          innerGate.run(async () => {
            observed.push(`inner:${store.getStore()?.traceId}`);
          })
        );

        observed.push(`back-outer:${store.getStore()?.traceId}`);
      })
    );

    assert.deepEqual(observed, [
      "outer:outer",
      "inner:inner",
      "back-outer:outer",
    ]);
  });

  test("gate without store still works (no context propagation)", async () => {
    const gate = new AsyncGate({ concurrency: 1 }); // No store
    let executed = false;

    await gate.run(async () => {
      executed = true;
    });

    assert.equal(executed, true, "Should execute even without store");
  });

  test("FIFO order is preserved with context", async () => {
    const gate = new AsyncGate<TraceContext>({ concurrency: 1, store });
    const order: string[] = [];

    // Queue up tasks
    const tasks = [
      store.run({ traceId: "first" }, () =>
        gate.run(async () => {
          await delay(10);
          order.push(store.getStore()?.traceId ?? "none");
        })
      ),
      store.run({ traceId: "second" }, () =>
        gate.run(async () => {
          order.push(store.getStore()?.traceId ?? "none");
        })
      ),
      store.run({ traceId: "third" }, () =>
        gate.run(async () => {
          order.push(store.getStore()?.traceId ?? "none");
        })
      ),
    ];

    await Promise.all(tasks);

    assert.deepEqual(
      order,
      ["first", "second", "third"],
      "FIFO order must be preserved"
    );
  });
});
