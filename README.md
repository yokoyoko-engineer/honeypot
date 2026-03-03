# Security Sandbox 🛡️

サイバーセキュリティの**攻撃・防御体験**ができる研修用シミュレーターアプリです。  
研修生は「攻撃側」と「防御側」に分かれ、Linuxターミナル風UIを通じてリアルなセキュリティインシデント対応を体験します。

## アプリ概要

```
[攻撃側]                                     [防御側]
  |                                            |
  | 1. 10種のサイバー攻撃から選択・実行 ──────→ 通知：不審な活動を検知
  |   (ランサムウェア、SQLi、DDoS等)           |
  | 2. システム権限や機密データを奪取          Playbook (対応マニュアル) を確認
  |                                            |
  |                                            ログ確認 (tail /var/log/auth.log 等)
  |                                            攻撃種類とIPを特定
  |                                            |
  |                                            iptables でIPブロック (通信遮断)
  |                                            |
  |                                            被害状況・プロセスの調査 (ps aux 等)
  |                                            不正プロセス・ファイルの排除 (kill / rm)
```

### 攻撃側（Attacker）の体験内容
- 最新の10種の攻撃シナリオ（SSHブルートフォース、SQLインジェクション、DDoS、ランサムウェア、RCE、XSS、OSコマンドインジェクション、FTPマルウェア、ポートスキャン、特権昇格）から選択して実行。
- ボタン一つで攻撃プロセス（エクスプロイトによる権限奪取やデータ窃取など）を進行。

### 防御側（Defender）の体験内容
- 攻撃開始とともに「不審な兆候」のアラートを受信。
- **Playbook（対応マニュアル）** を見ながら、完全にターミナル（CUI）ベースでインシデントに対応。
- `tail -f /var/log/auth.log` や `tail /var/log/syslog` 等でログを解析し、攻撃の種類と攻撃者のIPを自力で特定。
- `iptables -A INPUT -s <IP> -j DROP` で攻撃元IPをブロック。
- `ps aux` や `netstat -an` でシステムに潜むバックドアや暗号化プロセス（ランサムウェア）を調査。
- `kill -9 <PID>` や `rm -rf /tmp/.hidden` 等で脅威を完全に排除し、「Game Clear」を目指す。

---

## 技術スタック

| 役割 | 技術 |
|---|---|
| フロントエンド | React + TypeScript + Vite + Tailwind CSS |
| バックエンド | Node.js + Express + Socket.IO |
| リアルタイム通信 | WebSocket (Socket.IO) |
| コンテナ | Docker / Docker Compose |
| リバースプロキシ | nginx |

---

## 事前準備

以下のソフトウェアをインストールしてください。

- [Docker Desktop](https://www.docker.com/products/docker-desktop/) または Docker Engine
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
docker compose up -d --build
```

初回は Docker イメージのビルドに数分かかります。

### 3. ブラウザでアクセス

| URL | 内容 |
|---|---|
| `http://localhost/` | ローカルアクセス |
| `http://<サーバーのIPアドレス>/` | 外部からのアクセス |

> **サーバーIPの確認方法**
> ```bash
> ip addr show | grep "inet " | grep -v 127.0.0.1
> # または
> curl ifconfig.me   # グローバルIPの確認
> ```

---

## 使い方

1. ブラウザのタブを **2つ** 開く
2. 一方を **攻撃側**（`/attacker`）、もう一方を **防御側**（`/defender`）にする
3. 攻撃側がシナリオ一覧から任意の攻撃（例：ランサムウェアやDDoS）を選び実行
4. 防御側にアラートが届いたら、Playbookを参考にLinuxコマンドを駆使してインシデント対応（トリアージ・封じ込め・根絶）を完了させる！

---

## コンテナの停止

```bash
docker compose down
```

---

## ポート一覧

| サービス | ポート | 公開 |
|---|---|---|
| nginx（フロントエンド + プロキシ） | 80 | ✅ 外部公開 |
| バックエンド (Express) | 3000 | 🔒 内部のみ（nginx経由） |

---

## アーキテクチャ

```
外部ユーザー
    │  :80
    ▼
┌────────────────────────┐
│  nginx (frontendコンテナ)│
│  ・React SPA 配信       │
│  ・/socket.io/ → proxy  │
└──────────┬─────────────┘
           │ 内部ネットワーク
           ▼ :3000
┌─────────────────────────┐
│  Express + Socket.IO    │
│  (backendコンテナ)        │
└─────────────────────────┘
```