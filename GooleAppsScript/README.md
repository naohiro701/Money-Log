# GooleAppsScript

`GooleAppsScript/` は、HouseholdAccount の入力・保存・同期を担う中核です。  
LINE から届いたイベントを受け取り、OCR、正規化、スプレッドシート保存、Google カレンダー同期、管理 API 提供までをまとめて担当します。

---

## このフォルダでできること

### 1. LINE 手入力

- 金額を受け取る
- カテゴリを段階的に選ばせる
- 位置情報または店舗名を受け取る
- 1件の取引として保存する

### 2. レシート OCR

- 画像を受け取る
- OCR で JSON 化する
- 取引と明細へ正規化する
- スプレッドシートへ保存する
- Google カレンダーへ登録する

### 3. 管理 API

- 一覧取得
- 詳細取得
- 監査ログ取得
- 取引更新
- カレンダー再同期

---

## ファイル構成

| ファイル | 役割 |
|---|---|
| `webapp.js` | `doGet` / `doPost` の入口 |
| `manual_flow.js` | LINE 手入力フロー |
| `receipt_flow.js` | レシート OCR フロー |
| `repository.js` | スプレッドシート CRUD |
| `integrations.js` | LINE / OCR / Geocode / Calendar 連携 |
| `category_master.js` | カテゴリ定義 |
| `config.js` | 共通設定、ヘッダー、ユーティリティ |

---

## `setting` シートの書き方

`A列=キー`, `B列=値` の形で設定します。

| キー | 内容 |
|---|---|
| `line_channel_access_token` | LINE のチャネルアクセストークン |
| `gemini_api_key` | Gemini API キー |
| `receipt_drive_folder_id` | レシート画像保存先 Drive フォルダ ID |
| `calendar_id` | Google カレンダー ID |
| `admin_token` | Flask から更新 API を呼ぶためのトークン |

---

## スプレッドシートで使う主なシート

| シート名 | 用途 |
|---|---|
| `transactions` | 1取引1行の台帳 |
| `transaction_items` | 明細 |
| `system_logs` | 処理ログ |
| `audit_logs` | 編集履歴 |
| `calendar_sync_logs` | カレンダー同期履歴 |
| `user_status` | 手入力途中状態 |
| `processed_events` | LINE 重複受信管理 |

---

## デプロイ手順

1. Google スプレッドシートを作る
2. Apps Script を紐づける
3. このフォルダの `.js` をプロジェクトへ貼り付ける
4. `setting` シートを作る
5. Web アプリとしてデプロイする
6. LINE Developers の Webhook URL に設定する

---

## API の考え方

### `GET`

- `action=listTransactions`
- `action=getTransaction`
- `action=summary`
- `action=auditLogs`
- `action=mapData`

### `POST`

- `action=updateTransaction`
- `action=resyncCalendar`

LINE Webhook と同じ Web アプリ URL の中で、`action` に応じて管理 API としても動きます。

---

## 運用上の注意

- 初回アクセス時に必要シートは自動生成されます
- `receipt_drive_folder_id` を設定しない場合、画像は永続保存しません
- `admin_token` を設定しない場合、Flask からの更新 API は使えません
- 本番公開前には認証と権限設定を見直してください

