/**
 * AsyncGate Test Suite
 * Run: npx tsx async-gate.test.ts
 */

import { AbortError, AsyncGate, TimeoutError } from './async-gate';

const sleep = (ms: number) => new Promise(r => setTimeout(r, ms));

async function test(name: string, fn: () => Promise<void>) {
  try {
    await fn();
    console.log(`✅ ${name}`);
  } catch (e) {
    console.log(`❌ ${name}: ${(e as Error).message}`);
  }
}

async function main() {
  console.log('\n🧪 AsyncGate Test Suite\n');

  // Test 1: FIFO ordering
  await test('FIFO ordering', async () => {
    const gate = new AsyncGate({ concurrency: 1 });
    const order: number[] = [];

    const p1 = gate.run(async () => { await sleep(50); order.push(1); });
    const p2 = gate.run(async () => { order.push(2); });
    const p3 = gate.run(async () => { order.push(3); });

    await Promise.all([p1, p2, p3]);
    if (order.join(',') !== '1,2,3') throw new Error(`Expected 1,2,3 got ${order}`);
  });

  // Test 2: Concurrency limit respected
  await test('Concurrency limit', async () => {
    const gate = new AsyncGate({ concurrency: 2 });
    let concurrent = 0;
    let maxConcurrent = 0;

    const tasks = Array.from({ length: 5 }, () =>
      gate.run(async () => {
        concurrent++;
        maxConcurrent = Math.max(maxConcurrent, concurrent);
        await sleep(50);
        concurrent--;
      })
    );

    await Promise.all(tasks);
    if (maxConcurrent !== 2) throw new Error(`Max concurrent was ${maxConcurrent}`);
  });

  // Test 3: Timeout
  await test('Timeout rejects correctly', async () => {
    const gate = new AsyncGate({ concurrency: 1 });

    // Block the gate
    const release = await gate.acquire();

    // Try to acquire with timeout
    try {
      await gate.acquire({ timeout: 50 });
      throw new Error('Should have timed out');
    } catch (e) {
      if (!(e instanceof TimeoutError)) throw new Error('Wrong error type');
    } finally {
      release();
    }
  });

  // Test 4: Cancellation
  await test('AbortSignal cancellation', async () => {
    const gate = new AsyncGate({ concurrency: 1 });
    const release = await gate.acquire();

    const controller = new AbortController();
    const promise = gate.acquire({ signal: controller.signal });

    // Cancel while waiting
    setTimeout(() => controller.abort(), 20);

    try {
      await promise;
      throw new Error('Should have aborted');
    } catch (e) {
      if (!(e instanceof AbortError)) throw new Error('Wrong error type');
    } finally {
      release();
    }
  });

  // Test 5: Double-release throws
  await test('Double-release protection', async () => {
    const gate = new AsyncGate({ concurrency: 1 });
    const release = await gate.acquire();
    release();

    try {
      release();
      throw new Error('Should have thrown');
    } catch (e) {
      if (!(e as Error).message.includes('twice')) throw e;
    }
  });

  // Test 6: Task rejection doesn't break queue
  await test('Rejection doesnt break queue', async () => {
    const gate = new AsyncGate({ concurrency: 1 });

    try {
      await gate.run(async () => { throw new Error('Task failed'); });
    } catch { }

    // Queue should still work
    let called = false;
    await gate.run(async () => { called = true; });
    if (!called) throw new Error('Queue broken after rejection');
  });

  // Test 7: Already-aborted signal
  await test('Pre-aborted signal rejects immediately', async () => {
    const gate = new AsyncGate({ concurrency: 1 });
    const controller = new AbortController();
    controller.abort();

    try {
      await gate.acquire({ signal: controller.signal });
      throw new Error('Should have rejected');
    } catch (e) {
      if (!(e instanceof AbortError)) throw new Error('Wrong error type');
    }
  });

  console.log('\n✨ All tests complete!\n');
}

main();
