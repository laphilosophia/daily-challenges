# Day 1: AsyncGate — Async Concurrency Limiter From Scratch

> **TL;DR:** 137 satır TypeScript ile production-grade bir async semaphore yazdık. Hiçbir dış kütüphane yok.

---

## 🎯 Problem

Node.js'te uzun süre yaşayan bir servis düşün. Bu servis dışarıdan async iş alıyor — HTTP, queue, agent loop, webhook.

**Aynı anda çalışan async iş sayısını sınırlamak istiyorsun ama:**

- ✅ İşler FIFO olsun
- ✅ Bekleyen iş iptal edilebilsin
- ✅ Timeout olsun
- ✅ `await` ergonomisi bozulmasın
- ✅ Event loop block edilmesin
- ✅ Promise leak oluşmasın

**Kısıtlar:**
- `p-limit`, `bull`, `bottleneck` vb. **yok**
- `setInterval` / polling **yok**
- Global mutable state **yok**

---

## 💡 Çözüm: AsyncGate

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

## 🏗️ Mimari Kararlar

### 1. Intrusive Linked-List

Queue için array değil, doubly-linked list kullandık. Neden?

```
┌──────┐    ┌──────┐    ┌──────┐
│ Node │◄──►│ Node │◄──►│ Node │
│ res()│    │ res()│    │ res()│
└──────┘    └──────┘    └──────┘
   ▲                        ▲
  head                     tail
```

- **O(1) cancellation** — Node'u ortadan çıkar, sağı sola bağla
- **O(1) enqueue/dequeue** — Head ve tail pointer'ları
- **Polling yok** — Push-based architecture

### 2. Deferred Pattern

Promise'ın kendisini kuyrukta tutmak yerine, `resolve/reject` callback'lerini tutuyoruz:

```typescript
interface WaitNode {
  resolve: (release: ReleaseFunction) => void;
  reject: (error: Error) => void;
  prev: WaitNode | null;
  next: WaitNode | null;
  settled: boolean;  // Race condition koruması
}
```

Bu sayede:
- Promise caller'da kalır (memory leak yok)
- Cancellation sadece `unlink()` çağırmak
- Timeout sadece `reject()` çağırmak

### 3. Single-Shot Guard

Edge case: `dispatch()` ile `onAbort` aynı tick'te çalışırsa ne olur?

```typescript
const onAbort = () => {
  if (node.settled) return;  // ← Guard
  node.settled = true;
  cleanup();
  reject(new AbortError());
};
```

Bu 3 satır, resolve/reject race condition'ı önlüyor.

---

## 🔍 5 Kritik Soru (ve Cevapları)

### 1. "Concurrency"yi nerede sayıyorum?

`this.running` counter'ında. `acquire()` slot verdiğinde artırılır, `release()` çağrıldığında azaltılır.

### 2. Bekleyen Promise nerede duruyor?

Intrusive doubly-linked list'te. Her node `resolve/reject` callback'ini tutar — Promise'ın kendisini değil.

### 3. Timeout olduğunda invariants nasıl korunuyor?

- Node listeden `unlink()` ile çıkarılır
- Promise `TimeoutError` ile reject edilir
- `running` counter **artırılmaz** — slot hiç verilmedi

### 4. Task reject ederse queue state nasıl garanti?

`run()` helper'ı `finally` bloğunda `release()` çağırır. Manuel `acquire()` kullanımında caller sorumludur.

### 5. Hangi senaryoda bilinçli olarak çöker?

- `concurrency ≤ 0` → Constructor hata fırlatır
- `release()` iki kez çağrılırsa → Error (bug detection)
- AbortSignal already aborted → Immediate reject

---

## ✅ Test Sonuçları

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

## 📊 Sonuç

| Metrik | Değer |
|--------|-------|
| Satır sayısı | 137 (limit: 150) |
| Dış bağımlılık | 0 |
| Test coverage | 7/7 |
| Time complexity | O(1) tüm operasyonlar |

**Lesson learned:** %90 developer bu problemi "kolay" sanır. %90 çözümde memory leak veya race condition vardır. Doğru çözüm küçük ama keskindir.

---

## 🔗 Dosyalar

| Dosya | Açıklama |
|-------|----------|
| [`async-gate.ts`](./async-gate.ts) | Core implementation |
| [`async-gate.test.ts`](./async-gate.test.ts) | Test suite |
| [`challenge.md`](./challenge.md) | Original problem statement |

```bash
npm test  # Çalıştır
```
