# gitdash

RHEL オフライン環境向けの Git リポジトリ Web ビューア。
Node.js をバックエンドとして使用し、パブリック/プライベートリポジトリの閲覧・認証に対応したカスタム Web UI を提供します。

## 概要

| 項目 | 内容 |
|------|------|
| 対象 OS | RHEL（オフライン・エアギャップ環境） |
| 使用パッケージ | `httpd`, `nodejs`, `git` |
| 外部ライブラリ | **なし**（Node.js 標準ライブラリ・Vanilla JS のみ） |
| 認証方式 | Apache htpasswd（Basic 認証） |
| アクセス URL | `http://<サーバーIP>/gitdash/` |

### アーキテクチャ

```
ブラウザ
  │
  └─ http://<IP>/gitdash/  →  Apache httpd (:80)
                                  │
                                  ├─ ProxyPass /gitdash → Node.js (:5987, 127.0.0.1)
                                  │    ├─ GET  /gitdash/          → dashboard/index.html
                                  │    ├─ GET  /gitdash/static/*  → static/ 以下
                                  │    └─ GET/POST /gitdash/api   → Git 操作 API
                                  │
                                  ├─ /gitweb/  → Gitweb CGI（オプション）
                                  └─ /git/     → git-http-backend（clone/push/pull）
```

### 機能

- パブリックリポジトリを認証なしで閲覧
- htpasswd ログイン後、自分のプライベートリポジトリが追加表示される
- コミット履歴・差分（side-by-side diff）・ファイルツリーの表示
- Markdown レンダリング・コードシンタックスハイライト（サーバーサイド）
- リポジトリの作成・削除（オーナーのみ）
- リポジトリの可視性変更（public ↔ private、オーナーのみ）
- `git clone` / `git push` を HTTP 経由で実行可能
  - パブリック：clone は認証なし、push は認証あり
  - プライベート：clone・push ともに認証あり

---

## ファイル構成

```
gitdash/
├── README.md
├── deploy.sh                  # デプロイスクリプト
├── server.js                  # Node.js サーバー（エントリポイント）
├── package.json
├── dashboard/
│   └── index.html             # Web UI テンプレート
├── static/
│   ├── app.js                 # フロントエンド JS
│   ├── style.css
│   ├── highlighter.js
│   └── highlighter/
│       └── common.js
├── lib/
│   ├── auth.js                # htpasswd 認証
│   ├── git.js                 # Git 操作
│   ├── markdown.js            # Markdown パーサー
│   └── syntax-highlight.js   # シンタックスハイライト
└── apache/
    ├── gitweb.conf            # Apache 設定（→ /etc/httpd/conf.d/gitweb.conf）
    └── gitweb.app.conf        # Gitweb アプリ設定（→ /etc/gitweb.conf）
```

> **注意:** `/etc/httpd/.htpasswd` はパスワードが含まれるためリポジトリには含めません。

---

## セットアップ手順

### 前提条件

- RHEL サーバーに `httpd`, `git`, `nodejs` がインストール済み
- `sudo` 権限があるユーザーで作業する

### 1. パッケージのインストール

