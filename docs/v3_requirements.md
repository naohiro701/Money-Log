# HouseholdAccount v3 要件定義書（v1 / v2 統合）

## 1. 文書情報
- 文書名: HouseholdAccount v3 要件定義書
- 版数: v1.1
- 対象: HouseholdAccount の現行システム（実装フォルダは `GooleAppsScript` と `Flask`）
- 目的: v1 の手入力フローと v2 のレシート自動化フローを単一仕様へ統合し、誰でも同じ実装結果に到達できる設計基準を提供する

---

## 2. まず固めるべきコンセプト（v3 の北極星）

### 2.1 プロダクトコンセプト
**「家計の入力負荷を最小化しつつ、記録品質を最大化する“単一台帳”」**

- 入力手段は自由（手入力 or 画像）だが、最終的なデータ形は同じ。
- 利用者には「最短入力」、保守者には「壊れにくい構造」、分析者には「使い回せるデータ」を提供する。

### 2.2 v3 の設計原則
1. **One Event, One Transaction**
   - 1 つの LINE イベントは 1 つの `transaction` に正規化する。
2. **Channel Agnostic**
   - `manual` と `receipt_image` は UI 差分であり、ドメインモデルは共通にする。
3. **Fail Soft**
   - ジオコーディング/AI 失敗時でも保存を止めず、`status` とログで可視化する。
4. **Idempotent by Default**
   - 同一 `event_id` の再受信は再処理せず安全に無視する。
5. **Human Recoverable**
   - 失敗データは必ず手修正できる形で保存し、再実行関数を用意する。

### 2.3 提供価値（ステークホルダー別）
- ユーザー: 入力方法を選べる、登録漏れが減る。
- 開発/運用: 障害点をログで特定しやすい、機能追加が局所化できる。
- 分析者: シート構造が一定で、地図/集計/カレンダー連携が安定する。

---

## 3. 背景と現状（v1/v2 の統合理由）

### 3.1 v1 の強みと限界
- 強み: 手動入力（数値→カテゴリ→位置）の UX が実運用で確立。
- 限界: OCR/AI 連携がなく入力工数が高い。

### 3.2 v2 の強みと限界
- 強み: 画像から明細抽出、台帳保存、カレンダー登録まで自動化。
- 限界: 手動入力の運用導線が弱く、v1 とのデータ互換性が低い。

### 3.3 v3 の統合課題
1. 異なる入力経路の統合。
2. データ構造の統一。
3. 失敗時の回復性と運用可視性の標準化。

---

## 4. スコープ

### 4.1 In Scope
- LINE Webhook の統合受信（text/location/image）。
- 正規化台帳（`transactions` / `transaction_items` / `system_logs`）実装。
- ジオコーディング、カレンダー連携、地図 API 連携。
- 初期化・再処理・運用ログ機能。

### 4.2 Out of Scope
- 会計基準対応（複式簿記、税務申告向け機能）。
- OCR モデル学習基盤。
- Flask UI の全面刷新。

---

## 5. ユースケース（業務シナリオ）

### UC-01 手入力で登録
1. ユーザーが金額を送信。
2. Bot がカテゴリ選択を提示。
3. ユーザーがカテゴリ 3 階層を選択。
4. 位置情報または店舗名文字列を送信。
5. v3 が `confirmed` として保存し返信。

### UC-02 レシート画像で登録
1. ユーザーがレシート画像送信。
2. v3 が受領通知。
3. OCR/LLM 解析 → スキーマ検証 → 補正。
4. 取引・明細保存、カレンダー連携、完了通知。

### UC-03 失敗再処理
1. OCR 失敗で `failed` 保存。
2. 運用者が再処理関数を実行。
3. 成功時 `confirmed` に更新。

---

## 6. 論理アーキテクチャ

### 6.1 実装言語・実行基盤
- **Google Apps Script（JavaScript）**: Webhook、保存、外部 API 連携の中核。
- **Python（Flask）**: 一覧、地図、編集、分析を提供する管理 UI。
- **保存先**: Google Spreadsheet。

### 6.2 レイヤ構成
- `entrypoint`: doPost / doGet
- `handler`: manual / receipt
- `service`: geocode / ai / calendar / reply
- `repository`: transaction / item / log / idempotency
- `domain`: validator / state machine / category master

### 6.3 状態遷移
- `draft` -> `confirmed`
- `draft` -> `failed`
- `failed` -> `confirmed`（再処理）

---

## 7. データ要件（確定スキーマ）

