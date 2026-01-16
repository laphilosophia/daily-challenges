# 🎯 Daily Coding Challenges

Günlük coding challenge'lar — her gün bir problem, bir çözüm, bir blog yazısı.

## Structure

```
challenge/
├── day-1/   # AsyncGate - Async concurrency limiter
├── day-2/   # ...
├── day-3/   # ...
└── ...
```

## Philosophy

- **Gerçek problemler** — Teorik değil, production'da karşılaşılan sorunlar
- **Kısıtlı çözümler** — Dış kütüphane yok, temel prensiplerden inşa
- **150 satır limiti** — Keskin, minimal, test edilebilir kod
- **5 kritik soru** — Her challenge tasarım kararlarını sorgular

## Challenges

| Day | Challenge | Keywords |
|-----|-----------|----------|
| 1 | [AsyncGate](./day-1/) | concurrency, semaphore, FIFO, cancellation |

## Running

```bash
# Install all dependencies
npm install

# Run all tests
npm test

# Run specific day
cd day-1 && npm test
```

## License

MIT
