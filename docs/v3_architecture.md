# HouseholdAccount v3 統合アーキテクチャ

## 1. この資料の目的

この資料は、現在の HouseholdAccount を実装・運用するときに、

- どこに何のコードを書くか
- どのシステムがどの責務を持つか
- 修正や再同期をどう扱うか

を迷いにくくするための実装ガイドです。

---

## 2. v3 の基本方針

### 方針1: 入力方法が違っても保存先は同じ

- 手入力でも
- レシート OCR でも
- 後からの手修正でも

最後は同じ `transactions` / `transaction_items` に正規化します。

### 方針2: 失敗しても取引データは残す

- ジオコーディング失敗
- カレンダー同期失敗
- OCR の一部欠落

が起きても、取引そのものは保存し、`status` とログで追跡します。

### 方針3: 修正できることを前提に設計する

OCR や住所解決は完全ではないため、Flask 画面から修正できる前提で作ります。

---

## 3. コンポーネント構成

| コンポーネント | 役割 |
|---|---|
| LINE | ユーザー入力チャネル |
| GooleAppsScript | Webhook 受信、OCR、保存、カレンダー同期、管理 API |
| Google Spreadsheet | 台帳、明細、ログ |
| Google Calendar | 支出イベントの時系列記録 |
| Flask | 一覧、地図、編集、分析、監査ログ表示 |

---

## 4. 代表フロー

### 4.1 手入力フロー

1. LINE で金額を送る
2. GooleAppsScript が `draft` 取引を作る
3. LINE でカテゴリを段階選択する
4. 位置情報または店舗名を送る
5. GooleAppsScript が地理情報を補完して `confirmed` に更新する
6. Google カレンダーへ登録する
7. Flask で一覧・地図・分析に表示する

### 4.2 レシート OCR フロー

1. LINE でレシート画像を送る
2. GooleAppsScript が画像を受け取り Drive に保存する
3. OCR 解析結果を JSON に正規化する
4. 取引と明細をスプレッドシートへ保存する
5. Google カレンダーへ登録する
6. Flask に表示する

### 4.3 修正フロー

1. Flask で対象取引を選ぶ
2. 日付、店舗名、金額、カテゴリ、明細などを編集する
3. Flask が GooleAppsScript の管理 API を呼ぶ
4. GooleAppsScript がスプレッドシートを更新する
5. 監査ログを保存する
6. 必要なら Google カレンダーも更新する

---

## 5. データ構造

## 5.1 transactions

1取引1行の基幹台帳です。

主なカラム:

- `transaction_id`
- `event_id`
- `user_id`
- `input_channel`
- `status`
- `date`
- `time`
- `amount_total`
- `store_name`
- `store_address`
- `lat`
- `lon`
- `category_main`
- `category_sub`
- `category_detail`
- `payment_method`
- `source_message`
- `calendar_event_id`
- `created_at`
- `updated_at`

## 5.2 transaction_items

レシート明細を持つシートです。  
Flask の編集画面では、ここも更新対象です。

## 5.3 audit_logs

誰が、何を、どう変えたかを保存します。  
公開運用では特に重要です。

## 5.4 processed_events

LINE Webhook の重複受信を安全に無視するためのシートです。

---

## 6. GooleAppsScript の責務分担

| ファイル | 役割 |
|---|---|
| `webapp.js` | `doGet` / `doPost` の入口 |
| `manual_flow.js` | 手入力状態遷移 |
| `receipt_flow.js` | レシート OCR 登録 |
| `repository.js` | シートの CRUD |
| `integrations.js` | LINE、OCR、Geocode、Calendar |
| `category_master.js` | カテゴリ定義 |
| `config.js` | 設定値、ヘッダー、共通関数 |

---

## 7. Flask の責務分担

| 役割 | 内容 |
|---|---|
| 一覧表示 | 条件検索、ステータス確認 |
| 地図表示 | 緯度経度を持つ支出の可視化 |
| 編集 | 日付、金額、カテゴリ、店舗、明細を修正 |
| 監査ログ | 修正履歴を閲覧 |
| 分析 | 月別、カテゴリ別、補正対象の確認 |

Flask は、GooleAppsScript を直接置き換えるものではなく、運用のための「見える管理画面」です。

---

## 8. 管理 API の考え方

GooleAppsScript は LINE Webhook と同じ Web アプリ URL の中で、`action` パラメータに応じて管理 API も扱います。

### `GET` 系

| action | 役割 |
|---|---|
| `mapData` | 地図表示用 JSON |
| `listTransactions` | 一覧表示用 JSON |
| `getTransaction` | 1件詳細 |
| `summary` | 集計サマリー |
| `auditLogs` | 監査ログ |

### `POST` 系

| action | 役割 |
|---|---|
| `updateTransaction` | 取引更新 |
| `resyncCalendar` | カレンダー再同期 |

認証は `admin_token` を前提にしています。  
本番公開では、将来的により強い認証方式へ切り替える前提です。

---

## 9. なぜ Flask から直接スプレッドシートを書かないのか

今回の設計では、「更新の正規ルート」を GooleAppsScript に寄せています。

理由:

- スプレッドシート構造の知識を GAS 側に集約できる
- Google カレンダー同期を同じ責務で扱える
- 修正後の副作用処理を一箇所にまとめられる
- 将来バックエンドを差し替えるときの境界が明確になる

---

## 10. 将来的な拡張余地

### 短期

- OCR 信頼度の保存
- failed 取引の再処理 UI
- カテゴリ候補の自動提案

### 中期

- Google Calendar の削除・再作成フロー
- 予算管理
- 家計改善コメントの自動生成

### 長期

- DB 化
- 認証の強化
- 非同期ジョブ化

---

## 11. 実装判断の目安

迷ったときは、次の順で判断します。

1. データが壊れないか
2. 後から人が直せるか
3. 同期失敗時に追跡できるか
4. 一般利用者にとって分かりやすいか

この 4 つを満たせるなら、v3 の方向性として良い実装です。
