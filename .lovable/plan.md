# План: управление воркером прямо из Lovable

Цель: ты больше не открываешь SSH-терминал. Все действия с воркером (обновить код, рестарт, посмотреть логи, посмотреть очередь) — через UI в Lovable-дашборде.

## Что делаем

### 1. Одноразовая настройка сервера (под мою диктовку, ~10 минут)
Я дам тебе **3 готовые команды** для копипасты в SSH (один раз, потом забываешь). Они:
- создают пользователя `lovable-deploy` с правом перезапуска только PM2-процесса `yandex-worker`,
- генерируют SSH-ключ,
- разрешают вход по этому ключу.

Ты копируешь приватный ключ и адрес сервера и кладёшь их в Lovable Cloud Secrets:
- `DEPLOY_SSH_HOST` (IP или домен Beget)
- `DEPLOY_SSH_USER` = `lovable-deploy`
- `DEPLOY_SSH_KEY` (приватный ключ целиком)

### 2. Edge-функция `worker-control`
Одна функция, четыре действия (`action` в body):
- `deploy` — `git pull && npm i && npx tsc -p . && pm2 restart yandex-worker`
- `restart` — `pm2 restart yandex-worker`
- `status` — `pm2 jlist` → парсим uptime/memory/restarts
- `logs` — `pm2 logs yandex-worker --lines 200 --nostream` → последние 200 строк

Под капотом — SSH через npm-пакет `ssh2` (работает в Deno edge-runtime через npm-импорт). Доступ только пользователям с ролью админа (через `has_role` — таблицу ролей создадим, если её ещё нет; сейчас RLS на `system_alerts` открыт, надо закрыть).

### 3. Страница `/worker` в дашборде
Новый роут (только для авторизованного владельца проекта). На странице:

```text
+-------------------------------------------------+
| Воркер: ● online   uptime 2д 4ч   RAM 612 MB    |
| [Обновить код]  [Рестарт]  [Обновить статус]    |
+-------------------------------------------------+
| Очередь                                         |
|   scrape_jobs:    pending 3 | running 1 | failed 0 |
|   wordstat_jobs:  pending 0 | running 0 | failed 2 |
+-------------------------------------------------+
| Последние алерты (system_alerts, 20 шт)         |
|   12:04  maps_browser_fallback_hit  ...         |
|   11:58  proxy_banned                ...        |
+-------------------------------------------------+
| Логи воркера (последние 200 строк, авто-обновл.)|
|   [poll] picked 2 job(s)                        |
|   [poll] done: success=2 failed=0               |
|   ...                                           |
+-------------------------------------------------+
```

Кнопки:
- **Обновить код** — вызывает `worker-control { action: "deploy" }`, показывает прогресс, по завершении — toast «Обновлено, версия abc123».
- **Рестарт** — `action: "restart"`.
- **Обновить статус** — перечитать статус и логи.

Очередь читается напрямую из БД (count по статусам в `scrape_jobs` и `wordstat_jobs`). Авто-рефреш каждые 10 секунд.

### 4. Безопасность
- Edge-функция проверяет, что вызывающий — админ (роль из таблицы `user_roles`). Создадим таблицу, если её нет, и назначим тебя админом миграцией.
- Пользователь `lovable-deploy` на сервере имеет sudoers-правило **только** на `pm2 restart yandex-worker` — даже если ключ утечёт, дальше PM2 он ничего не сделает.
- Ключ хранится только в Lovable Cloud Secret, в коде/репозитории его нет.

## Технические детали (для меня)

```text
supabase/functions/worker-control/index.ts
  - import ssh2 from npm:ssh2
  - admin guard через user_roles + has_role
  - actions: deploy | restart | status | logs
  - returns { ok, stdout, stderr, parsed? }

src/pages/Worker.tsx
  - status card (poll каждые 10с)
  - queue card (supabase select count group by status)
  - alerts card (system_alerts order by created_at desc limit 20)
  - logs card (monospace, auto-scroll)
  - кнопки с loading state

миграция:
  - create type app_role if not exists
  - create table user_roles (user_id, role) + RLS
  - create function has_role()
  - insert текущего пользователя как admin (по email или uid — спрошу при выполнении)
  - закрыть RLS на system_alerts (сейчас открыт): select только для админов

src/App.tsx
  - добавить роут /worker под ProtectedRoute
src/components/NavLink.tsx или Dashboard sidebar
  - пункт «Воркер» (виден только админу)
```

## Что от тебя потребуется один раз
1. Подтвердить план.
2. Когда я скажу — зайти в SSH на Beget и выполнить 3 команды, которые я пришлю.
3. Скопировать приватный ключ из терминала и вставить в форму добавления секрета (я её открою).
4. Сказать свой email от аккаунта Lovable, чтобы я назначил тебя админом миграцией.

После этого — забываешь про SSH навсегда. Все правки воркера, которые я буду делать дальше, ты применяешь одной кнопкой «Обновить код» на странице `/worker`.

## Что НЕ делаем сейчас
- Не трогаем сам код воркера (`maps.ts`, `mapsBrowser.ts`, `wizard.ts`) — он уже рабочий.
- Не меняем процесс публикации фронта — кнопка «Publish» как обычно.
- Не переезжаем с Beget — он отлично подходит.
