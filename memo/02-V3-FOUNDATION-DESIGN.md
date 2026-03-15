# HouseholdAccount v3 要件定義・基本設計

> 本書は、地図可視化とOCR、AIカテゴリ、Googleカレンダー連携の統合に向けて、仕様化した設計書である。

---

## 0. ドキュメントの使い方

- この文書は次の順で利用する。
  1. **章1〜3**: 目的とスコープを確定
  2. **章4〜6**: データ契約と業務ルールを固定
  3. **章7〜10**: API・関数仕様を実装へ落とし込み
  4. **章11〜13**: 品質・効率・運用を確立
- 迷った場合は次の優先順位で判断する。
  - 優先度1: データ一貫性
  - 優先度2: 正確性（OCR忠実性）
  - 優先度3: パフォーマンス
  - 優先度4: UI体験

---

## 1. v3 の定義

## 1.1 プロダクト定義
v3 は「家計イベント統合基盤」である。単なる家計簿ではなく、
- **レシート原本情報（OCR）**
- **空間情報（地図）**
- **時間情報（Googleカレンダー）**
を 1 件のトランザクション単位で統合して管理する。

## 1.2 成果指標（KPI）
- OCR後の手修正率: 40% 未満（初期目標）
- 地図表示可能率（lat/lng 取得成功）: 95% 以上
- カレンダー同期成功率: 99% 以上（リトライ込み）
- 1件登録の平均操作時間: 30秒以内（画像選択〜保存完了）

## 1.3 MVP の完了条件
次を満たした時点で MVP 完了とする。
1. レシート画像を投入し、金額・日付・店舗名を抽出できる。
2. 抽出結果をユーザー修正して確定保存できる。
3. 地図に支出地点を表示できる。
4. Googleカレンダーへイベント連携できる。
5. 変更履歴（監査ログ）を追跡できる。

---

## 2. 機能一覧（優先順位付き）

## 2.1 P0（必須）
1. OCR取り込み
2. 正規化（date/amount/merchant/address）
3. カテゴリ提案（AI）
4. ユーザー確定フロー
5. ジオコーディング
6. 地図可視化
7. Googleカレンダー同期
8. 監査ログ

## 2.2 P1（準必須）
1. OCR信頼度に応じた警告表示
2. 明細（line items）の抽出
3. 再同期（カレンダー event update）
4. バッチ再ジオコーディング

## 2.3 P2（拡張）
1. カテゴリ提案モデルの個人最適化
2. 定期支出の異常検知
3. 予算超過アラート
4. カレンダー予定→支出予測

---

## 3. システム構成（責務分離）

## 3.1 サブシステム
1. **Ingestion Service**
   - 画像受領、ファイル保存、ジョブ投入
2. **OCR Service**
   - OCR実行、抽出結果生成
3. **Normalization Service**
   - 生テキストから構造化データへ変換
4. **Categorization Service**
   - カテゴリ候補を提案
5. **Geo Service**
   - 店舗名/住所から緯度経度を取得
6. **Calendar Sync Service**
   - Google Calendar作成/更新/削除
7. **Transaction API Service**
   - CRUD、検索、フィルタ
8. **Audit Service**
   - 変更履歴の記録と参照
9. **Web App (UI)**
   - アップロード、確認、地図、タイムライン

## 3.2 アーキテクチャ原則
- 同期APIは最小化し、重処理（OCR・ジオコーディング）は非同期ジョブ化。
- API層は薄く、ドメインロジックはサービス層へ集約。
- 外部API失敗時は必ず冪等に再実行可能な設計にする。

---

## 4. データモデル（物理設計に近い概念設計）

## 4.1 テーブル定義（必須カラム）

### 4.1.1 `transactions`
- `id` (UUID, PK)
- `user_id` (UUID, indexed)
- `occurred_on` (DATE, indexed)
- `amount_total` (INTEGER, 円, indexed)
- `currency` (TEXT, default `JPY`)
- `merchant_name` (TEXT, indexed)
- `merchant_phone` (TEXT, nullable)
- `address_text` (TEXT, nullable)
- `lat` (NUMERIC(10,7), nullable)
- `lng` (NUMERIC(10,7), nullable)
- `category_id` (UUID, FK categories.id, indexed)
- `category_source` (TEXT: `ai`/`user`)
- `source_type` (TEXT: `receipt_ocr`/`manual`/`import`)
- `status` (TEXT: `draft`/`confirmed`/`archived`)
- `created_at`, `updated_at` (TIMESTAMP)

