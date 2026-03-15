# HouseholdAccount

HouseholdAccount は、LINE から家計データを登録し、Google スプレッドシートに保存し、Google カレンダーと Flask 画面で活用するためのシステムです。

## 機能

- LINE のテキスト入力による家計登録
- LINE のレシート画像による OCR 登録
- Google スプレッドシートへの台帳保存
- Google カレンダーへの支出イベント登録
- Flask 画面での一覧表示、地図表示、編集、監査ログ確認、集計
- 家庭バランスシートの保存と表示

## ディレクトリ

| パス | 内容 |
|---|---|
| `GooleAppsScript/` | LINE Webhook、OCR、保存、同期、管理 API |
| `Flask/` | 一覧、地図、編集、分析、バランスシート |
| `docs/` | 要件定義、構成資料、関数一覧 |
| `images/` | 画面イメージ |
| `memo/` | 補助メモ |

## システム構成

1. ユーザーが LINE で金額またはレシート画像を送信する
2. `GooleAppsScript` が入力内容を判定する
3. 手入力フローまたは OCR フローで取引データを作成する
4. `transactions` と `transaction_items` に保存する
5. 必要に応じて Google カレンダーを更新する
6. `Flask` がデータを取得し、一覧、地図、編集画面として表示する

## セットアップ

### 1. Google スプレッドシートを作成する

Apps Script を紐づけるスプレッドシートを 1 つ作成します。

### 2. Apps Script に `GooleAppsScript/` のコードを配置する

`GooleAppsScript/` 配下の JavaScript ファイルを Apps Script プロジェクトへ配置します。

### 3. `setting` シートを作成する

`A列=キー`, `B列=値` の形式で次を設定します。

| キー | 内容 |
|---|---|
| `line_channel_access_token` | LINE Messaging API のアクセストークン |
| `gemini_api_key` | OCR に使用する Gemini API キー |
| `receipt_drive_folder_id` | レシート画像保存先 Google Drive フォルダ ID |
| `calendar_id` | Google カレンダー ID |
| `admin_token` | Flask から管理 API を呼ぶためのトークン |

### 4. Apps Script を Web アプリとしてデプロイする

発行された URL を LINE Webhook と Flask 連携に使用します。

### 5. Flask を起動する

```bash
cd Flask
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

### 6. 必要な環境変数を設定する

| 環境変数 | 用途 |
|---|---|
| `GAS_WEBAPP_URL` | Apps Script の Web アプリ URL |
| `GAS_ADMIN_TOKEN` | Apps Script の管理 API 用トークン |
| `FLASK_DEBUG` | Flask デバッグ起動切り替え |

`GAS_WEBAPP_URL` を設定しない場合、Flask は `Flask/data/*.json` を使用してローカルモードで動作します。

## スプレッドシートで使用するシート

| シート名 | 用途 |
|---|---|
| `transactions` | 1取引1行の台帳 |
| `transaction_items` | レシート明細 |
| `system_logs` | 処理ログ |
| `audit_logs` | 更新履歴 |
| `calendar_sync_logs` | Google カレンダー同期履歴 |
| `user_status` | 手入力途中状態 |
| `processed_events` | LINE イベント重複管理 |
| `setting` | 外部連携設定 |

## 主要画面

### `/`

- 取引一覧
- 地図表示
- フィルタ
- 取引編集
- 監査ログ
- 月次集計

### `/balance-sheet`

- 資産入力
- 負債入力
- 純資産表示
- 履歴表示

## ドキュメント

- `docs/v3_architecture.md`: システム構成
- `docs/function_map.md`: 関数一覧と呼び出し関係
- `docs/v3_requirements.md`: 要件定義
- `docs/v3_balance_sheet_feature.md`: バランスシート機能

