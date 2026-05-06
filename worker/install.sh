#!/usr/bin/env bash
# One-shot bootstrap для Ubuntu 22.04. Запускается на свежем VPS под root:
#   curl -fsSL https://raw.githubusercontent.com/<your-org>/<your-repo>/main/worker/install.sh | bash -s -- <REPO_URL>
# или скопируй файл вручную и запусти: REPO_URL=... bash install.sh

set -euo pipefail

REPO_URL="${1:-${REPO_URL:-}}"
if [ -z "$REPO_URL" ]; then
  echo "Usage: bash install.sh <git-repo-url>"
  echo "Пример: bash install.sh https://github.com/you/your-repo.git"
  exit 1
fi

WORKER_USER="worker"
APP_DIR="/home/${WORKER_USER}/app"

echo "==> apt update + базовые пакеты"
apt-get update -y
apt-get install -y curl git build-essential ca-certificates

echo "==> ставим Node.js 20 (NodeSource)"
if ! command -v node >/dev/null 2>&1 || [[ "$(node -v)" != v20* ]]; then
  curl -fsSL https://deb.nodesource.com/setup_20.x | bash -
  apt-get install -y nodejs
fi
node -v
npm -v

echo "==> ставим pm2 глобально"
npm install -g pm2

echo "==> создаём пользователя ${WORKER_USER} (если нет)"
if ! id -u "$WORKER_USER" >/dev/null 2>&1; then
  adduser --disabled-password --gecos "" "$WORKER_USER"
fi

echo "==> клонируем/обновляем репозиторий в ${APP_DIR}"
if [ -d "$APP_DIR/.git" ]; then
  sudo -u "$WORKER_USER" git -C "$APP_DIR" pull
else
  sudo -u "$WORKER_USER" git clone "$REPO_URL" "$APP_DIR"
fi

echo "==> npm install (worker)"
cd "$APP_DIR/worker"
sudo -u "$WORKER_USER" npm install
sudo -u "$WORKER_USER" npx tsc -p .

echo "==> .env"
if [ ! -f "$APP_DIR/worker/.env" ]; then
  sudo -u "$WORKER_USER" cp "$APP_DIR/worker/.env.example" "$APP_DIR/worker/.env"
  chmod 600 "$APP_DIR/worker/.env"
  chown "$WORKER_USER:$WORKER_USER" "$APP_DIR/worker/.env"
  echo
  echo "!!! ОТРЕДАКТИРУЙ файл $APP_DIR/worker/.env (заполни SUPABASE_SERVICE_ROLE_KEY, RU_PROXY_LIST, CAPTCHA_API_KEY)"
  echo "!!! Затем запусти: sudo -u $WORKER_USER pm2 restart yandex-worker"
fi

echo "==> ставим dotenv (для подгрузки .env)"
cd "$APP_DIR/worker"
sudo -u "$WORKER_USER" npm install dotenv

echo "==> запускаем под pm2"
mkdir -p "$APP_DIR/worker/logs"
chown -R "$WORKER_USER:$WORKER_USER" "$APP_DIR/worker/logs"
sudo -u "$WORKER_USER" pm2 start "$APP_DIR/worker/ecosystem.config.cjs" || \
  sudo -u "$WORKER_USER" pm2 restart yandex-worker
sudo -u "$WORKER_USER" pm2 save

echo "==> автозапуск pm2 при ребуте"
env PATH="$PATH:/usr/bin" pm2 startup systemd -u "$WORKER_USER" --hp "/home/$WORKER_USER" | tail -n 1 | bash || true

echo
echo "==> ГОТОВО"
echo "Логи:    sudo -u $WORKER_USER pm2 logs yandex-worker"
echo "Статус:  sudo -u $WORKER_USER pm2 status"
echo "Рестарт: sudo -u $WORKER_USER pm2 restart yandex-worker"
