# Тесты и локальная проверка

## 1. Автотесты (без Docker и Telegram)

Прогон схемы БД и роутов API на настоящем Postgres (pglite — WASM).
`@fastify/helmet`, `rate-limit`, `cors`, `initData`, транзакции, FK-каскады — по-настоящему.

```bash
npm --prefix app install
npm --prefix app run build      # нужен собранный app/dist
npm --prefix test install
npm --prefix test test
```

- `run.mjs` — `schema.sql` (в т.ч. повторный запуск), CHECK, ON CONFLICT, динамический
  UPDATE анкеты, FK-каскад, ключевые SELECT.
- `boot.mjs` — бэкенд со всеми плагинами: `/api/health`, 401 без initData, заголовки
  безопасности, 404, отказ поддельному initData.
- `authed.mjs` — сквозные сценарии с валидным initData: сохранение анкеты, валидация
  (18+, вилка бюджета, enum), `/api/candidates/preview`, подбор, лайки, взаимный мэтч,
  создание/подтверждение/выход из группы.

## 2. Посмотреть мини-апп в браузере (без Docker и Telegram)

Мини-апп на каждый запрос шлёт заголовок `x-init-data` = `Telegram.WebApp.initData` —
подписанную строку, которую Telegram выдаёт только внутри своего клиента. Вне Telegram
она пустая → после анкеты будет 401. Поэтому локально её подписываем сами
(`test/sign.mjs`) и подставляем через `VITE_DEV_INITDATA` (работает только в `vite dev`,
в прод-сборке `import.meta.env.DEV === false`). База — встроенный Postgres (WASM), файлы
в `test/.pgdata`.

### Первый запуск

1. Поставить зависимости:
   ```bash
   npm --prefix app install
   npm --prefix webapp install
   npm --prefix test install
   ```
2. **Терминал 1** — API на `:3000` (встроенный Postgres, без бота):
   ```bash
   node test/dev-server.mjs
   ```
   Сам пересобирает `app/dist` при старте. Поменяла код в `app/src` — `Ctrl+C` и запусти заново.
3. **Терминал 2** — мини-апп:
   ```bash
   cd webapp
   VITE_DEV_INITDATA="$(node ../test/sign.mjs 111 Аня @ann)" npm run dev
   ```
4. Открыть **http://localhost:5173**. Пройти анкету — всё сохраняется, экраны авторизованы.

### Проверить подбор / мэтч / группу

5. **Терминал 3** — создать тестовых соседей:
   ```bash
   node test/seed.mjs          # Марк, Лена, Дима (совместимые анкеты)
   ```
6. Пройти свою анкету в браузере (если ещё не), затем ещё раз:
   ```bash
   node test/seed.mjs          # теперь соседи лайкают тебя
   ```
7. Обновить страницу. Вкладка «Соседи» — 3 карточки. Лайк любого → сразу взаимный мэтч
   → вкладка «Группа» → выбрать соседей → «Создать группу» → «Подтвердить участие» →
   вкладка «Квартиры».

### Сбросить всё и начать заново

```bash
# Ctrl+C в терминале дев-сервера, затем:
FRESH=1 node test/dev-server.mjs
```
В браузере — жёсткое обновление (`Cmd+Shift+R`). Если зависла половина анкеты — в консоли
DevTools: `localStorage.clear()`.

### Второй «живой» пользователь в отдельном окне (необязательно)

```bash
cd webapp
VITE_DEV_INITDATA="$(node ../test/sign.mjs 222 Марк)" npm run dev -- --port 5174
```

`node test/sign.mjs [id] [Имя] [@username]` печатает строку `initData` — её же можно
класть в заголовок `x-init-data` для `curl` / Postman.

## 3. Мини-апп внутри Telegram (полностью настоящее)

1. `@BotFather` → создать бота, получить `BOT_TOKEN`.
2. `@BotFather` → Bot Settings → Menu Button / `/newapp` → указать URL мини-аппа (HTTPS).
3. Публичный HTTPS на локалку: туннель, например
   `cloudflared tunnel --url http://localhost:3000`.
4. `cp .env.example .env`, вписать реальный `BOT_TOKEN` и `WEBAPP_URL` = адрес туннеля,
   `docker compose up -d --build` (webapp тогда отдаётся самим бэкендом с `:3000`).
5. Открыть бота в Telegram → кнопка мини-аппа. initData настоящий, всё авторизовано.
   Команды бота (`/start`, `/help`, `/delete_me`) — просто в чате с ботом.
