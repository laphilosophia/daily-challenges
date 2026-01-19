# Day-05 Challenge

## Circuit Breaking as a Semantic Boundary

*(Node.js / TypeScript)*

### Problem

Circuit breaker’lar genelde şu amaçla kullanılır:

* downstream’i korumak
* load’u kesmek
* latency’yi sınırlamak

Ama bu, **eksik bir tanım**dır.

Async ve context-aware sistemlerde circuit breaker şudur:

> **Causality’nin bilinçli olarak kesildiği bir sınır.**

Bu sınır doğru çizilmezse:

* retry anlamsızlaşır
* context yalan söyler
* gate invariant’ları bozulur
* sistem “çalışıyor gibi” görünür ama semantik olarak çökmüştür

---

### Real Failure Mode

```ts
await store.run({ traceId: "abc" }, async () => {
  await retrier.withGate(gate, async () => {
    await circuit.run(async () => {
      await doWork(); // downstream is failing
    });
  });
});
```

Sorular:

* Circuit **open** iken:

  * Gate slot acquire edilir mi?
  * Retry yapılır mı?
  * Context restore edilir mi?
* Circuit breaker bir **failure policy** mi?
* Yoksa bir **semantic decision** mı?

Bunları netleştirmeden “circuit breaker ekledik” demek yalandır.

---

### Objective

Design a circuit breaker that composes correctly with:

* Day-01 `AsyncGate`
* Day-03 `ContextCarrier`
* Day-04 `Retrier`

and makes the following explicit:

> **When the system decides to stop trying.**

---

### Mandatory Design Questions (cevaplanacak)

1. **Circuit open olduğunda ne kesilir?**

   * execution mı?
   * scheduling mi?
   * causality mi?

2. **Gate ile ilişki**

   * Circuit open iken gate slot acquire edilir mi?
   * Yoksa gate’e hiç girilmez mi?

3. **Retry ile ilişki**

   * Circuit open → retry yapılır mı?
   * Retry circuit’i mi tetikler, circuit retry’ı mı keser?

4. **Context semantics**

   * Circuit rejection’da context restore edilir mi?
   * “Rejected by circuit” ayrı bir causality mi?

5. **Half-open state**

   * Test request hangi context ile çalışır?
   * Gate fairness bozulur mu?

---

### Constraints

* No global mutable flags
* No framework abstractions
* Node.js ≥ 18
* TypeScript
* Single process, single thread

Circuit state **explicit** olmalı.
Implicit magic yasak.

---

### Acceptance Criteria

* Circuit breaker davranışı deterministik
* Gate invariant’ları bozulmuyor
* Retry + circuit birlikteyken net öncelik var
* Context bleed imkânsız
* “Neden çalışmadı?” sorusu cevapsız kalmıyor

---

### Explicit Non-Goals

* Adaptive / ML-based circuits
* Distributed circuit breaking
* Fair scheduling
* Autoscaling

---

### Why This Is Day-05

* Day-01: Capacity — *ne kadar çalışabiliriz*
* Day-02: Rate — *ne hızda çalışmalıyız*
* Day-03: Meaning — *bu iş neyi temsil ediyor*
* Day-04: Continuity — *fail edince ne olur*
* **Day-05: Ethics** — *ne zaman vazgeçeriz*

Circuit breaker, bir optimizasyon değil.
Bir **karar**dır.

---

### Hint (tek tane, bilinçli)

> Retry **ısrar**dır.
> Circuit breaker **kabul**dür.
> İkisi aynı anda kazanamaz.

---

Burada bırakıyorum.

Yarın geldiğinde:

* “şöyle implement ettim” deme
* **“şu noktada bilerek kestim” de**

Bu, serinin en zor günü olacak.