### 7.1 transactions
| カラム | 型 | 必須 | 説明 |
|---|---|---:|---|
| transaction_id | string | ✅ | UUID 形式 |
| event_id | string | ✅ | LINE イベント識別子（一意） |
| user_id | string | ✅ | LINE userId |
| input_channel | enum | ✅ | `manual` / `receipt_image` |
| status | enum | ✅ | `draft` / `confirmed` / `failed` |
| date | string | ✅ | `YYYY-MM-DD` |
| time | string | ✅ | `HH:mm:ss` |
| amount_total | number | ✅ | 総額（0より大きい） |
| store_name | string |  | 店舗名 |
| store_address | string |  | 住所 |
| lat | string/number |  | 緯度 (`unknown` 許容) |
| lon | string/number |  | 経度 (`unknown` 許容) |
| category_main | string | ✅ | 大分類 |
| category_sub | string |  | 中分類 |
| category_detail | string |  | 小分類 |
| payment_method | string |  | 現金/カード等 |
| source_message | string |  | 生入力（監査用） |
| created_at | string | ✅ | ISO8601 |
| updated_at | string | ✅ | ISO8601 |

### 7.2 transaction_items
| カラム | 型 | 必須 | 説明 |
|---|---|---:|---|
| item_id | string | ✅ | UUID |
| transaction_id | string | ✅ | `transactions.transaction_id` |
| name | string | ✅ | 品目名 |
| quantity | number | ✅ | 数量 |
| unit_price | number | ✅ | 単価 |
| line_amount | number | ✅ | `quantity * unit_price` |

### 7.3 system_logs
| カラム | 型 | 必須 | 説明 |
|---|---|---:|---|
| log_id | string | ✅ | UUID |
| timestamp | string | ✅ | ISO8601 |
| level | enum | ✅ | `INFO` / `WARN` / `ERROR` |
| module | string | ✅ | 関数名・機能名 |
| event_id | string |  | 関連イベント |
| message | string | ✅ | 要約 |
| payload_snippet | string |  | 先頭 500 文字程度 |

---

## 8. 機能要件（FR）

### FR-01 受信統合
- text/location/image を判別し、対応 handler にルーティング。
- 判別不能は `ERROR` ログ + ユーザーへガイド返信。

### FR-02 手入力フロー
- 金額入力で `draft` 作成。
- カテゴリ選択で段階更新。
- 位置情報 or 店舗名で地理情報補完。
- 必須項目充足で `confirmed`。

### FR-03 レシート画像フロー
- 画像保存→OCR/LLM→スキーマ検証→補正→保存。
- 解析失敗は `failed` 保存して再送案内。

### FR-04 冪等性
- `event_id` 重複時は保存スキップし `INFO` ログ記録。

### FR-05 カレンダー連携
- `confirmed` のみ登録。
- 失敗しても取引保存はロールバックしない（非同期再試行対象）。

### FR-06 Web UI（一覧・詳細・修正）
- Flask UI で「取引一覧」「取引詳細」「編集」「再保存」を提供する。
- 編集可能項目: `date`, `time`, `store_name`, `store_address`, `amount_total`, `category_*`, `payment_method`, `items`。
- 編集保存時は `updated_at` と監査ログ（変更前/変更後差分）を必ず記録する。

### FR-07 地図/GIS 可視化
- Flask 互換 JSON を `doGet` で返却。
- 地図表示では地点クラスタリング、カテゴリ別色分け、期間フィルタを提供する。
- 住所未解決 (`unknown`) データは別レイヤで表示し、手動補正導線を持つ。

### FR-08 時系列分析
- 日次/週次/月次で支出推移を集計する API を提供する。
- カテゴリ別、曜日別、時間帯別の集計を取得可能にする。
- 異常値（急増）検知フラグを算出して UI に表示する。

### FR-09 運用機能
- 初期化、再処理、日次クリーンアップ（古い画像削除）を提供。
- 失敗トランザクション一覧と一括再処理を提供。

---

## 9. 非機能要件（NFR）
- 可用性: Webhook 成功率 99.5%以上/月
- 性能: text/location 3秒以内（P95）、画像一次返信30秒以内、UI 一覧表示 2 秒以内（P95）
- 信頼性: 重複登録 0 件
- セキュリティ: 秘密情報の直書き禁止、編集操作はユーザー識別ログ必須
- 保守性: 主要関数すべてに JSDoc + 入出力契約

---

## 10. 実装関数仕様（誰でも実装できる粒度）

