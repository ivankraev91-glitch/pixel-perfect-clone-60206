# Модуль «Индексация + колдунщик»

Расширяем существующий цикл проверки: вместо одного парсинга Яндекс Карт по HTML — две параллельные проверки на каждое задание:
1. **Geosearch API** (официальный, без капчи) → `maps_indexed`, `maps_position`
2. **Парсинг yandex.ru/search** через RU-прокси + RuCaptcha → `wizard_exists`, `wizard_position`, `wizard_total`

Воркер живёт на VPS (план B уже реализован) — туда и добавляем логику. UI расширяем тремя цветными статусами и второй линией на графике.

---

## Архитектура

```text
enqueue-check (edge)         worker on VPS
   ставит job        ──►     берёт job
                              ├─ Geosearch API (RU IP не нужен, ключ есть)
                              └─ HTML-парсинг yandex.ru/search через ProxyLine
                                  └─ при капче → RuCaptcha
                              merge → INSERT в checks (новые поля)
                                       └─ Realtime → UI
```

Geosearch ключ уже лежит в `YANDEX_GEOSEARCH_API_KEY` (Lovable secrets). На VPS его тоже положим в `.env`.

---

## Изменения

### 1. БД (миграция)

Расширяем `checks` (без потери совместимости — все новые поля nullable, старое поле `position` мапим в `maps_position` через дублирование при записи):

```sql
ALTER TABLE checks
  ADD COLUMN maps_indexed   boolean,
  ADD COLUMN maps_position  integer,
  ADD COLUMN wizard_exists  boolean,
  ADD COLUMN wizard_position integer,
  ADD COLUMN wizard_total   integer,
  ADD COLUMN check_type     text DEFAULT 'full',  -- 'maps_only' | 'full'
  ADD COLUMN error_type     text;
```

Расширяем `organizations`:
```sql
ALTER TABLE organizations ADD COLUMN yandex_region_id integer;
```

`region_id` определяется при добавлении организации через `search-org` (по координатам) — ставим Москва=213 по умолчанию, при сохранении вычисляем правильный.

### 2. `worker/` — новые модули

- `worker/src/geosearch.ts` — клиент Geosearch API:
  - запрос `?text=...&ll=lon,lat&spn=0.05,0.05&type=biz&results=40`
  - если не найдено в первых 40 → второй запрос `&skip=40&results=400` (до 80 позиций)
  - возвращает `{ indexed: bool, position: number|null, total: number }`

- `worker/src/wizard.ts` — парсер колдунщика:
  - GET `https://yandex.ru/search/?text=...&lr={region_id}` через `undici.ProxyAgent`
  - User-Agent Chrome desktop
  - капча → переиспользуем `captcha.ts` (`solveYandexCaptcha`, до 3 попыток)
  - детект блока: regex по `data-fast-name="companies"`, `data-wizard-name=*maps*`, `companies-slider`
  - парсинг карточек внутри блока: regex/cheerio-lite для извлечения `name` + `org_id` (из ссылки `yandex.ru/maps/org/<id>`)
  - сравнение по `yandex_id` (приоритет) и нормализованному имени (fallback)
  - возвращает `{ exists: bool, position: number|null, total: number, error?: string }`

- `worker/src/index.ts` — рефакторинг `tick()`:
  - вместо одного `searchYandexMaps` запускаем `Promise.allSettled([geosearch(...), wizard(...)])`
  - таймаут 15 сек на каждую
  - запись в `checks` со всеми новыми полями + сохраняем `position = maps_position` для обратной совместимости графиков

- `worker/.env.example` — добавить `YANDEX_GEOSEARCH_API_KEY=...`

- `worker/README.md` — обновить список переменных и описание

Удаляем legacy `worker/src/yandex.ts` (HTML-парсинг карт) — больше не нужен, заменён Geosearch API. `proxy.ts` и `captcha.ts` остаются.

### 3. Edge function `search-org`

При нахождении организации дополнительно вызываем геокодер для определения `region_id` по координатам и возвращаем его на фронт. Сохраняется в `organizations.yandex_region_id`.

(Если геокодер не отдаёт regionId напрямую — fallback по таблице крупных городов: Москва 213, СПб 2, Екатеринбург 54, Новосибирск 65, Казань 43, по умолчанию 213.)

### 4. UI (`src/pages/Dashboard.tsx`)

**Карточка «Текущая позиция»** — переделываем в карточку с двумя метриками + цветной статус:

| Состояние | Цвет |
|---|---|
| Карты + колдунщик найдены | зелёный (success) |
| Карты есть, в колдунщике нет (но блок есть) | жёлтый (warning) |
| Карты есть, колдунщика нет | синий (info) |
| Не в индексе Карт | красный (destructive) |

Внутри: «Карты: #N / 80» и «Колдунщик: #M из K» либо «нет блока» / «не в колдунщике».

**График** — две линии (recharts):
- синяя `maps_position` (reversed Y)
- оранжевая `wizard_position` (на той же оси, null = разрыв)
- серый пунктир-фон в днях, где `wizard_exists=false` (через `ReferenceArea` или просто отдельный dataset)

**Таблица истории** — добавить колонки «Карты», «Колдунщик», «Статус» (бейдж с цветом).

Тип `Check` расширить: `maps_position`, `maps_indexed`, `wizard_exists`, `wizard_position`, `wizard_total`.

### 5. Settings / Onboarding

В `Onboarding` после выбора организации — показать определённый регион (info-строка), чтобы пользователь видел: «Регион Яндекса: Москва (213)». Без отдельного UI редактирования (v2).

---

## Что НЕ делаем сейчас

- Cron-расписание (v2)
- Сравнение с конкурентами в колдунщике (v2)
- Мобильная выдача (v2)
- Ручное переопределение region_id в UI (v2)

---

## Технические детали

- **Geosearch API**: ключ есть, лимит ~25 000 запросов/сутки на дев-ключ, нашему сценарию хватает с запасом. Российский IP для него не требуется.
- **Парсер колдунщика**: HTML Яндекса нестабилен — закладываем 3 разных селектора-паттерна и graceful fallback. При не-парсинге пишем `error_type='wizard_parse'` и `wizard_exists=null` (не false), чтобы не врать пользователю.
- **Капча**: уже работает в `worker/src/captcha.ts` через RuCaptcha. Используем тот же solver для wizard-запросов.
- **Обратная совместимость**: старое поле `checks.position` продолжаем заполнять = `maps_position`, чтобы не ломать существующие графики на проде до раскатки нового UI.
- **Лимит 50 проверок/сутки** в `enqueue-check` — без изменений (одна проверка = одна job = и Карты, и колдунщик параллельно).
- **Таймауты**: каждый из двух запросов — 15 сек, общий job — до 35 сек.

---

## Порядок реализации после одобрения

1. Миграция БД (новые поля в `checks`, `organizations.yandex_region_id`).
2. Обновить `search-org` — определять region_id, сохранять в БД.
3. В `worker/`: новые `geosearch.ts`, `wizard.ts`, рефактор `index.ts`, обновить `.env.example` и README. Удалить `yandex.ts`.
4. UI: расширить типы, переделать карточку статуса, график и таблицу.
5. Чек-лист для тебя на VPS: `git pull && npm i && pm2 restart yandex-worker` + добавить `YANDEX_GEOSEARCH_API_KEY` в `.env`.

Подтверждай — начинаю.
