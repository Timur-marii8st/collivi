# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Что это

«Свои» — Telegram Mini App + бот для совместной аренды в Казани: анкета → мэтчинг
совместимых соседей → группа 3–4 человека → подборка квартир под общий бюджет.
Продуктовый контекст (мэтчинг, воронка, юнит-экономика, roadmap) — в `docs/PROJECT.md`.
Язык интерфейса и комментариев — русский.

## Команды

```bash
# backend (TypeScript → dist/, запуск API+бота)
cd app && npm i && npm run build && npm start
cd app && npm run dev            # то же одной командой (tsc && node dist/index.js)
cd app && npx tsc --noEmit       # проверка типов без сборки

# Mini App (dev-сервер Vite на :5173, /api проксируется на :3000)
cd webapp && npm i && npm run dev
cd webapp && npm run build       # → webapp/dist

# прод / полный стек
cp .env.example .env             # BOT_TOKEN, ADMIN_IDS, WEBAPP_URL обязательны
docker compose up -d --build
docker compose logs -f app
```

Тестов и линтеров в проекте нет — фреймворк тестирования не настроен. Проверка =
`npx tsc --noEmit` в `app/` плюс `vite build` в `webapp/`. Единственный health-эндпоинт
без авторизации: `GET /api/health`.

Свой Telegram ID: пока `ADMIN_IDS` пуст, бот логирует id каждого входящего сообщения
(`docker compose logs app`).

## Архитектура

Один Node-процесс делает три вещи (`app/src/index.ts`): применяет схему БД, поднимает
Fastify (API + раздача статики Mini App из `../public`), затем запускает бота на long
polling. Порядок важен: БД → HTTP → бот.

- `app/src/api.ts` — REST для Mini App. Глобальный `onRequest`-хук проверяет заголовок
  `x-init-data` для всех `/api/*` (кроме `/api/health`) через `auth.ts` (HMAC по
  алгоритму Telegram, initData валиден 24 часа) и кладёт пользователя в `req.tgUser`.
  Отдельного слоя моделей нет — SQL пишется прямо в обработчиках.
- `app/src/matching.ts` — `hardConflict()` (жёсткий отсев: бюджет ±5000, пересечение
  районов с учётом «Любой», ступень `move_in`, пол, курение, питомцы) и `softScore()`
  (0–100 по сну/чистоте/гостям/вечеринкам/алкоголю/общительности/интересам/возрасту).
  Если при ±5000 кандидатов ноль, `getCandidates()` повторяет отсев с бюджетом ±10000
  (фолбэк холодного старта; остальные фильтры не ослабляются).
  Скоринг целиком в памяти: `getCandidates()` выгружает всех активных пользователей
  одним запросом и фильтрует в JS.
- `app/src/bot.ts` — команды, callback-и подтверждения группы, админка. Хранит
  состояние админских диалогов в grammY-session **в памяти** — рестарт процесса теряет
  незавершённый черновик квартиры.
- `app/src/notify.ts` — исходящие уведомления и `openAppKeyboard()` (кнопка `web_app`,
  требует публичный HTTPS `WEBAPP_URL`).
- `webapp/src/` — React без роутера: `App.jsx` держит 4 таба в состоянии, при
  `!me.onboarded` показывает `Onboarding`. Все запросы идут через `api()` из
  `webapp/src/api.js`, который сам подставляет `x-init-data` из `window.Telegram.WebApp`.
  Вне Telegram приложение не аутентифицируется — все `/api/*` вернут 401.

Импорты: `api.ts` импортирует `bot` из `bot.ts`, а `bot.ts` подтягивает `notify.ts`
динамическим `await import` внутри `checkGroupComplete` — так разорван цикл. Не
превращать этот динамический импорт в статический.

## Схема БД и миграции

Миграционного инструмента нет. `app/src/schema.sql` — идемпотентные
`CREATE TABLE IF NOT EXISTS`, применяется на каждом старте в `initDb()` (`db.ts`).
Следствие: **добавление колонки в существующую таблицу правкой `schema.sql` не
сработает** на живой БД — нужен отдельный `ALTER TABLE ... IF NOT EXISTS` запрос в
`initDb()`, рядом с уже существующей миграцией `prefer_gender = gender`.