> ここでは「関数名」「言語」「入力」「出力」「副作用」「失敗時挙動」を固定する。

## 10.1 Entrypoint 層

### 1) `doPost(e)`
- 言語: Google Apps Script (JavaScript)
- 役割: LINE Webhook の単一入口
- Input:
  - `e.postData.contents`: LINE webhook JSON 文字列
- Output:
  - `ContentService.TextOutput`（200 応答）
- 副作用:
  - `routeLineEvent` 呼び出し
  - `system_logs` へ受信ログ記録
- エラー時:
  - ユーザーへ汎用エラー返信
  - `ERROR` ログ追加

### 2) `doGet(e)`
- 言語: Google Apps Script (JavaScript)
- 役割: Flask 向け地図 JSON 提供
- Input:
  - `e.parameter.from`, `e.parameter.to`（任意）
- Output:
  - `[{date, lat, lng, amount, shop, category_main, description}]`
- 副作用: なし（読み取り専用）

## 10.2 Routing / Handler 層

### 3) `routeLineEvent(eventObj)`
- 言語: GAS JavaScript
- Input: LINE の `event` オブジェクト
- Output: `{handled: boolean, channel: 'manual'|'receipt_image'|'unknown'}`
- ロジック:
  - image: `handleReceiptMessage`
  - text/location: `handleManualMessage`

### 4) `handleManualMessage(eventObj)`
- 言語: GAS JavaScript
- Input: text/location メッセージ event
- Output: `{transactionId: string, status: string, replyText: string}`
- 副作用:
  - `upsertManualTransaction` 実行
  - 必要時 `resolveGeoLocation` 実行
  - `replyLineMessage` 実行

### 5) `handleReceiptMessage(eventObj)`
- 言語: GAS JavaScript
- Input: image メッセージ event
- Output: `{transactionId: string|null, status: 'confirmed'|'failed', replyText: string}`
- 副作用:
  - `downloadLineContent` / `extractReceiptJson` / `saveReceiptTransaction`
  - 成功時 `createCalendarEventSafe`

## 10.3 Service 層

### 6) `downloadLineContent(messageId, accessToken)`
- 言語: GAS JavaScript
- Input:
  - `messageId: string`
  - `accessToken: string`
- Output:
  - `{blob: Blob, mimeType: string, size: number}`
- 失敗時:
  - `throw Error('LINE_CONTENT_FETCH_FAILED')`

### 7) `extractReceiptJson(imageBlob, promptTemplate)`
- 言語: GAS JavaScript
- Input:
  - `imageBlob: Blob`
  - `promptTemplate: string`
- Output:
  - `ReceiptDTO`（下記 10.6 参照）
- 失敗時:
  - パース不能なら `throw Error('RECEIPT_PARSE_FAILED')`

### 8) `validateReceiptDto(receiptDto)`
- 言語: GAS JavaScript
- Input: `ReceiptDTO`
- Output: `{valid: boolean, errors: string[]}`
- ルール:
  - `total > 0`
  - `year/month/day` が日付として妥当

### 9) `resolveGeoLocation(queryText)`
- 言語: GAS JavaScript
- Input: `queryText: string`
- Output: `{address: string, lat: number|string, lon: number|string, confidence: 'high'|'low'|'none'}`
- 失敗時:
  - `{address:'unknown', lat:'unknown', lon:'unknown', confidence:'none'}`

### 10) `createCalendarEventSafe(transaction)`
- 言語: GAS JavaScript
- Input: `TransactionEntity`
- Output: `{created: boolean, eventId?: string, error?: string}`
- 備考: 失敗しても `transaction` 保存結果は変更しない。

### 11) `replyLineMessage(replyToken, messages)`
- 言語: GAS JavaScript
- Input:
  - `replyToken: string`
  - `messages: Array<{type:string,text?:string,contents?:object}>`
- Output: `{ok: boolean, statusCode: number}`

## 10.4 Repository 層

### 12) `findTransactionByEventId(eventId)`
- 言語: GAS JavaScript
- Input: `eventId: string`
- Output: `TransactionEntity | null`

### 13) `insertTransaction(tx)`
- 言語: GAS JavaScript
- Input: `TransactionEntity`
- Output: `{transactionId: string, rowNumber: number}`

### 14) `updateTransaction(transactionId, patch)`
- 言語: GAS JavaScript
- Input:
  - `transactionId: string`
  - `patch: Partial<TransactionEntity>`
- Output: `{updated: boolean}`