### 4.1.2 `receipt_documents`
- `id` (UUID, PK)
- `transaction_id` (UUID, FK, unique)
- `file_path` (TEXT)
- `mime_type` (TEXT)
- `file_sha256` (TEXT, unique)
- `ocr_engine` (TEXT)
- `ocr_raw_text` (TEXT)
- `ocr_confidence` (NUMERIC(5,4))
- `parsed_json` (JSONB)
- `created_at`, `updated_at`

### 4.1.3 `receipt_line_items`
- `id` (UUID, PK)
- `transaction_id` (UUID, FK, indexed)
- `line_no` (INTEGER)
- `item_name` (TEXT)
- `item_amount` (INTEGER)
- `item_quantity` (NUMERIC(8,3), nullable)
- `created_at`, `updated_at`

### 4.1.4 `categories`
- `id` (UUID, PK)
- `name` (TEXT, unique)
- `parent_id` (UUID, FK nullable)
- `is_active` (BOOLEAN)
- `created_by` (TEXT: `system`/`ai`/`user`)
- `created_at`, `updated_at`

### 4.1.5 `category_suggestions`
- `id` (UUID, PK)
- `transaction_id` (UUID, FK)
- `suggested_category_id` (UUID, FK)
- `score` (NUMERIC(5,4))
- `reason_json` (JSONB)
- `created_at`

### 4.1.6 `calendar_sync_logs`
- `id` (UUID, PK)
- `transaction_id` (UUID, FK)
- `calendar_id` (TEXT)
- `event_id` (TEXT)
- `sync_action` (TEXT: `create`/`update`/`delete`)
- `sync_status` (TEXT: `success`/`failed`/`retrying`)
- `attempt_count` (INTEGER)
- `error_code` (TEXT, nullable)
- `error_message` (TEXT, nullable)
- `synced_at` (TIMESTAMP)

### 4.1.7 `audit_logs`
- `id` (UUID, PK)
- `actor_user_id` (UUID, nullable)
- `target_type` (TEXT)
- `target_id` (UUID)
- `action` (TEXT)
- `before_json` (JSONB)
- `after_json` (JSONB)
- `trace_id` (TEXT)
- `created_at` (TIMESTAMP)

## 4.2 インデックス方針（効率最重視）
- `transactions(user_id, occurred_on)` 複合インデックス
- `transactions(user_id, category_id, occurred_on)` 複合インデックス
- `transactions(lat, lng)` は地理系インデックス（PostGIS推奨）
- `receipt_documents(file_sha256)` にユニーク制約（重複アップロード除去）

---

## 5. 状態遷移と業務ルール

## 5.1 トランザクション状態遷移
- `draft` → `confirmed` → `archived`
- `draft` は OCR結果未確認または入力途中。
- `confirmed` はユーザー確認済みで分析対象。
- `archived` は削除代替（論理保管）。

## 5.2 保存時バリデーション
- `amount_total > 0` 必須。
- `occurred_on` は未来日でも保存可だが警告を返す。
- `merchant_name` が空の場合、`source_type=manual` 以外は警告必須。
- `lat/lng` は同時に存在すること（片方のみ不可）。

## 5.3 カテゴリ確定ルール
- AI提案は `suggestion` 扱い。確定はユーザー操作必須（MVP）。
- ユーザーが確定後、`category_source=user` に固定。
- 再学習で提案が変わっても確定済みカテゴリは自動上書きしない。

---

## 6. 変数・定数・列挙体仕様（実装再現の核）

## 6.1 グローバル定数（backend）
- `MAX_UPLOAD_MB = 10`
- `SUPPORTED_MIME_TYPES = ["image/jpeg", "image/png", "application/pdf"]`
- `OCR_TIMEOUT_SEC = 25`
- `GEOCODE_TIMEOUT_SEC = 8`
- `CALENDAR_SYNC_MAX_RETRY = 5`
- `CALENDAR_SYNC_BACKOFF_MS = [500, 1000, 2000, 5000, 10000]`
- `CATEGORY_SUGGEST_TOP_K = 3`
- `DEFAULT_CURRENCY = "JPY"`

