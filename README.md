# Свои — совместная аренда в Казани

Telegram Mini App + бот, который подбирает **совместимых соседей**, помогает собрать
группу из 3–4 человек и находит большую квартиру под общий бюджет — отдельная комната
по цене комнаты в коммуналке.

## Что внутри

| Компонент | Технологии |
|---|---|
| Бот | [grammY](https://grammy.dev), long polling |
| API + статика Mini App | Fastify (один Node-процесс) |
| Mini App | React + Vite, тема Telegram, без сборочных наворотов |
| БД | PostgreSQL 16 (Docker) |
| HTTPS/прокси | существующий Caddy на сервере (`claudespot_default` сеть) |

## Структура

```
app/src/
  index.ts      — запуск: БД → API+статика → бот
  bot.ts        — команды, подтверждение групп, админка
  api.ts        — REST для Mini App (auth через Telegram initData)
  matching.ts   — жёсткие фильтры + скоринг совместимости 0–100%
  auth.ts       — валидация initData по алгоритму Telegram
  notify.ts     — уведомления (мэтч, инвайт в группу, собранная группа)
  schema.sql    — схема БД, применяется при старте
webapp/src/
  screens/      — Onboarding, Neighbors, Group, Apartments, Profile
docs/PROJECT.md — продукт: концепция, мэтчинг, юнит-экономика, roadmap
```

## Запуск

```bash
cp .env.example .env   # вписать BOT_TOKEN, ADMIN_IDS, WEBAPP_URL
docker compose up -d --build
```

Локально в dev:

```bash
cd app && npm i && npx tsc && node dist/index.js     # API на :3000
cd webapp && npm i && npm run dev                    # Vite с прокси /api → :3000
```

## Админка бота

`/admin` — статистика, анкеты, квартиры, рассылка.
Добавление квартиры: диалог (название → комнаты → цена → район → адрес → контакт),
затем можно прислать фото и отправить квартиру подходящим группам.

Свой Telegram ID: напиши боту `/start`, пока `ADMIN_IDS` пуст — ID появится в логах
(`docker compose logs app`).

## Переменные окружения

см. `.env.example`
