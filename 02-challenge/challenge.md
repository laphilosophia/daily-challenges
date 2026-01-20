# Day-2: Backpressure-Aware Async Iterator - Design Document

## Executive Summary

AsyncGate'e `wrap(source)` metodu ekleniyor. Bu metod herhangi bir `AsyncIterable<T>`'yi backpressure-aware iterator'a dönüştürür.

**Bu bir Node Stream DEĞİLDİR.** ReadableStream, Transform, veya Node.js stream API'larıyla ilgisi yoktur.

---

## Core Design Decisions

### 1. Acquisition Timing: `next()` Anında

**Karar:** Slot, `next()` çağrısında ve source iterator'dan item çekilmeden **önce** acquire edilir.

```
Consumer calls next()
        ↓
    [ACQUIRE SLOT] ← Backpressure burada oluşur
        ↓
    source.next()
        ↓
    Return item to consumer
```

**Neden bu tek doğru nokta:**

| Alternatif | Sorun |
|------------|-------|
| `yield` anında acquire | Producer zaten çalıştı, backpressure geç kaldı |
| Consumer `process()` sırasında | Anlamsız - item zaten geldi |
| Internal buffer'da | Buffer = backpressure'ın reddi |

**Kabul edilen bedel:**
- Slot acquire edilip `done: true` dönebilir (source bitti)
- Slot acquire edilip source hata fırlatabilir
- Bu durumlarda slot **mutlaka** release edilmeli

---

### 2. Release Guarantee: Iterator-Managed, Not Consumer-Managed

**Karar:** Release mekanizması **consumer'a bırakılmaz**. Iterator kendisi enforce eder.

**Problem:** JS'de `for await` body'sine "after hook" yok.

```ts
for await (const item of wrapped) {
  await process(item);  // ← Burada crash olursa?
}
```

**Çözüm: Next-Triggers-Previous-Release Pattern**

```
next() #1 → acquire slot → return item #1
                          ↓
next() #2 → RELEASE slot #1 → acquire slot → return item #2
                                            ↓
next() #3 → RELEASE slot #2 → acquire slot → return item #3
                                            ↓
iteration ends → return() → RELEASE slot #3
```

**Mekanik:**
- Her `next()` çağrısı, **önceki item'ın slot'unu release eder**
- Son item'ın release'i `return()` veya `throw()`'da yapılır
- Consumer hiçbir zaman explicit release çağırmaz

**Trade-off:**
- Concurrency semantiği kayıyor: Slot, consumer processing sırasında değil, **next item istenmeden önce** tutuluyor
- Bu kabul edilebilir çünkü: Backpressure hedefi "producer'ı yavaşlatmak", consumer'ı değil

---

### 3. Iterator Contract: `return()` ve `throw()` Zorunlu

**Karar:** Her iki metod da implement edilmeli. Bunlar "nice to have" değil, **correctness şartı**.

| Durum | Tetikleyen | Yapılması gereken |
|-------|------------|-------------------|
| `break` | `return()` | Pending slot release + source.return() |
| `return` in body | `return()` | Pending slot release + source.return() |
| `throw` in body | `throw(e)` | Pending slot release + source.throw(e) |

**Neden zorunlu:**
- Consumer "işim bitti" demez, JS motoru iterator'a söyler
- Bunu handle etmezsen: slot leak + source iterator zombi state

```ts
return(value?: TReturn): Promise<IteratorResult<T, TReturn>> {
  if (this.pendingRelease) {
    this.pendingRelease();
    this.pendingRelease = null;
  }
  return this.source.return?.(value) ?? Promise.resolve({ done: true, value });
}
```

---

### 4. Failure Semantics: Intentional Failure Scenarios

**Karar:** Aşağıdaki senaryolar **bilerek desteklenmez** ve ya throw ya da undefined behavior olarak belgelenir.

#### 4.1 Parallel `next()` Calls (Fan-out)

```ts
// YANLIŞ KULLANIM
const a = iterator.next();
const b = iterator.next();  // ← İkinci çağrı
await Promise.all([a, b]);
```

**Davranış:** Undefined behavior. İkinci `next()` çağrısı önceki release'i trigger edebilir, ordering bozulabilir.

**Neden throw etmiyoruz:** Detection maliyeti var (state tracking). Bu challenge scope'unda documented UB olarak bırakıyoruz.

#### 4.2 Re-entrancy

```ts
for await (const item of wrapped) {
  await process(item);
  const peek = await wrapped.next();  // ← Re-entrant çağrı
}
```

**Davranış:** Undefined behavior. Aynı iterator instance'ı üzerinde nested iteration.

#### 4.3 Iterator Reuse After Exhaustion

```ts
const iter = gate.wrap(source);
for await (const x of iter) { /* ... */ }
for await (const x of iter) { /* ... */ }  // ← İkinci kullanım
```

**Davranış:** İkinci loop hiç item döndürmez (`done: true` immediately). Bu doğru davranış - iterator consumed.

---

## Implementation Invariants

```
INV-1: running <= concurrency (her zaman)
INV-2: pendingRelease !== null ⟺ bir item consumer'da (release bekliyor)
INV-3: source.next() sadece slot acquire edildikten sonra çağrılır
INV-4: return()/throw() çağrılınca pendingRelease temizlenir
```

---

## API Surface

```ts
class AsyncGate {
  // ... existing methods ...

  /**
   * Wraps an async iterable with backpressure awareness.
   *
   * Slot acquisition: Before each source.next()
   * Slot release: On subsequent next() or iterator cleanup
   *
   * NOT a Node stream. No buffering. No polling.
   */
  wrap<T>(source: AsyncIterable<T>): AsyncIterableIterator<T>;
}
```

---

## Explicit Trade-offs

| Trade-off | Kabul Edilen | Alternatif Reddedildi Çünkü |
|-----------|--------------|----------------------------|
| Slot, item döndükten sonra tutulmaya devam eder | Consumer processing sırasında slot tutuluyor | Consumer'a release bırakmak → leak garantisi |
| `done: true` için de slot acquire edilir | Wasted slot acquisition | Source'un bitip bitmediğini bilmeden acquire edemezsin |
| Parallel `next()` desteklenmiyor | Documented UB | Detection overhead + complexity |
| Plain `T` yerine mekanizma | - | Bu tasarımda plain `T` dönüyor, release next-triggers-previous |

---

## Implementation Checklist

- [ ] `wrap<T>(source)` metodu
- [ ] `next()` → release previous + acquire + source.next()
- [ ] `return()` → release pending + source.return()
- [ ] `throw()` → release pending + source.throw()
- [ ] `[Symbol.asyncIterator]()` → return this
- [ ] Test: Normal iteration
- [ ] Test: Break mid-iteration
- [ ] Test: Exception in consumer
- [ ] Test: Source exhaustion

---

## Line Budget

Target: ≤180 lines (challenge constraint)

| Component | Estimate |
|-----------|----------|
| Existing AsyncGate | ~110 lines |
| `wrap()` method | ~10 lines |
| Iterator implementation | ~50 lines |
| **Total** | ~170 lines |
