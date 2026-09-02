# Тесты

Прогон схемы БД и роутов API на настоящем Postgres (pglite — WASM, **Docker не нужен**).
`@fastify/helmet`, `rate-limit`, `cors`, `initData`, транзакции, FK-каскады — всё по-настоящему.

```bash
npm --prefix app install      # если ещё не
npm --prefix app run build    # нужен собранный app/dist
npm --prefix test install
npm --prefix test test
```

- `run.mjs` — `schema.sql` (в т.ч. повторный запуск), CHECK, ON CONFLICT, динамический UPDATE анкеты, FK-каскад, ключевые SELECT.
- `boot.mjs` — бэкенд поднимается со всеми плагинами; `/api/health`, 401 без initData, заголовки безопасности, 404, отказ поддельному initData.
- `authed.mjs` — сквозные сценарии с валидным initData: сохранение анкеты, валидация (18+, вилка бюджета, enum), `/api/candidates/preview`, подбор, лайки, взаимный мэтч, создание/подтверждение/выход из группы, `:id` квартиры.
