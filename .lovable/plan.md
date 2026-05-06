
# План B: Воркер на RU-VPS

Lovable Cloud остаётся фронтом, БД, авторизацией. Парсинг уезжает на твой VPS в РФ — он ходит в Яндекс Карты с российского IP, через ProxyLine, решает капчу через RuCaptcha, пишет результат обратно в БД через service-role ключ.

---

## Архитектура после переноса

```text
Браузер (Lovable UI)
        │
        ▼
Lovable Cloud (Supabase)
  • auth, RLS
  • таблицы: organizations, keywords, geopoints, checks
  • очередь: scrape_jobs (pending → done/failed)
  • enqueue-check edge function (ставит задачу)
        ▲                              │
        │ select/update via            │ select pending jobs
        │ service-role                 │ через REST/PostgREST
        │                              ▼
        └─────────────────────  RU-VPS (твой)
                                • Node.js worker (PM2)
                                • polling каждые 5 сек
                                • ProxyLine IP-pool
                                • RuCaptcha solver
                                • кеш сессий/cookies
```

Что удаляем из Lovable: edge-функции `scrape-worker`, `scrape-diagnose`, pg_cron-триггер воркера, shared `yandex-scrape.ts`. Остаётся только `enqueue-check` и `search-org` (его тоже перевешу на VPS, чтобы был один источник правды).

---

## Что нужно от тебя (по порядку)

### Шаг 1. Купить VPS в РФ
**Где:** любой из:
- **Timeweb Cloud** (timeweb.cloud) — самый простой, оплата картой РФ, ~250₽/мес за 1 vCPU / 1 GB / Ubuntu 22.04. Datacenter СПб/Мск.
- **Selectel** (selectel.ru) — чуть дороже, но надёжнее.
- **Beget** (beget.com) — тоже норм.

**Конфиг для старта:** 1 vCPU, 1–2 GB RAM, 20 GB SSD, Ubuntu 22.04 LTS, локация РФ (Москва или Питер). Этого хватит на сотни проверок в день.

**Что получить после покупки:**
- IP-адрес сервера
- root-пароль или SSH-ключ
- Доступ по SSH (`ssh root@IP`)

### Шаг 2. Передать мне доступы (в секреты Lovable, я их использую только для генерации инструкций — на сервер ходить буду не я, а ты по моему гайду)
Ничего передавать не надо. Я подготовлю **bash-скрипт установки**, ты сам его запустишь на VPS — копипастой одной команды.

### Шаг 3. На VPS будут жить эти секреты (положишь в `.env` на сервере, я дам шаблон):
- `SUPABASE_URL` (уже знаешь)
- `SUPABASE_SERVICE_ROLE_KEY` (возьмёшь из Lovable Cloud → Connectors → Lovable Cloud → Service role key)
- `RU_PROXY_LIST` (твой ProxyLine, тот же что сейчас)
- `CAPTCHA_API_KEY` + `CAPTCHA_PROVIDER=rucaptcha`
- `WORKER_POLL_INTERVAL_MS=5000`

---

## Что я сделаю в коде (после твоего «ок»)

### Часть 1. Подготовка БД (миграция)
- Добавить policy на `scrape_jobs` для service-role: UPDATE (чтобы воркер мог менять статус). RLS уже есть на SELECT/INSERT.
- Удалить cron-job `scrape-worker` (если был создан) — больше не нужен.
- (опционально) добавить индекс `(status, next_run_at)` для быстрого пика очереди.

### Часть 2. Создать папку `worker/` в репозитории
Структура:
```
worker/
  package.json
  tsconfig.json
  .env.example
  src/
    index.ts          # main loop: poll → process → sleep
    db.ts             # supabase client (service role)
    yandex.ts         # парсер карт (перенос из _shared/yandex-scrape.ts)
    proxy.ts          # ротация ProxyLine + proxy_health
    captcha.ts        # RuCaptcha SmartCaptcha solver
    sessions.ts       # cookie sessions per proxy
  ecosystem.config.cjs # PM2
  install.sh          # one-shot bootstrap для Ubuntu 22.04
  README.md           # пошаговая инструкция деплоя
```

Воркер на Node.js 20 + native fetch + `https-proxy-agent` (в Node прокси работает нормально, в отличие от Deno в Supabase). Использует `@supabase/supabase-js` для общения с БД через service-role.

Логика та же, что сейчас в edge-функции, только:
- HTTP через `undici.ProxyAgent` (реально ходит через прокси, RU IP подтверждён)
- polling вместо cron
- PM2 для автоперезапуска и логов

### Часть 3. Удалить из Lovable
- `supabase/functions/scrape-worker/`
- `supabase/functions/scrape-diagnose/`
- `supabase/functions/_shared/yandex-scrape.ts`
- cron-задачу `scrape-worker-tick` (через миграцию)
- секреты `RU_PROXY_LIST`, `CAPTCHA_API_KEY`, `CAPTCHA_PROVIDER`, `SCRAPE_WORKER_TOKEN` из Lovable (они переедут на VPS)

`enqueue-check` остаётся как есть — UI кладёт задачу, воркер на VPS её забирает.

### Часть 4. README для деплоя на VPS
Будет содержать:

```text
1. Подключиться: ssh root@<IP>
2. Скачать и запустить: curl -s https://raw.githubusercontent.com/<твой_репо>/main/worker/install.sh | bash
   (или скопировать install.sh вручную и запустить)
3. Скрипт сделает:
   - apt update, установит Node.js 20, git, build-essential
   - создаст пользователя `worker`
   - склонирует репо в /home/worker/app
   - установит npm зависимости в /home/worker/app/worker
   - создаст /home/worker/app/worker/.env (попросит заполнить)
   - установит PM2 глобально
   - запустит воркер через PM2 + автозапуск при ребуте
4. Заполнить .env (5 переменных, шаблон в .env.example)
5. pm2 restart yandex-worker
6. pm2 logs yandex-worker — увидеть «Polling… picked N jobs… done»
7. Проверить в Lovable UI: жмёшь «Проверить» → через 5–15 сек появляется позиция
```

Также: как обновлять (`git pull && npm i && pm2 restart`), как смотреть логи, как добавить мониторинг (uptime kuma / healthchecks.io ping раз в минуту).

---

## Технические детали (для ясности)

**Почему Node, а не Deno:** в Node прокси через `undici.ProxyAgent` или `https-proxy-agent` гарантированно работает. В Deno (Supabase) — нет, мы это уже подтвердили диагностикой (IP выходил из Франкфурта).

**Безопасность service-role ключа на VPS:** ключ лежит в `.env` с правами 600, читается только пользователем `worker`. Никаких HTTP-эндпоинтов воркер не открывает — только исходящие запросы. SSH под root отключим, оставим только по ключу (опционально, в инструкции).

**Стоимость в месяц:**
- VPS Timeweb: ~250–400 ₽
- ProxyLine: уже куплен
- RuCaptcha: ~$1 за 1000 капч (≈ 100 ₽)
- Итого: ~400–500 ₽/мес

**Масштабирование:** при росте — увеличить `BATCH_SIZE` и количество параллельных воркеров (PM2 cluster mode). На одном 1-CPU VPS реально жать 3000–5000 проверок в день.

---

## После одобрения этого плана я:
1. Создам миграцию (UPDATE policy + индекс + удаление cron).
2. Сгенерирую папку `worker/` со всем кодом, install.sh и подробным README.md на русском.
3. Удалю из Lovable три edge-функции и shared-файл.
4. Дам тебе чек-лист в чате: «купи VPS → залей ключи → запусти install.sh → заполни .env → готово».

Подтверждай — приступаю.
