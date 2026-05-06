# Yandex Maps Worker (RU-VPS)

Фоновый воркер, который забирает задачи из очереди `scrape_jobs` в Lovable Cloud, ходит в Яндекс Карты через российские прокси (ProxyLine), решает SmartCaptcha (RuCaptcha) и пишет результат в таблицу `checks`.

Живёт на твоём VPS в РФ. Lovable Cloud (Supabase) остаётся для фронта, авторизации и хранения данных.

---

## 1. Покупка VPS

Любой провайдер с дата-центром в РФ. Минимум: **1 vCPU, 1 GB RAM, 20 GB SSD, Ubuntu 22.04 LTS**.

Рекомендую:
- **Timeweb Cloud** — https://timeweb.cloud/services/cloud-servers, ~250 ₽/мес, оплата картой РФ.
- **Selectel** — https://selectel.ru, ~400 ₽/мес.
- **Beget** — https://beget.com.

После покупки получи: IP-адрес, root-пароль (или SSH-ключ).

Подключись:
```bash
ssh root@<IP_СЕРВЕРА>
```

---

## 2. Где взять секреты

Перед установкой подготовь 4 значения:

### 2.1 `SUPABASE_SERVICE_ROLE_KEY`
- В Lovable открой проект → **Connectors** (в левом сайдбаре) → **Lovable Cloud** → раздел с ключами.
- Скопируй **service_role key** (НЕ anon key).
- ⚠️ Этот ключ обходит RLS — храни только на VPS, никогда не коммить в репозиторий.

### 2.2 `SUPABASE_URL`
Уже есть: `https://rxpbgvfwgxxkiocvwjhp.supabase.co`

### 2.3 `RU_PROXY_LIST` (ProxyLine)
- Личный кабинет ProxyLine → твои купленные прокси → «Скачать список».
- Формат: `ip:port:user:pass` через запятую или с новой строки.

### 2.4 `CAPTCHA_API_KEY` (RuCaptcha)
- https://rucaptcha.com → личный кабинет → API key.
- `CAPTCHA_PROVIDER=rucaptcha`

---

## 3. Установка одной командой

На свежем VPS под root:

```bash
curl -fsSL https://raw.githubusercontent.com/<твой-username>/<твой-репо>/main/worker/install.sh \
  | bash -s -- https://github.com/<твой-username>/<твой-репо>.git
```

Если репо приватный — сначала склонируй вручную:
```bash
git clone https://github.com/<you>/<repo>.git /home/worker/app
bash /home/worker/app/worker/install.sh https://github.com/<you>/<repo>.git
```

Скрипт сделает:
1. apt update + установит Node.js 20, git, build-essential
2. создаст системного пользователя `worker`
3. склонирует репо в `/home/worker/app`
4. установит npm-зависимости и соберёт TypeScript
5. создаст `/home/worker/app/worker/.env` из шаблона
6. поставит PM2 глобально и запустит воркер
7. настроит автозапуск при перезагрузке VPS

---

## 4. Заполнить `.env`

После установки скрипт остановится и попросит заполнить `.env`:

```bash
sudo -u worker nano /home/worker/app/worker/.env
```

Подставь 4 значения из шага 2. Сохрани (Ctrl+O, Enter, Ctrl+X).

Перезапусти воркер:
```bash
sudo -u worker pm2 restart yandex-worker
```

---

## 5. Проверка работы

```bash
sudo -u worker pm2 logs yandex-worker
```

Должно появиться:
```
[worker] started, poll interval 5000 ms, batch 5
[poll] picked 1 job(s)
[poll] done: success=1 failed=0
```

В Lovable UI зайди в Dashboard, нажми «Проверить» рядом с любой парой ключ/гео — через 5–15 сек должна появиться позиция.

---

## 6. Эксплуатация

| Команда | Что делает |
|---|---|
| `sudo -u worker pm2 status` | список процессов |
| `sudo -u worker pm2 logs yandex-worker` | хвост логов |
| `sudo -u worker pm2 logs yandex-worker --lines 200` | последние 200 строк |
| `sudo -u worker pm2 restart yandex-worker` | рестарт |
| `sudo -u worker pm2 stop yandex-worker` | остановить |
| `sudo -u worker pm2 monit` | живой монитор |

### Обновление кода

```bash
sudo -u worker bash -c 'cd /home/worker/app && git pull && cd worker && npm install && npx tsc -p . && pm2 restart yandex-worker'
```

### Логи на диске

`/home/worker/app/worker/logs/out.log` и `err.log`. PM2 ротирует автоматически.

---

## 7. Безопасность (рекомендации)

После установки настоятельно стоит:

1. **Отключить вход root по паролю**, оставить только SSH-ключи:
   ```bash
   nano /etc/ssh/sshd_config
   # PermitRootLogin prohibit-password
   # PasswordAuthentication no
   systemctl restart sshd
   ```
2. **Поставить ufw** и закрыть всё кроме SSH:
   ```bash
   ufw allow 22/tcp && ufw enable
   ```
3. **Fail2ban** для защиты от брутфорса:
   ```bash
   apt install -y fail2ban && systemctl enable --now fail2ban
   ```
4. Файл `.env` уже создаётся с правами 600 и владельцем `worker`.

---

## 8. Мониторинг (опционально)

Пинг-ручка от https://healthchecks.io: создай чек на «каждые 5 минут», получи URL. В `worker/src/index.ts` после успешного `tick()` добавь `fetch(HEALTHCHECK_URL).catch(()=>{})` — придёт алерт на email если воркер замолчит.

---

## 9. Локальная разработка

```bash
cd worker
cp .env.example .env   # заполни
npm install
npm run dev            # tsx watch
```

---

## 10. Что делать, если воркер не цепляет задачи

1. `pm2 logs` — смотри ошибки.
2. Проверь, что в `.env` правильный `SUPABASE_SERVICE_ROLE_KEY` (не anon!).
3. Проверь, что прокси живые: `curl -x http://user:pass@ip:port https://api.ipify.org` — должен вернуть РФ-IP.
4. Проверь баланс на RuCaptcha.
5. Проверь, что в БД есть pending-задачи: в Lovable UI нажми «Проверить» — должна появиться запись в `scrape_jobs` со статусом `pending`.