### 15) `insertTransactionItems(transactionId, items)`
- 言語: GAS JavaScript
- Input:
  - `transactionId: string`
  - `items: Array<ItemEntity>`
- Output: `{count: number}`

### 16) `appendSystemLog(level, module, message, eventId, payloadSnippet)`
- 言語: GAS JavaScript
- Input:
  - `level: 'INFO'|'WARN'|'ERROR'`
  - `module: string`
  - `message: string`
  - `eventId?: string`
  - `payloadSnippet?: string`
- Output: `{logId: string}`

## 10.5 運用バッチ / 補助関数

### 17) `bootstrapV3Sheets()`
- 言語: GAS JavaScript
- Input: なし
- Output: `{createdSheets: string[], warnings: string[]}`

### 18) `reprocessFailedTransaction(transactionId)`
- 言語: GAS JavaScript
- Input: `transactionId: string`
- Output: `{status: 'confirmed'|'failed', reason?: string}`

### 19) `cleanupExpiredReceiptImages(retentionDays)`
- 言語: GAS JavaScript
- Input: `retentionDays: number`
- Output: `{deletedCount: number}`

### 20) `buildMapResponse(fromDate, toDate)`
- 言語: GAS JavaScript
- Input:
  - `fromDate?: string (YYYY-MM-DD)`
  - `toDate?: string (YYYY-MM-DD)`
- Output:
  - `Array<MapPointDTO>`


## 10.6 Web UI/API 層（Python Flask）

### 21) `GET /api/transactions`
- 言語: Python (Flask)
- Input (query):
  - `from`, `to`（日付）
  - `category_main`（任意）
  - `status`（任意）
- Output:
  - `{items: TransactionEntity[], total_count: number}`

### 22) `GET /api/transactions/<transaction_id>`
- 言語: Python (Flask)
- Input: `transaction_id`
- Output:
  - `{transaction: TransactionEntity, items: ItemEntity[], logs: SystemLog[]}`

### 23) `PUT /api/transactions/<transaction_id>`
- 言語: Python (Flask)
- Input:
  - JSON body（編集対象フィールド + 編集理由）
- Output:
  - `{updated: true, transaction: TransactionEntity}`
- 副作用:
  - GAS 側 `updateTransaction` 呼び出し
  - 変更監査ログ保存

### 24) `PUT /api/transactions/<transaction_id>/items`
- 言語: Python (Flask)
- Input:
  - `items: Array<ItemEntity>`
- Output:
  - `{updated_count: number}`

### 25) `GET /api/analytics/timeseries`
- 言語: Python (Flask)
- Input (query):
  - `unit=day|week|month`
  - `from`, `to`
  - `category_main`（任意）
- Output:
  - `{series: [{bucket: string, amount_total: number, count: number}]}`

### 26) `GET /api/analytics/geo`
- 言語: Python (Flask)
- Input (query):
  - `from`, `to`, `category_main`（任意）
- Output:
  - `{points: MapPointDTO[], heatmap: [{lat:number,lng:number,weight:number}]}`

## 10.7 DTO / Entity 定義（固定）

### `ReceiptDTO`
```json
{
  "store_name": "string",
  "store_address": "string|unknown",
  "phone_number": "string|unknown",
  "year": 2025,
  "month": 1,
  "day": 31,
  "time": "12:34",
  "receipt_number": "string",
  "items": [
    {"name": "string", "price": 120, "quantity": 2}
  ],
  "subtotal": 240,
  "tax": 24,
  "total": 264,
  "payment_method": "現金|クレジット|その他",
  "change": 0,
  "category": "食材費"
}
```

### `TransactionEntity`（概念）
- `transactions` テーブル 1 行と同義。

### `MapPointDTO`
```json
{
  "date": "2025-01-31",
  "lat": 35.123,
  "lng": 139.123,
  "amount": 264,
  "shop": "スーパーA",
  "category_main": "生活費(食住)",
  "description": "スーパーA\n金額:264円\n日付:2025-01-31"
}
```

---

## 11. エラーハンドリング規約
- 例外コード（文字列）を統一:
  - `LINE_CONTENT_FETCH_FAILED`
  - `RECEIPT_PARSE_FAILED`
  - `VALIDATION_FAILED`
  - `CALENDAR_CREATE_FAILED`
  - `GEOCODE_FAILED`
- すべて `appendSystemLog` に記録。
- ユーザー向け返信は内部コードを隠蔽し、再操作方法のみ案内。

---

