#!/bin/bash
set -e

DEPLOY_DIR=/var/www/gitdash
SRC_DIR="$(cd "$(dirname "$0")" && pwd)"

echo "=== Git Dashboard デプロイ ==="

# Apache 設定
sudo cp apache/gitweb.conf /etc/httpd/conf.d/gitweb.conf
sudo cp apache/gitweb.app.conf /etc/gitweb.conf

# Node.js アプリケーション
sudo mkdir -p ${DEPLOY_DIR}/{dashboard,static/highlighter,lib}
sudo cp server.js ${DEPLOY_DIR}/
sudo cp package.json ${DEPLOY_DIR}/
sudo cp dashboard/index.html ${DEPLOY_DIR}/dashboard/
sudo cp static/style.css ${DEPLOY_DIR}/static/
sudo cp static/app.js ${DEPLOY_DIR}/static/
sudo cp static/highlighter.js ${DEPLOY_DIR}/static/
sudo cp static/highlighter/common.js ${DEPLOY_DIR}/static/highlighter/
sudo cp lib/git.js ${DEPLOY_DIR}/lib/
sudo cp lib/auth.js ${DEPLOY_DIR}/lib/
sudo cp lib/markdown.js ${DEPLOY_DIR}/lib/
sudo cp lib/syntax-highlight.js ${DEPLOY_DIR}/lib/

# systemd サービスが存在する場合は再起動
if systemctl is-active --quiet gitdash 2>/dev/null; then
  echo "Restarting gitdash service..."
  sudo systemctl restart gitdash
else
  echo "NOTE: gitdash systemd サービスが未設定です"
  echo "  手動起動: cd ${DEPLOY_DIR} && BASE_PATH=/gitdash PORT=5987 node server.js"
  echo "  systemd 設定例:"
  echo "    sudo tee /etc/systemd/system/gitdash.service <<EOF"
  echo "[Unit]"
  echo "Description=Git Dashboard"
  echo "After=network.target"
  echo ""
  echo "[Service]"
  echo "Type=simple"
  echo "WorkingDirectory=${DEPLOY_DIR}"
  echo "ExecStart=/usr/bin/node ${DEPLOY_DIR}/server.js"
  echo "Restart=on-failure"
  echo "Environment=PORT=5987"
  echo "Environment=BASE_PATH=/gitdash"
  echo ""
  echo "[Install]"
  echo "WantedBy=multi-user.target"
  echo "EOF"
fi

sudo systemctl reload httpd
echo "=== デプロイ完了 ==="