```bash
sudo dnf install -y httpd git nodejs
sudo systemctl enable --now httpd
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

### 2. リポジトリディレクトリの作成

```bash
sudo mkdir -p /var/lib/git/public
sudo mkdir -p /var/lib/git/private
sudo chown -R apache:apache /var/lib/git
sudo chmod -R 755 /var/lib/git
sudo chmod -R g+w /var/lib/git
```

既存リポジトリがある場合は public に移動します：

```bash
sudo mv /var/lib/git/*.git /var/lib/git/public/
```

### 3. Web ディレクトリの作成

```bash
sudo mkdir -p /var/www/gitdash
sudo chmod 755 /var/www/gitdash
```

### 4. htpasswd ユーザーの作成

```bash
# 最初のユーザー（ファイルを新規作成）
sudo htpasswd -c /etc/httpd/.htpasswd ユーザー名

# 2人目以降（-c なしで追記）
sudo htpasswd /etc/httpd/.htpasswd ユーザー名
```

> **注意:** `-c` は既存ファイルを上書きするため、2人目以降には使わないでください。

### 5. mod_proxy の有効化確認

```bash
httpd -M | grep proxy
# proxy_module と proxy_http_module が表示されれば OK
# （RHEL の httpd には通常同梱されています）
```

表示されない場合は `/etc/httpd/conf.modules.d/00-proxy.conf` を確認してください。

### 6. ファイルのデプロイ

```bash
chmod +x deploy.sh
sudo ./deploy.sh
```

初回は systemd サービスが未設定のため、スクリプトが設定例を出力します。
その内容に従って gitdash サービスを作成・起動してください：

```bash
sudo tee /etc/systemd/system/gitdash.service <<EOF
[Unit]
Description=Git Dashboard
After=network.target

[Service]
Type=simple
WorkingDirectory=/var/www/gitdash
ExecStart=/usr/bin/node /var/www/gitdash/server.js
Restart=on-failure
Environment=PORT=5987
Environment=BASE_PATH=/gitdash

[Install]
WantedBy=multi-user.target
EOF

sudo systemctl daemon-reload
sudo systemctl enable --now gitdash
```

### 7. 動作確認

```bash
# Node.js サービスの状態確認
sudo systemctl status gitdash

# Node.js に直接アクセス（サーバー内から）
curl -s http://127.0.0.1:5987/gitdash/

# Apache 経由でアクセス
curl -s http://localhost/gitdash/

# API の確認
curl -s 'http://localhost/gitdash/api?action=repos'
```

ブラウザで `http://<サーバーIP>/gitdash/` にアクセスして Web UI を確認します。

---

## デプロイ手順（更新時）

ファイルを編集後、以下のコマンドで反映します。

```bash
sudo ./deploy.sh
```

---

## リポジトリの管理

### パブリックリポジトリの作成

```bash
sudo git init --bare /var/lib/git/public/リポジトリ名.git
sudo chown -R apache:apache /var/lib/git/public/リポジトリ名.git
sudo chmod -R g+w /var/lib/git/public/リポジトリ名.git
```

### プライベートリポジトリの作成

```bash
sudo mkdir -p /var/lib/git/private/ユーザー名
sudo git init --bare /var/lib/git/private/ユーザー名/リポジトリ名.git
sudo chown -R apache:apache /var/lib/git/private/ユーザー名
sudo chmod -R g+w /var/lib/git/private/ユーザー名/リポジトリ名.git
```

### クライアントからの接続 URL

| 種別 | clone | push |
|------|-------|------|
| パブリック | `http://サーバーIP/git/public/リポジトリ.git` | 認証あり（htpasswd） |
| プライベート | `http://ユーザー名@サーバーIP/git/private/ユーザー名/リポジトリ.git` | 認証あり（htpasswd） |

```bash
# パブリック clone（認証不要）
git clone http://192.168.1.100/git/public/project.git

# プライベート clone（認証あり）
git clone http://alice@192.168.1.100/git/private/alice/myapp.git
```

---

## トラブルシューティング

| 症状 | 原因 | 対処 |
|------|------|------|
| `/gitdash/` にアクセスすると 502 Bad Gateway | gitdash サービスが未起動 | `sudo systemctl start gitdash` |
| `/gitdash/` にアクセスすると 404 | Apache の ProxyPass が効いていない | `httpd -M \| grep proxy` で mod_proxy を確認 |
| ログイン後もプライベートリポジトリが表示されない | htpasswd の設定ミス | `/etc/httpd/.htpasswd` のパスとユーザー名を確認 |
| `pubList is not defined` エラー | ブラウザが古い JS をキャッシュ | Ctrl+Shift+R で強制リロード |
| `unable to create temporary object directory` | `objects/` への書き込み権限不足 | `sudo chmod -R g+w /var/lib/git` |
| 文字化け | Git の quotepath 設定 | `git config --global core.quotepath false` |

### ログの確認

```bash
# gitdash Node.js サービスのログ
sudo journalctl -u gitdash -f

# Apache エラーログ
sudo tail -f /var/log/httpd/error_log

# Apache アクセスログ
sudo tail -f /var/log/httpd/access_log
```