## 6.2 列挙体
- `TransactionStatus = { DRAFT, CONFIRMED, ARCHIVED }`
- `SourceType = { RECEIPT_OCR, MANUAL, IMPORT }`
- `CategorySource = { AI, USER }`
- `SyncStatus = { SUCCESS, FAILED, RETRYING }`

## 6.3 APIレスポンス共通フィールド
- `trace_id: string`
- `server_time: ISO8601`
- `warnings: string[]`
- `errors: { code: string, message: string, field?: string }[]`

---

## 7. 関数仕様（バックエンド）

> すべての関数は「入力」「出力」「例外」「副作用」「計算量/効率上の注意」を明記する。

## 7.1 Upload/OCR

### 7.1.1 `validate_upload(file) -> ValidationResult`
- 入力: `file`（name, size, mime, bytes）
- 出力: `{ ok: bool, reasons: string[] }`
- 例外: なし（常に結果を返す）
- 副作用: なし
- 注意: MIMEチェックは拡張子でなくシグネチャ優先。

### 7.1.2 `store_receipt_file(file, user_id) -> StoredFile`
- 入力: `file`, `user_id`
- 出力: `{ file_path, file_sha256, mime_type, size }`
- 例外: ストレージ書込失敗
- 副作用: ファイル保存
- 注意: `sha256` 算出で重複検知し、既存参照を返せるようにする。

### 7.1.3 `enqueue_ocr_job(receipt_document_id) -> job_id`
- 入力: `receipt_document_id`
- 出力: `job_id`
- 例外: キュー接続失敗
- 副作用: ジョブ作成
- 注意: 冪等キー `ocr:<receipt_document_id>` を使う。

### 7.1.4 `run_ocr(file_path, engine) -> OCRRawResult`
- 入力: `file_path`, `engine`
- 出力: `{ raw_text, blocks[], confidence }`
- 例外: タイムアウト、エンジン障害
- 副作用: 外部API呼び出し
- 注意: タイムアウトは `OCR_TIMEOUT_SEC` 固定。

### 7.1.5 `parse_receipt_text(raw_text, blocks) -> ParsedReceipt`
- 入力: `raw_text`, `blocks`
- 出力: `{ amount_total, occurred_on, merchant_name, address_text, line_items[] }`
- 例外: 解析不能
- 副作用: なし
- 注意: 通貨記号・税込/税抜の正規化規則を別モジュール化。

## 7.2 Normalization/Transaction

### 7.2.1 `normalize_transaction_input(parsed, user_overrides) -> NormalizedTransaction`
- 入力: OCR解析結果 + ユーザー修正値
- 出力: 正規化済み transaction DTO
- 例外: 必須項目欠落
- 副作用: なし
- 注意: ユーザー修正値を常に優先。

### 7.2.2 `create_or_update_transaction(dto, actor) -> Transaction`
- 入力: DTO, actor
- 出力: transaction record
- 例外: DB制約違反
- 副作用: DB更新 + 監査ログ
- 注意: 単一トランザクションで保存・監査ログを同時コミット。

### 7.2.3 `record_audit_log(target, action, before, after, actor, trace_id) -> void`
- 入力: 各種
- 出力: なし
- 例外: DB障害
- 副作用: `audit_logs` 追加
- 注意: 個人情報の過剰保存を避けるためマスキング関数を適用。

## 7.3 Category

### 7.3.1 `suggest_categories(transaction, top_k) -> Suggestion[]`
- 入力: transaction
- 出力: `[{ category_id, score, reason_json }]`
- 例外: モデル未ロード
- 副作用: `category_suggestions` 保存
- 注意: `top_k = CATEGORY_SUGGEST_TOP_K`

### 7.3.2 `confirm_category(transaction_id, category_id, actor) -> Transaction`
- 入力: IDs
- 出力: 更新後 transaction
- 例外: category not found
- 副作用: transaction更新 + audit
- 注意: 既存 category_source を `USER` に上書き。

## 7.4 Geocoding/Map

### 7.4.1 `build_geocode_query(merchant_name, address_text) -> string`
- 入力: 店舗名・住所
- 出力: クエリ文字列
- 例外: なし
- 副作用: なし
- 注意: 住所優先、店舗名は補助。

### 7.4.2 `geocode_transaction(transaction_id) -> GeoResult`
- 入力: transaction_id
- 出力: `{ lat, lng, precision, provider }`
- 例外: API失敗
- 副作用: transaction の lat/lng 更新
- 注意: キャッシュキー `geocode:<normalized_query>` を利用。

