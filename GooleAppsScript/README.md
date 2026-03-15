# GooleAppsScript

`GooleAppsScript/` は、HouseholdAccount の入力受付、OCR、保存、同期、管理 API を担当する Apps Script です。

## 役割

- LINE Webhook の受付
- 手入力フローの進行管理
- レシート画像の OCR 処理
- スプレッドシート保存
- Google カレンダー同期
- Flask 連携用 API の提供

## ファイル

| ファイル | 内容 |
|---|---|
| `webapp.js` | `doGet` / `doPost` と API 分岐 |
| `manual_flow.js` | LINE 手入力フロー |
| `receipt_flow.js` | レシート OCR フロー |
| `repository.js` | スプレッドシート CRUD |
| `integrations.js` | LINE、OCR、Geocode、Calendar 連携 |
| `category_master.js` | カテゴリ定義 |
| `config.js` | シート定義、設定取得、共通関数 |

## `setting` シート

| キー | 内容 |
|---|---|
| `line_channel_access_token` | LINE のアクセストークン |
| `gemini_api_key` | Gemini API キー |
| `receipt_drive_folder_id` | レシート保存先フォルダ ID |
| `calendar_id` | Google カレンダー ID |
| `admin_token` | Flask 管理 API 用トークン |

## 提供する API

### GET

- `action=mapData`
- `action=listTransactions`
- `action=getTransaction`
- `action=summary`
- `action=auditLogs`

### POST

- `action=updateTransaction`
- `action=resyncCalendar`

## デプロイ手順

1. Google スプレッドシートを作成する
2. Apps Script を紐づける
3. このフォルダの JavaScript ファイルを配置する
4. `setting` シートを作成する
5. Web アプリとしてデプロイする
6. LINE Developers に Webhook URL を設定する

