# Flask

`Flask/` は、WEBアプリとして画面表示と編集を担当するアプリケーションです。

## 画面

- `/`: 取引一覧、地図、編集、監査ログ、集計
- `/balance-sheet`: 家庭バランスシート

## 起動方法

```bash
cd Flask
python3 -m venv .venv
source .venv/bin/activate
pip install -r requirements.txt
python3 app.py
```

## 環境変数

| 環境変数 | 用途 |
|---|---|
| `GAS_WEBAPP_URL` | Apps Script の Web アプリ URL |
| `GAS_ADMIN_TOKEN` | Apps Script 管理 API 用トークン |
| `FLASK_DEBUG` | デバッグ起動切り替え |

## 動作モード

- 連携モード: `GAS_WEBAPP_URL` を設定し、Apps Script と連携して動作する
- ローカルモード: `Flask/data/*.json` を使用して画面確認を行う

## 主要ファイル

| ファイル | 内容 |
|---|---|
| `app.py` | ルーティングと API |
| `store.py` | データ取得、更新、ローカル保存 |
| `templates/index.html` | メイン画面 |
| `templates/balance_sheet.html` | バランスシート画面 |
| `data/transactions.json` | ローカル取引データ |
| `data/audit_logs.json` | ローカル監査ログ |
| `data/balance_sheet_snapshots.json` | バランスシート履歴 |