### 7.4.3 `list_map_points(user_id, from, to, category_ids) -> MapPoint[]`
- 入力: filters
- 出力: 地図ポイント配列
- 例外: なし
- 副作用: なし
- 注意: ページング + bbox フィルタ対応で高速化。

## 7.5 Calendar Sync

### 7.5.1 `build_calendar_event_payload(transaction) -> EventPayload`
- 入力: transaction
- 出力: `{ summary, description, start, end, location }`
- 例外: 必須不足
- 副作用: なし
- 注意: amount/category/location を description に構造化埋め込み。

### 7.5.2 `sync_transaction_to_calendar(transaction_id, mode) -> SyncResult`
- 入力: transaction_id, mode(create/update)
- 出力: `{ status, event_id, attempts }`
- 例外: OAuth失効
- 副作用: Google API呼び出し + sync log
- 注意: 指数バックオフで `CALENDAR_SYNC_MAX_RETRY` まで実施。

### 7.5.3 `reconcile_calendar_events(user_id, date_range) -> ReconcileReport`
- 入力: user_id, range
- 出力: `{ missing_events[], stale_events[], fixed_count }`
- 例外: なし
- 副作用: 必要に応じて更新
- 注意: 深夜バッチで実行。

---

## 8. API 仕様（REST）

## 8.1 認証
- 方式: Bearer Token（将来 OAuth2）
- 全APIで `X-Trace-Id` を受理/生成

## 8.2 エンドポイント一覧

### 8.2.1 `POST /api/v3/receipts/upload`
- 目的: ファイルアップロード + OCRジョブ投入
- Request: multipart/form-data (`file`)
- Response:
  - `receipt_document_id`
  - `ocr_job_id`
  - `status = queued`

### 8.2.2 `GET /api/v3/ocr/jobs/{job_id}`
- 目的: OCR進行確認
- Response: `queued/running/succeeded/failed` + parsed preview

### 8.2.3 `POST /api/v3/transactions`
- 目的: OCR結果または手入力でトランザクション作成
- Request: normalized DTO
- Response: transaction object

### 8.2.4 `PATCH /api/v3/transactions/{id}`
- 目的: 修正・カテゴリ確定・状態更新

### 8.2.5 `GET /api/v3/transactions`
- 目的: 一覧検索
- Query:
  - `from`, `to`, `category_id`, `min_amount`, `max_amount`, `q`, `page`, `per_page`

### 8.2.6 `GET /api/v3/map/points`
- 目的: 地図表示用ポイント取得
- Query:
  - `from`, `to`, `category_ids[]`, `bbox`

### 8.2.7 `POST /api/v3/transactions/{id}/calendar-sync`
- 目的: カレンダー同期
- Body: `{ mode: "create"|"update" }`

### 8.2.8 `GET /api/v3/transactions/{id}/audit-logs`
- 目的: 履歴閲覧

---

## 9. フロントエンド仕様（画面・状態・関数）

## 9.1 画面一覧
1. `ReceiptUploadPage`
2. `OCRReviewPage`
3. `TransactionListPage`
4. `MapDashboardPage`
5. `CalendarSyncPage`
6. `TransactionDetailPage`

## 9.2 UI状態変数（例）
- `uploadFile: File | null`
- `uploadProgress: number`
- `ocrJobStatus: 'idle' | 'queued' | 'running' | 'succeeded' | 'failed'`
- `draftTransaction: TransactionDraft`
- `categorySuggestions: CategorySuggestion[]`
- `selectedCategoryId: string | null`
- `mapFilters: { from: string; to: string; categoryIds: string[] }`
- `mapPoints: MapPoint[]`
- `calendarSyncState: { loading: boolean; status?: string; error?: string }`

## 9.3 UI関数（例）
- `onSelectReceiptFile(file)`
  - バリデーション、プレビュー表示
- `onUploadReceipt()`
  - upload API 呼び出し、job polling 開始
- `pollOcrJob(jobId)`
  - 2秒間隔、最大60秒
- `onApplyOcrResult(parsed)`
  - ドラフトフォームへ反映
- `onConfirmCategory(categoryId)`
  - PATCHで確定
- `onSaveTransaction()`
  - create/update API 実行
- `onSyncCalendar(transactionId)`
  - calendar sync API 実行
- `loadMapPoints(filters)`
  - map points API 実行

