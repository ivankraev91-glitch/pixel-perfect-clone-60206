# План: MapRank MVP

Сервис для проверки позиции карточки организации в выдаче Яндекс Карт по ключевому запросу из выбранной гео-точки.

## Стек

- Фронтенд: React + Tailwind + shadcn/ui (текущий проект)
- Бэкенд: Lovable Cloud (Supabase) — БД, Auth, Edge Functions
- Парсинг: Edge Function (Deno/TypeScript) → Яндекс Geosearch API
- Карта: Яндекс Maps JS API (подключим скриптом в `index.html`)
- Графики: Recharts

Python/Railway из ТЗ заменяем на Edge Functions внутри Lovable Cloud — функционально эквивалентно, без отдельного хостинга.

## Структура БД (Supabase)

- `organizations` — id, user_id, name, city, yandex_id, address, lat, lon, created_at
- `keywords` — id, org_id, keyword, created_at
- `geopoints` — id, org_id, label, lat, lon, created_at
- `checks` — id, org_id, keyword_id, geopoint_id, position (nullable), total_results, checked_at, raw_response (jsonb)

RLS: на всех таблицах — пользователь видит и пишет только свои строки (через `user_id` напрямую или join с `organizations`).

## Edge Functions

**`check-position`** (POST)
- Auth: проверка JWT (`getClaims`)
- Вход: `{ org_id, keyword_id, geopoint_id }`
- Логика:
  1. Получить keyword + geopoint + yandex_id из БД
  2. Запрос `https://search-maps.yandex.ru/v1/?text=...&ll=lon,lat&spn=0.02,0.02&type=biz&results=40&lang=ru_RU&apikey=...`
  3. Найти `properties.CompanyMetaData.id == yandex_id` в `features`
  4. Вернуть позицию (index+1) или null
  5. Записать в `checks`
- Rate-limit: не чаще 1 проверки на пользователя в 5 минут (проверка по `checks.checked_at`)
- Ошибки: 429 → retry 3 раза с задержкой 2 сек; таймаут > 10 сек → ошибка

**`search-org`** (POST)
- Auth: проверка JWT
- Вход: `{ query, city }`
- Прокси к Geosearch API для autocomplete организаций; возвращает массив `{ name, address, yandex_id, lat, lon }`

Секреты: `YANDEX_GEOSEARCH_API_KEY`, `YANDEX_JS_API_KEY` (запросим через Add Secret после старта реализации).

## Экраны (фронтенд)

1. **`/auth`** — email/пароль (Supabase Auth). После регистрации → онбординг.
2. **`/onboarding`** — мастер из 3 шагов: найти организацию (autocomplete) → добавить до 3 ключевых слов → выбрать до 3 гео-точек на Яндекс-карте.
3. **`/`** (Дашборд, защищённый):
   - Шапка: название карточки, кнопка «Проверить сейчас» (выбор keyword + geopoint в модалке)
   - Блок «Текущая позиция»: большая цифра, ключевое слово, гео-точка, время
   - Мини-график динамики (Recharts, последние 10 проверок)
   - Таблица последних 20 проверок: дата, ключ, точка, позиция
4. **`/settings`** — управление ключевыми словами и гео-точками (CRUD, лимит 3+3), мини-карта для перетаскивания маркера.
5. **Модалка «Результат проверки»** — после ответа Edge Function: позиция / «не найдена», запрос, точка, время.

## Поток пользователя

Регистрация → онбординг (карточка + ключи + точки) → дашборд → «Проверить» → модалка результата → запись в историю → обновление графика.

## Ограничения MVP (как в ТЗ)

- 1 организация, 3 ключевых слова, 3 гео-точки на пользователя
- Rate limit: 1 проверка / 5 минут
- Хранение: последние 100 проверок (старые подчищаем)
- Не входит: cron, конкуренты, PDF, Telegram, Google Maps, мобильное приложение

## Дизайн

Чистый светлый дашборд в духе SaaS-аналитики: основной акцент — синий (#1E40AF), нейтральный фон, карточки с мягкими тенями. Крупная цифра позиции как ключевой элемент. Шрифт Inter.

## Порядок реализации

1. Подключение Lovable Cloud, схема БД + RLS
2. Auth (email/пароль) + защищённые роуты
3. Подключение Яндекс Maps JS API в `index.html`, секреты
4. Edge Function `search-org` + UI онбординга (карточка)
5. UI ключевых слов и гео-точек + мини-карта
6. Edge Function `check-position` + модалка результата
7. Дашборд: текущая позиция, график (Recharts), история
8. Страница настроек, ограничения (rate limit, лимиты записей)

После одобрения — попрошу добавить два секрета Яндекс API и начну реализацию.
