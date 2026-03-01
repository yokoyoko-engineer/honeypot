# Security Sandbox 🛡️

サイバーセキュリティの**攻撃・防御体験**ができる研修用シミュレーターアプリです。  
研修生は「攻撃側」と「防御側」に分かれ、Linuxターミナル風UIを通じてリアルなセキュリティインシデント対応を体験します。

## アプリ概要

```
[攻撃側]                              [防御側]
  |                                     |
  | 1. SSHブルートフォース攻撃 ──────────→ アラート通知
  | 2. 認証情報取得 → 自動ログイン         ログ確認 (tail -f /var/log/auth.log)
  | 3. DBデータ奪取                       攻撃IPを自力で特定
  | 4. バックドア作成                     iptables でIPブロック → 攻撃者ログアウト
  |                                     被害範囲の調査
  |                                     バックドア発見 → kill/rm で遮断
```

### 攻撃側（Attacker）の体験内容
- **Phase 1**: SSH ブルートフォース攻撃でパスワードを解析
- **Phase 2**: 取得した認証情報で自動ログイン
- **Phase 3**: データベース内のユーザー情報・シークレットを奪取
- **Phase 4**: バックドアプログラムを設置（IPブロック後も接続維持）

### 防御側（Defender）の体験内容
- ブルートフォース検知アラートの受信
- `tail -f /var/log/auth.log` でログを解析し、攻撃者IPを**自力で特定**
- `iptables -A INPUT -s <IP> -j DROP` でIPをブロック
- `ps aux` / `netstat -an` でバックドアを調査
- `kill -9 <PID>` または `rm -rf /tmp/.hidden` でバックドアを遮断

---

## 技術スタック

| 役割 | 技術 |
|---|---|
| フロントエンド | React + TypeScript + Vite + Tailwind CSS |
| バックエンド | Node.js + Express + Socket.IO |
| リアルタイム通信 | WebSocket (Socket.IO) |
| コンテナ | Docker / Docker Compose |
| キャッシュ | Redis |

---

## 事前準備

以下のソフトウェアをインストールしてください。

- [Docker Desktop](https://www.docker.com/products/docker-desktop/)
- Git

---

## 起動方法

### 1. リポジトリをクローン

```bash
git clone <リポジトリのURL>
cd honeypot
```

### 2. Docker コンテナをビルド・起動

```bash
docker-compose up -d --build
```

初回は Docker イメージのビルドに数分かかります。

### 3. ブラウザでアクセス

| URL | 内容 |
|---|---|
| http://localhost:5173 | アプリ（ホーム画面） |
| http://localhost:3000 | バックエンドAPI（確認用） |

---

## 使い方

1. ブラウザのタブを **2つ** 開く
2. 一方を **攻撃側**（`/attacker`）、もう一方を **防御側**（`/defender`）にする
3. 攻撃側が「Phase 1: ブルートフォース」を実行
4. 防御側にアラートが届いたら、Linuxコマンドを駆使してインシデント対応を開始！

---

## コンテナの停止

```bash
docker-compose down
```

---

## ポート一覧

| サービス | ポート |
|---|---|
| フロントエンド (Vite) | 5173 |
| バックエンド (Express) | 3000 |
| Redis | 6379 |