---

## 10. バッチ/ジョブ設計

## 10.1 非同期ジョブ種別
1. `ocr_extract_job`
2. `geocode_job`
3. `calendar_sync_job`
4. `calendar_reconcile_job`

## 10.2 ジョブ共通フィールド
- `job_id`
- `job_type`
- `payload_json`
- `status`
- `attempt`
- `scheduled_at`
- `started_at`
- `finished_at`
- `last_error`

## 10.3 リトライ設計
- 一時障害（429/5xx）は指数バックオフで再試行。
- 恒久障害（4xx設定不備）は即失敗 + 運用アラート。

---

## 11. パフォーマンス最適化（非効率コード禁止ルール）

## 11.1 DB最適化
- N+1 を禁止。一覧APIは必ず join/事前ロード。
- `SELECT *` 禁止。必要カラムのみ取得。
- 無制限ページング禁止。`per_page` 上限 100。

## 11.2 API最適化
- 重処理の同期実行禁止。
- 同一トランザクションへの重複同期を排他制御（分散ロック）。
- キャッシュ利用:
  - Geocode結果: 30日
  - カテゴリ候補（同一 merchant+items hash）: 7日

## 11.3 フロント最適化
- 地図ポイントはズームレベルに応じてクラスタリング。
- OCRジョブポーリングはバックグラウンド時に停止。
- 大量表示は仮想スクロールを使用。

## 11.4 コード品質禁止事項
- 例外握りつぶし禁止（必ずログ/エラーコード化）。
- 暗黙型変換依存禁止。
- マジックナンバー禁止（定数化必須）。

---

## 12. セキュリティ・監査

## 12.1 セキュリティ要件
- ファイルアップロード時に MIME・サイズ・ウイルススキャン（将来）
- レシート画像は署名付きURLで限定公開
- OAuthトークンは暗号化保存

## 12.2 監査要件
- 次の操作は audit 必須:
  - 取引作成/更新/削除
  - カテゴリ確定
  - カレンダー同期
- `trace_id` を全リクエストで伝播

---

## 13. テスト要件（実装前に固定）

## 13.1 単体テスト
- `parse_receipt_text`: 正常系/金額誤検出/日付欠落
- `suggest_categories`: top-k順序、スコア範囲
- `build_calendar_event_payload`: フォーマット検証

## 13.2 結合テスト
- upload → OCR → confirm → geocode → map取得 → calendar sync の一連フロー
- 外部API障害時のリトライ・失敗ログ

## 13.3 E2Eテスト
- 実ユーザ操作シナリオを最短 3 本:
  1. OCR成功シナリオ
  2. OCR失敗→手修正シナリオ
  3. カレンダー同期再試行シナリオ

## 13.4 性能テスト
- `GET /transactions` 10k件データで p95 < 300ms
- `GET /map/points` 10k件で p95 < 500ms（bboxあり）

---

## 14. 実装順序（最短で成果を出す効率重視）

1. **DBスキーマ + マイグレーション整備**
2. **Transaction CRUD + Audit基盤**
3. **Upload/OCR非同期パイプライン**
4. **OCRレビューUI**
5. **カテゴリ提案 + 確定フロー**
6. **Geocode + 地図表示**
7. **Calendar同期 + 再同期バッチ**
8. **性能最適化 + 監視導入**

> 理由: データの芯（DB/Audit）を先に固定すると、OCR/地図/カレンダーが同じ契約で進み、手戻りが最小化される。

---

## 15. 受け入れ基準（Definition of Done）

- [ ] 必須APIが OpenAPI で定義済み
- [ ] 主要関数の単体テストがすべて成功
- [ ] E2E 3シナリオ成功
- [ ] 監査ログで変更追跡可能
- [ ] 地図表示とカレンダー同期が同一 transaction_id で辿れる
- [ ] 運用手順（障害対応・再同期手順）が文書化済み

---

## 16. v3 最終定義（結論）

v3 は、
- OCRで取得したレシート原本情報を基点に、
- ユーザー確認でデータ品質を担保し、
- 地図（空間）とカレンダー（時間）へ同一データを投影する

**高再現性・高監査性・高効率の統合家計プラットフォーム**として実装する。

本書に記載の変数、関数、API、状態遷移、禁止事項を遵守することで、
実装者が変わっても同等品質で再現可能な v3 を構築できる。
