# gitweb-dashboard

RHEL 10 オフライン環境向けの Git リポジトリ Web ビューア。  
Gitweb をバックエンドとして使用し、パブリック/プライベートリポジトリの閲覧・認証に対応したカスタム Web UI を提供します。

## 概要

| 項目 | 内容 |
|------|------|
| 対象 OS | RHEL 10（オフライン・エアギャップ環境） |
| 使用パッケージ | `gitweb`, `httpd`（BaseOS/AppStream のみ） |
| 外部ライブラリ | **なし**（Python 標準ライブラリ・Vanilla JS のみ） |
| 認証方式 | Apache htpasswd（Basic 認証） |

### アーキテクチャ

```
ブラウザ
  │
  ├─ GET /gitdash/        → /var/www/gitdash/index.html（Web UI）
  ├─ GET /api/api.py      → /var/www/gitapi/api.py（Python CGI プロキシ）
  │     └─ 内部で Gitweb の Atom/OPML/plain text を取得・加工して JSON で返す
  └─ GET/POST /git/...    → git-http-backend（clone / push / pull）

Apache httpd
  └─ Gitweb CGI (/gitweb/gitweb.cgi)
```

### 機能

- パブリックリポジトリを認証なしで閲覧
- htpasswd ログイン後、自分のプライベートリポジトリが追加表示される
- コミット履歴・差分（diff）・ファイルツリーの表示
- `git clone` / `git push` を HTTP 経由で実行可能
  - パブリック：clone は認証なし、push は認証あり
  - プライベート：clone・push ともに認証あり

---

## ファイル構成

```
gitweb-dashboard/
├── README.md
├── deploy.sh                  # デプロイスクリプト
├── api/
│   └── api.py                 # Python CGI プロキシ（→ /var/www/gitapi/api.py）
├── dashboard/
│   └── index.html             # Web UI（→ /var/www/gitdash/index.html）
└── apache/
    ├── gitweb.conf            # Apache バーチャル設定（→ /etc/httpd/conf.d/gitweb.conf）
    └── gitweb.app.conf        # Gitweb アプリ設定（→ /etc/gitweb.conf）
```

> **注意:** `/etc/httpd/.htpasswd` はパスワードが含まれるためリポジトリには含めません。

---

## セットアップ手順

### 前提条件

- RHEL 10 サーバーに `httpd` と `git` がインストール済み
- `sudo` 権限があるユーザーで作業する
- `mod_suexec` は**無効化**されていること（後述）

### 1. パッケージのインストール

```bash
sudo dnf install -y httpd git gitweb
sudo systemctl enable --now httpd
sudo firewall-cmd --permanent --add-service=http
sudo firewall-cmd --reload
```

### 2. mod_suexec の無効化

RHEL 10 のデフォルトでは `mod_suexec` が apache ユーザー（UID 48）の CGI 実行を拒否します。

```bash
sudo sed -i 's/^LoadModule suexec_module/#LoadModule suexec_module/' \
  /etc/httpd/conf.modules.d/00-base.conf
```

### 3. リポジトリディレクトリの作成

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

### 4. Web ディレクトリの作成

```bash
sudo mkdir -p /var/www/gitdash
sudo mkdir -p /var/www/gitapi
sudo chmod 755 /var/www/gitdash /var/www/gitapi
```

### 5. htpasswd ユーザーの作成

```bash
# 最初のユーザー（ファイルを新規作成）
sudo htpasswd -c /etc/httpd/.htpasswd ユーザー名

# 2人目以降（-c なしで追記）
sudo htpasswd /etc/httpd/.htpasswd ユーザー名
```

> **注意:** `-c` は既存ファイルを上書きするため、2人目以降には使わないでください。

### 6. ファイルのデプロイ

`deploy.sh` を使うか、手動でコピーします。

```bash
# deploy.sh を使う場合
chmod +x deploy.sh
sudo ./deploy.sh

# 手動の場合
sudo cp api/api.py        /var/www/gitapi/api.py
sudo cp dashboard/index.html /var/www/gitdash/index.html
sudo cp apache/gitweb.conf   /etc/httpd/conf.d/gitweb.conf
sudo cp apache/gitweb.app.conf /etc/gitweb.conf
sudo chmod 755 /var/www/gitapi/api.py
sudo chown apache:apache /var/www/gitapi/api.py
```

### 7. Apache の再起動

```bash
sudo apachectl configtest   # 設定に問題がないか確認
sudo systemctl restart httpd
```

### 8. 動作確認

```bash
# Gitweb が動いているか
curl -s 'http://localhost/gitweb/?a=opml' | head -5

# API が動いているか
curl -s 'http://localhost/api/api.py?action=repos'

# 認証あり（プライベート含む）
curl -u ユーザー名 'http://localhost/api/api.py?action=repos'
```

ブラウザで `http://<サーバーIP>/gitdash/` にアクセスして Web UI を確認します。

---

## デプロイ手順（更新時）

ファイルを編集後、以下のコマンドで反映します。

```bash
sudo ./deploy.sh
```

`deploy.sh` の内容：

```bash
#!/bin/bash
set -e
sudo cp api/api.py           /var/www/gitapi/api.py
sudo cp dashboard/index.html /var/www/gitdash/index.html
sudo cp apache/gitweb.conf   /etc/httpd/conf.d/gitweb.conf
sudo cp apache/gitweb.app.conf /etc/gitweb.conf
sudo chmod 755 /var/www/gitapi/api.py
sudo chown apache:apache /var/www/gitapi/api.py
sudo apachectl configtest && sudo systemctl reload httpd
echo "デプロイ完了"
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
| `exec of api.py failed (Permission denied)` | `mod_suexec` が apache UID 48 を拒否 | セットアップ手順 2 の `mod_suexec` 無効化を実施 |
| API が JSON でなくソースコードを返す | `api.py` の shebang がない | `#!/usr/bin/env python3` が先頭行にあるか確認 |
| ログイン後もプライベートリポジトリが表示されない | `CGIPassAuth On` がない | `/etc/httpd/conf.d/gitweb.conf` の `/api/` ブロックに追加 |
| `pubList is not defined` エラー | ブラウザが古い `index.html` をキャッシュ | Ctrl+Shift+R で強制リロード |
| OPML が空（リポジトリが表示されない） | リポジトリにコミットがない | 初回コミットを追加する |
| `unable to create temporary object directory` | `objects/` への書き込み権限不足 | `sudo chmod -R g+w /var/lib/git` |
| `HTTP Error 400` on Files タブ | 空の `f=` パラメータを Gitweb に渡している | `api.py` の最新版を使用しているか確認 |
| 文字化け | Git の quotepath 設定 | `git config --global core.quotepath false` |

### ログの確認

```bash
# Apache エラーログ
sudo tail -f /var/log/httpd/error_log

# Apache アクセスログ
sudo tail -f /var/log/httpd/access_log
```