`Dockerfile` копирует `app/src/schema.sql` в `dist/` явной строкой — любой новый
не-TS ресурс, нужный в рантайме, надо так же добавить в образ.

`tg_id` — `BIGINT`, из `pg` приходит строкой; в коде местами `String(...)`, местами
число из `ctx.from.id`. При сравнениях приводить типы явно.

## Жизненный цикл группы

`groups.status`: `forming` → `confirmed` → `searching`; `users.status`: `active` /
`in_group`. Группа создаётся через `POST /api/group/create` (только из взаимных лайков,
максимум 4 участника, у каждого не должно быть активной группы; весь чек+инсерт — в
одной транзакции с локом строк участников) — участникам уходит инвайт с кнопками
`grp_yes/grp_no`. Переход в `confirmed`, смена `users.status` и уведомления происходят
в `checkGroupComplete()` (`bot.ts`, экспортирована), которую вызывает и callback бота,
и `POST /api/group/confirm` — подтверждение работает и из бота, и из Mini App.
При выходе/отказе, если в группе осталось меньше двух человек, она распускается.

Лента квартир (`GET /api/apartments`) считает бюджет как **минимальный** среди
участников и допускает `price/rooms <= minBudget + 3000`; та же формула повторена в
`offerAptToGroups()` в боте — менять надо в обоих местах.

## Дублирующиеся справочники

Список районов задан дважды: `DISTRICTS` в `app/src/bot.ts` и в
`webapp/src/screens/Onboarding.jsx`. Строковые значения анкеты (`move_in`, `smoking`,
`alcohol`, `guests`, `parties`, `sociability`, `gender`) — договорённость между
`Onboarding.jsx`, валидацией в `POST /api/me` и `matching.ts`; при изменении варианта
править все три места.

Правило однополых групп продублировано трижды: проверка `gender` в `hardConflict()`,
принудительное `prefer_gender = gender` в `POST /api/me` и миграция в `initDb()`.
Колонка `prefer_gender` фактически не используется в мэтчинге.

## Админ-панель

Веб-панель живёт в Mini App: `webapp/src/screens/admin/` (шелл `Admin.jsx` + разделы
`AdminOverview`, `AdminUsers`, `AdminUser`, `AdminGroups`, `AdminApartments`,
общие справочники в `meta.js`, форма-поле в `Field.jsx`). Вкладка «Админка» в
`App.jsx` показывается, только если `GET /api/me` вернул `is_admin: true`
(вычисляется из `ADMIN_IDS`); админ без анкеты не отправляется в онбординг.

Бэкенд — `app/src/admin.ts`, регистрируется из `registerApi()` **после** хука
аутентификации, поэтому его собственный `onRequest` уже видит `req.tgUser` и режет
всё под `/api/admin` для не-админов (403). Правка полей идёт через белый список
`EDITABLE` + `coerce()`; названия и допустимые значения обязаны совпадать с
`Onboarding.jsx` и `matching.ts` (см. «Дублирующиеся справочники» — теперь районы и
интересы задублированы ещё и в `webapp/src/screens/admin/meta.js`).

Блокировка: `users.banned` + `ban_reason` + `banned_at`. Забаненного отсекает общий
хук аутентификации в `api.ts` (403 `{error:"banned"}`, фронт показывает заглушку), плюс
`getCandidates()` исключает его из подборок. При бане чистятся лайки и незавершённые
группы. Все действия админа пишутся в таблицу `admin_log`.

## Деплой

`docker compose`: сервис `db` (postgres:16) + `app`, подключённый к внешней сети
`claudespot_default` — там живёт Caddy, который терминирует TLS и проксирует на `:3000`.
`WEBAPP_URL` должен указывать на этот публичный HTTPS-адрес, иначе кнопки `web_app` в
боте не откроются. `TG_PROXY` (HTTP/SOCKS) нужен, если `api.telegram.org` недоступен
с сервера напрямую.

Артефакты сборки (`app/dist/`, `webapp/dist/`) не коммитятся, но лежат в рабочей копии —
не путать их с исходниками при поиске по файлам.
