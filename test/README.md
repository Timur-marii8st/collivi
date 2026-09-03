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

## 2. Мини-апп локально в браузере (без Docker и Telegram)

Мини-апп на каждый запрос шлёт `x-init-data` = `Telegram.WebApp.initData` — подписанную
строку, которую Telegram выдаёт только внутри своего клиента. Вне Telegram она пустая,
поэтому после анкеты — 401. Локально её можно подписать самому (`test/sign.mjs`) и
подсунуть через `VITE_DEV_INITDATA` (работает только в `vite dev`, в прод-сборке
`import.meta.env.DEV === false`). База — тот же встроенный Postgres, что и в тестах.

```bash
npm --prefix test install

# терминал 1 — API на :3000 (встроенный Postgres, без бота).
# Сам пересобирает app/dist при старте — после правок бэкенда просто перезапусти.
node test/dev-server.mjs

# терминал 2 — мини-апп с самоподписанным initData
cd webapp
VITE_DEV_INITDATA="$(node ../test/sign.mjs 111 Аня @ann)" npm run dev
# открыть http://localhost:5173 — форма сохранится, все экраны авторизованы
```

**Важно:** дев-сервер загружает код бэкенда один раз при старте. Поменяла что-то в
`app/src` — **перезапусти `node test/dev-server.mjs`** (он сам пересоберёт).

### Соседи для проверки подбора / мэтча / групп

Не нужен второй браузер — есть скрипт, который создаёт готовых соседей:

```bash
node test/seed.mjs          # создаёт Марка, Лену, Диму (совместимые анкеты)
# пройди свою анкету в браузере
node test/seed.mjs          # запусти ещё раз — теперь они лайкают тебя
```

После второго запуска: открываешь мини-апп, во вкладке «Соседи» три карточки —
лайкаешь любого → сразу взаимный мэтч → вкладка «Группа» → собираешь группу.

`node test/sign.mjs [id] [Имя] [@username]` печатает строку initData —
её же можно класть в заголовок `x-init-data` для curl/Postman.

### Сбросить профили и начать заново

Данные в `test/.pgdata`. Перезапусти дев-сервер с чистой базой:

```bash
# Ctrl+C в терминале дев-сервера, затем:
FRESH=1 node test/dev-server.mjs
```

В браузере — жёсткое обновление (Cmd+Shift+R). Если осталась половина анкеты —
в консоли DevTools: `localStorage.clear()`.

Если всё-таки хочешь второго «живого» пользователя в отдельном окне:

```bash
cd webapp
VITE_DEV_INITDATA="$(node ../test/sign.mjs 222 Марк)" npm run dev -- --port 5174
```

## 3. Мини-апп внутри Telegram (полностью настоящее)

1. `@BotFather` → создать бота, получить `BOT_TOKEN`.
2. `@BotFather` → Bot Settings → Menu Button / `/newapp` → указать URL мини-аппа (HTTPS).
3. Публичный HTTPS на локалку: туннель, например
   `cloudflared tunnel --url http://localhost:3000`.
4. `cp .env.example .env`, вписать реальный `BOT_TOKEN` и `WEBAPP_URL` = адрес туннеля,
   `docker compose up -d --build` (webapp тогда отдаётся самим бэкендом с `:3000`).
5. Открыть бота в Telegram → кнопка мини-аппа. initData настоящий, всё авторизовано.
   Команды бота (`/start`, `/help`, `/delete_me`) — просто в чате с ботом.
