# Day-04 Challenge

## Retry Semantics Under Preserved Causality (Node.js / TypeScript)

### Problem

Retry mekanizmaları genellikle “operational” bir detay gibi ele alınır:

* exponential backoff
* max attempts
* jitter

Ama async sistemlerde retry, **causality**’yi doğrudan etkiler.

> Bir iş retry edildiğinde:
> **aynı iş mi devam ediyor, yoksa yeni bir iş mi doğuyor?**

Bu soru cevaplanmadan:

* context propagation
* observability
* gate fairness
* backpressure

tutarlı olamaz.

---

### Real Failure Mode

```ts
ctx.run({ traceId: "abc" }, async () => {
  await gate.run(async () => {
    await retry(async () => {
      await doWork(); // fails, retries
    });
  });
});
```

Sorular:

* Retry edilen attempt’ler **aynı context’i mi görmeli?**
* Her retry yeni bir schedule mı?
* Backoff sırasında gate ne yapıyor?
* Bu retry başka task’ları starve edebilir mi?

Hiçbiri varsayımla geçiştirilemez.

---

### Objective

Design a retry mechanism that composes correctly with:

* Day-01 `AsyncGate`
* Day-02 backpressure-aware async iterator
* Day-03 context capture & restore (`ContextCarrier`)

while making **causality explicit**.

---

### Mandatory Design Questions (cevaplanacak)

1. **Retry context modeli nedir?**

   * Same context (idempotent causality)
   * New context per attempt
   * Parent / child (derived causality)

2. **Context ne zaman capture edilir?**

   * initial attempt
   * each retry schedule
   * execution time

3. **Gate + retry etkileşimi**

   * Backoff sırasında slot tutulur mu?
   * Slot release → retry → re-acquire mi?
   * Retry gate fairness’i bozar mı?

4. **Exponential backoff’un yan etkileri**

   * Latency vs throughput
   * Starvation riski
   * Queue re-ordering

5. **Cancellation ve timeout**

   * Retry beklerken cancel gelirse ne olur?
   * Context restore edilir mi?
   * Partial causality mümkün mü?

---

### Constraints

* No global mutable state
* No Promise monkey-patching
* No framework-level abstractions
* Node.js ≥ 18
* TypeScript
* Single process, single thread

Retries must be **explicitly scheduled**, not hidden.

---

### Acceptance Criteria

* Retry behavior is deterministic
* Causality is explicit and documented
* Gate invariants are preserved
* Context bleed is impossible
* Starvation risks are acknowledged

---

### Explicit Non-Goals

* Fair scheduling
* Priority queues
* Distributed retries
* Cross-process propagation

Those belong to another series.

---

### Why This Is Day-04

* Day-01: capacity
* Day-02: rate
* Day-03: meaning
* **Day-04: continuity**

Retry is where systems quietly lie.

This challenge is about forcing them to tell the truth.

---

Burada bırakıyoruz.
Yarın geldiğinde:

* “şöyle yaptım” deme
* **“şu garantiyi bilerek vermiyorum” de**

İyi geceler.
