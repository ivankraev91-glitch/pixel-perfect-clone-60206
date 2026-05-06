# Частотность ключей (Wordstat) + снятие лимита

Расширяем сервис: для каждого ключа показываем месячную частотность по региону организации (Wordstat), убираем лимит на 3 ключа, обновляем частоту раз в месяц автоматически.

## Решения по архитектуре

- **Источник**: парсинг `wordstat.yandex.ru` через тот же VPS-воркер (RU-прокси + RuCaptcha — инфраструктура уже готова).
- **Привязка**: один `frequency` на ключ = по `organizations.yandex_region_id` (регион карточки).
- **Лимит ключей**: снимаем (было 3 → без ограничения). Дневной лимит **проверок позиций** (50/сутки) не трогаем — частотность считается отдельной квотой.
- **Обновление**: автоматический пересчёт раз в месяц + кнопка «Обновить» вручную в настройках.

---

## 1. БД (миграция)

```sql
ALTER TABLE keywords
  ADD COLUMN frequency        integer,           -- месячный показ Wordstat по региону
  ADD COLUMN frequency_region integer,           -- region_id, по которому считали
  ADD COLUMN frequency_at     timestamptz,       -- когда последний раз обновлено
  ADD COLUMN frequency_status text DEFAULT 'pending'; -- pending | ok | error

CREATE TABLE wordstat_jobs (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id uuid NOT NULL,
  keyword_id uuid NOT NULL,
  region_id integer NOT NULL,
  status text NOT NULL DEFAULT 'pending',  -- pending | running | done | error
  attempts int NOT NULL DEFAULT 0,
  error text,
  next_run_at timestamptz NOT NULL DEFAULT now(),
  created_at timestamptz NOT NULL DEFAULT now(),
  finished_at timestamptz
);
ALTER TABLE wordstat_jobs ENABLE ROW LEVEL SECURITY;
-- политики: select own (user_id=auth.uid()), service_role full access
CREATE INDEX idx_wordstat_jobs_pending ON wordstat_jobs(status, next_run_at);
```

Снимаем константы `MAX_KW = 3` в коде (см. ниже).

## 2. Edge function `enqueue-wordstat`

Новая функция: на вход `keyword_id` (или массив) → проверяет владение → достаёт `region_id` из `organizations` → создаёт записи в `wordstat_jobs`. Дедуп по `(keyword_id, status in (pending,running))`.

Триггерится:
- автоматически из `keywords` insert (через триггер БД на `pg_net` к этой функции — либо прямо из клиента после успешного insert, что проще; выбираем второй вариант),
- вручную из Settings («Обновить частотности»),
- по cron (см. п.5).

## 3. Воркер на VPS — новый модуль `worker/src/wordstat.ts`

```text
GET https://wordstat.yandex.ru/?region={region_id}&view=table&words={keyword}
  через ProxyAgent (RU IP)
  при капче → captcha.ts (RuCaptcha, переиспользуем)
  парсим число месячных показов из таблицы (regex по блоку с количеством)
  возвращаем { frequency, status: 'ok'|'error', error? }
```

В `worker/src/index.ts` добавить второй цикл `tickWordstat()` параллельно `tick()`:
- забирает `pending` из `wordstat_jobs` (LIMIT 1 за раз, 1 запрос/5 сек — Wordstat жёсткий по rate-limit),
- пишет результат в `keywords` (`frequency`, `frequency_region`, `frequency_at`, `frequency_status`) и в `wordstat_jobs` (`done`/`error`),
- ретраи: 3 попытки с экспоненциальной задержкой, потом `error`.

Документация в `worker/README.md` обновляется — отдельный раздел Wordstat.

## 4. UI

### `Onboarding.tsx`
- Удалить `MAX_KEYWORDS = 3`. Поле ввода + кнопка `+`. Список ключей без верхнего ограничения.
- Подсказка: «Частотность будет посчитана автоматически после сохранения».

### `Settings.tsx`
- Удалить `MAX_KW = 3`.
- В каждой строке ключа показать: название, бейдж частотности (`ок: 1 240/мес`, `считаем…`, `ошибка`), маленькую иконку «обновить» рядом.
- Кнопка «Пересчитать все частотности» сверху списка → вызывает `enqueue-wordstat` массивом.
- Поле ввода ключа: при добавлении после успешного insert сразу вызываем `enqueue-wordstat` с `keyword_id`.
- Realtime подписка на `keywords` (UPDATE) — частотность подкатывается без перезагрузки.

### `Dashboard.tsx`
- В селекте/списке ключей рядом с названием показать частотность (если есть): `стоматология рядом · 4 320/мес`.
- В таблице истории добавить колонку «Частотность» (берём из `keywords.frequency` на момент рендера — текущая, не историческая).

## 5. Ежемесячный пересчёт

`pg_cron` job (через insert-tool, не миграцию — содержит URL/anon key) — раз в месяц 1-го числа в 03:00 МСК:
```sql
select cron.schedule('wordstat-monthly', '0 0 1 * *', $$
  select net.http_post(
    url:='https://<ref>.supabase.co/functions/v1/enqueue-wordstat',
    headers:='{"Content-Type":"application/json","apikey":"<anon>"}'::jsonb,
    body:='{"all": true}'::jsonb
  );
$$);
```

`enqueue-wordstat` при `{all:true}` (вызов с service_role внутренне) — ставит задачи на все `keywords`, у которых `frequency_at IS NULL OR frequency_at < now() - interval '25 days'`.

## 6. Деплой

После одобрения и реализации — на VPS:
```bash
cd ~/yandex-worker && git pull && npm i && npm run build && pm2 restart yandex-worker
```
Никаких новых секретов не нужно: `RU_PROXY_LIST`, `CAPTCHA_API_KEY`, `SUPABASE_SERVICE_ROLE_KEY` уже есть.

## Что НЕ делаем

- Историю изменений частотности (v2, отдельная таблица timeseries).
- Расширение/уточнение фразы «"!ключ"», базовую/точную/уточнённую — берём только базовую цифру.
- Wordstat для разных регионов на одной карточке (только region организации).
- Разделение квот на пользователей — пока общая очередь FIFO.

Подтверждай — приступаю.
