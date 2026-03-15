# Function Map

この資料は、各ファイルにどの関数があり、どの関数がどこから呼ばれるかをまとめた一覧です。

## GooleAppsScript

### `webapp.js`

| 関数 | 役割 | 入力 | 出力 | 主な呼び出し先 |
|---|---|---|---|---|
| `doGet` | GET API の入口 | `e.parameter.action` | JSON レスポンス | `listTransactions_`, `getTransactionById_`, `buildSummary_`, `buildMonthlyAnalysis_`, `listAuditLogs_`, `buildMapData_` |
| `doPost` | POST API の入口 | `e.parameter.action`, `e.postData.contents` | JSON または text レスポンス | `handleAdminAction_`, `handleLineWebhook_` |
| `handleLineWebhook_` | LINE Webhook 本体 | Webhook JSON | text レスポンス | `processLineEvent_` |
| `processLineEvent_` | 1件の LINE イベントを処理 | LINE event object | なし | `handleReceiptMessage_`, `handleManualMessage_`, `replyLineMessage_`, `recordProcessedEvent_` |
| `handleAdminAction_` | Flask からの更新要求を処理 | 管理 API JSON | JSON レスポンス | `updateTransactionFromAdmin_`, `syncCalendarEvent_` |
| `updateTransactionFromAdmin_` | 取引更新の本体 | `transaction_id`, `updates` | 更新済み取引 | `updateTransaction_`, `replaceTransactionItems_`, `syncCalendarEvent_`, `appendAuditLog_` |
| `normalizeAdminUpdates_` | 更新内容を台帳スキーマへ正規化 | 既存取引、更新内容 | 正規化済み更新データ | `resolveCategoryPath_` |

### `manual_flow.js`

| 関数 | 役割 | 入力 | 出力 | 主な呼び出し元 |
|---|---|---|---|---|
| `handleManualMessage_` | 手入力フローの分岐 | LINE event object | `createHandlerResult_` の結果 | `processLineEvent_` |
| `startManualTransaction_` | 金額入力から下書き取引を作成 | event, userId, amount | 返信メッセージ | `handleManualMessage_` |
| `handleManualMainCategorySelection_` | 大分類を保存する | event, userStatus | 返信メッセージ | `handleManualMessage_` |
| `handleManualSubCategorySelection_` | 中分類を保存する | event, userStatus | 返信メッセージ | `handleManualMessage_` |
| `handleManualDetailCategorySelection_` | 小分類を保存する | event, userStatus | 返信メッセージ | `handleManualMessage_` |
| `finalizeManualTransaction_` | 位置情報を保存し取引を確定する | event, userStatus | 返信メッセージ | `handleManualMessage_` |
| `resolveManualLocation_` | location メッセージまたは店舗名テキストを位置情報へ変換する | LINE message | `{store_name, address, latitude, longitude}` | `finalizeManualTransaction_` |

### `receipt_flow.js`

| 関数 | 役割 | 入力 | 出力 | 主な呼び出し元 |
|---|---|---|---|---|
| `handleReceiptMessage_` | レシート OCR 登録全体を実行する | LINE image event | 返信メッセージ | `processLineEvent_` |

### `repository.js`

| 関数群 | 役割 |
|---|---|
| `listTransactions_`, `getTransactionById_`, `appendTransaction_`, `updateTransaction_`, `findTransactionRow_` | `transactions` シートの読み書き |
| `listTransactionItems_`, `normalizeTransactionItems_`, `appendTransactionItems_`, `replaceTransactionItems_`, `recalculateTotalFromItems_` | 明細の読み書きと合計計算 |
| `hasProcessedEvent_`, `recordProcessedEvent_` | LINE イベント重複管理 |
| `appendSystemLog_`, `appendAuditLog_`, `listAuditLogs_`, `appendCalendarSyncLog_` | ログ保存 |
| `getUserStatus_`, `upsertUserStatus_`, `clearUserStatus_` | LINE 手入力の途中状態管理 |
| `buildMapData_`, `buildSummary_`, `buildMonthlyAnalysis_` | Flask 用の表示・集計データ生成 |

### `integrations.js`

| 関数 | 役割 |
|---|---|
| `createTextMessage_`, `createSelectionFlexMessage_` | LINE 返信メッセージ作成 |
| `replyLineMessage_`, `downloadLineMessageContent_` | LINE API 呼び出し |
| `saveReceiptBlobToDrive_`, `resizeImageBlob_` | レシート画像の一時保存と加工 |
| `extractReceiptFromImage_`, `normalizeReceiptPayload_` | OCR 結果を取引データへ変換 |
| `geocodeQuery_` | 店舗名や住所から緯度経度を取得 |
| `buildCalendarDescription_`, `syncCalendarEvent_` | Google カレンダー登録・更新 |
| `formatManualConfirmationText_`, `formatReceiptConfirmationText_` | LINE 返信文作成 |

### `config.js`

| 関数群 | 役割 |
|---|---|
| `ensureV3Sheets_`, `getOrCreateSheet_`, `readSheetRows_`, `buildRowFromObject_` | シート初期化と共通読み書き |
| `getSetting_`, `getSettingsMap_`, `getLegacySettingMap_` | 設定値取得 |
| `parseJsonSafely_`, `createJsonResponse_`, `createTextResponse_` | JSON と HTTP レスポンスの共通処理 |
| `createId_`, `toIsoString_`, `trimString_`, `toNumberOrZero_`, `normalizeDateString_`, `normalizeTimeString_` | 値変換ユーティリティ |
| `createHandlerResult_`, `getEventId_` | フロー間で共通利用する結果形式とイベント識別子生成 |

### `category_master.js`

| 関数 | 役割 |
|---|---|
| `getMainCategories_`, `getSubCategories_`, `getDetailCategories_` | カテゴリ選択肢の取得 |
| `resolveCategoryPath_` | OCR や更新内容からカテゴリ 3 階層を決定 |

## Flask

### `app.py`

| 関数 | 役割 | 入力 | 出力 |
|---|---|---|---|
| `dashboard` | メイン画面表示 | なし | HTML |
| `api_list_transactions` | 一覧 API | なし | 取引一覧 JSON |
| `api_get_transaction` | 詳細 API | `transaction_id` | 1件 JSON |
| `api_update_transaction` | 更新 API | `transaction_id`, JSON body | 更新済み取引 JSON |
| `api_audit_logs` | 監査ログ API | `transaction_id` | 監査ログ JSON |
| `balance_sheet` | バランスシート画面 | なし | HTML |
| `get_balance_snapshots` | バランスシート一覧 API | なし | JSON |
| `create_balance_snapshot` | バランスシート保存 API | JSON body | 保存結果 JSON |
| `balance_recommendation` | 改善提案 API | なし | 提案 JSON |

### `store.py`

| メソッド | 役割 |
|---|---|
| `list_transactions`, `get_transaction`, `update_transaction`, `list_audit_logs` | Flask から使う主要データ操作 |
| `build_summary`, `build_monthly_analysis`, `build_category_breakdown` | ダッシュボード集計 |
| `_remote_get`, `_remote_post` | Apps Script API 呼び出し |
| `_apply_updates`, `_normalize_transaction`, `_normalize_items` | 更新内容の正規化 |
| `_append_local_audit_log`, `_read_json`, `_write_json` | ローカルモード用保存 |