## 12. 移行要件（v1/v2 -> v3）

### 12.1 移行手順
1. `bootstrapV3Sheets()` で新シート生成。
2. v1 データを `transactions` へ取り込み。
3. v2 データを `transactions` + `transaction_items` へ取り込み。
4. 件数・総額の照合。
5. 並行稼働（2週間）後に v3 へ一本化。

### 12.2 整合チェック
- レコード件数差: 0
- 月次総額差: 0%
- 地図描画件数差: 0

---

## 13. 受入テスト要件（実行可能レベル）

### 13.1 主要テストケース
1. 手入力（正常系）で `confirmed` になる。
2. 手入力（カテゴリ未完）で `draft` になる。
3. 画像入力（正常系）で明細が複数保存される。
4. OCR 失敗で `failed` + 再送メッセージ。
5. 同一 event 再送で重複登録されない。
6. ジオコーディング失敗時に `unknown` 保存。
7. カレンダー失敗時に取引保存は成功する。
8. doGet が Flask 互換 JSON を返す。
9. 再処理で `failed` -> `confirmed` へ遷移。
10. クリーンアップで期限切れ画像が削除される。

### 13.2 合格基準
- 上記 10 ケース成功率 100%。
- ログ未記録エラーが 0 件。

---

## 14. 実装順序（推奨）
- P0: `doPost`, `routeLineEvent`, repository 基盤、冪等性
- P1: manual / receipt handler、validation、reply
- P2: geocode / calendar / doGet
- P3: 再処理、クリーンアップ、移行スクリプト

---

## 15. 推奨ディレクトリ構成

```text
GooleAppsScript/
  main.js
  handlers/
    manual_handler.js
    receipt_handler.js
  services/
    line_service.js
    ai_receipt_service.js
    geocode_service.js
    calendar_service.js
  repositories/
    transaction_repository.js
    item_repository.js
    log_repository.js
  domain/
    validators.js
    category_master.js
    state_machine.js
  jobs/
    reprocess_job.js
    cleanup_job.js
  setup/
    bootstrap.js
```

この構成により、コンセプト（入力自由・台帳統一・回復可能）を実装へ直接落とし込める。

---

## 16. 要件適合性チェック（今回提示要件に対する充足確認）

### 16.1 要件トレーサビリティ
| ユーザー要件 | 対応要件 | 充足判定 | 備考 |
|---|---|---|---|
| レシート写真を OCR で読み取りデータ化 | FR-03, 関数 6/7/8 | ✅ | OCR/LLM + バリデーションを規定 |
| スプレッドシート保存 | FR-03, FR-04, スキーマ 7章 | ✅ | `transactions`/`transaction_items` |
| 同時に Google カレンダー登録 | FR-05, 関数 10 | ✅ | 保存失敗と独立で再試行可能 |
| Web UI で確認・修正 | FR-06, API 21-24 | ✅（今回補強） | 一覧/詳細/編集/監査ログ追加 |
| GIS/時系列で高度分析 | FR-07, FR-08, API 25-26 | ✅（今回補強） | 地図・ヒートマップ・時系列集計 |

### 16.2 以前不足していた点と修正
- 不足1: Web UI 編集要件が抽象的だった。
  - 修正: FR-06 と API 21-24 を追加し、編集可能項目と監査ログを明文化。
- 不足2: GIS・時間解析が要件文で弱かった。
  - 修正: FR-07/FR-08 と API 25-26 を追加し、地理/時系列分析 I/O を固定。

---

## 17. 追加機能提案（新規提案）

### 提案A: OCR 信頼度ベースの「要確認キュー」
- 概要: OCR の低信頼フィールドを自動抽出し、UI で優先レビュー。
- 効果: 修正効率が向上し、誤データ流入を抑制。

### 提案B: 類似レシート自動補完
- 概要: 過去同店舗のカテゴリ/支払方法を初期値として提案。
- 効果: 手修正回数を削減。

### 提案C: 予算超過アラート
- 概要: 月次カテゴリ予算を設定し、閾値超過で LINE 通知。
- 効果: 家計改善アクションを即時化。

### 提案D: ルート分析（移動×支出）
- 概要: 時系列位置データと支出イベントを重ね、移動パターン別支出を可視化。
- 効果: 交通費・外食費の最適化に活用。

### 提案E: 監査モード（差分復元）
- 概要: 編集履歴を時系列で保持し、任意時点へロールバック可能にする。
- 効果: 誤編集の復旧時間短縮。
