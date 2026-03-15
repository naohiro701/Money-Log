# Flask

`Flask/` は、HouseholdAccount の管理画面です。  
役割は「保存されたデータを、人が見て、直して、活用すること」です。

---

## このフォルダでできること

- 取引一覧の表示
- 地図上での支出確認
- 取引内容の編集
- 監査ログの表示
- 月次の簡易分析
- 家庭バランスシートの保存と表示

---

## 画面構成

### `/`

メインの管理ダッシュボードです。

- 取引一覧
- 地図ビュー
- フィルタ
- 編集フォーム
- 監査ログ
- 月別支出
- 要確認データ

### `/balance-sheet`

家庭バランスシート画面です。

- 現金、投資、不動産などの資産入力
- ローンなどの負債入力
- 純資産の自動計算
- 次月アクションプラン保存

---

## 動作モード

### 1. ローカルモード

`GAS_WEBAPP_URL` を設定しない場合、`data/transactions.json` と `data/audit_logs.json` を使って動きます。  
画面や編集フローの確認だけ先に進めたいときに向いています。

### 2. 連携モード

`GAS_WEBAPP_URL` と `GAS_ADMIN_TOKEN` を設定した場合、Flask から GooleAppsScript の Web アプリを呼び出し、実データを読み書きします。

---

## 起動方法

```bash
cd Flask
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

---

## 環境変数

| 環境変数 | 用途 |
|---|---|
| `GAS_WEBAPP_URL` | GooleAppsScript の Web アプリ URL |
| `GAS_ADMIN_TOKEN` | GooleAppsScript 管理 API 用トークン |
| `FLASK_DEBUG` | デバッグ起動切り替え |

---

## 主要ファイル

| パス | 役割 |
|---|---|
| `app.py` | Flask ルーティングと画面/API 定義 |
| `store.py` | GAS とローカル JSON の切り替え、保存処理 |
| `templates/index.html` | メインの管理ダッシュボード |
| `templates/balance_sheet.html` | 家庭バランスシート画面 |
| `data/transactions.json` | ローカルデモ用の取引データ |
| `data/audit_logs.json` | ローカル監査ログ |
| `data/balance_sheet_snapshots.json` | バランスシート保存先 |

---

## 編集の流れ

1. 一覧から取引を選ぶ
2. 右側の編集フォームで内容を直す
3. 保存ボタンを押す
4. Flask が GooleAppsScript の管理 API を呼ぶ
5. スプレッドシートと監査ログが更新される

ローカルモードでは、同じ流れを `data/*.json` に対して行います。

---

## 補足

- `requirements.txt` は最小限にしてあります
- 地図はブラウザ上で表示されます
- 本番運用前には認証と権限設定を必ず見直してください

