"""Flask application for HouseholdAccount.

このモジュールは、画面表示と HTTP API の入口をまとめる。
取引データ本体は `TransactionStore` から取得し、HTML または JSON として返す。
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from pathlib import Path
from typing import Any

from flask import Flask, jsonify, render_template, request

from store import CATEGORY_TREE, TransactionStore

app = Flask(__name__)

DATA_DIR = Path(__file__).resolve().parent / "data"
BALANCE_SNAPSHOT_PATH = DATA_DIR / "balance_sheet_snapshots.json"

store = TransactionStore(
    data_dir=DATA_DIR,
    gas_base_url=os.getenv("GAS_WEBAPP_URL", "").strip(),
    gas_admin_token=os.getenv("GAS_ADMIN_TOKEN", "").strip(),
)


def load_balance_snapshots() -> list[dict[str, Any]]:
    """Load stored balance-sheet snapshots.

    Input:
        none

    Output:
        list[dict[str, Any]]: バランスシート履歴
    """
    if not BALANCE_SNAPSHOT_PATH.exists():
        return []

    try:
        with BALANCE_SNAPSHOT_PATH.open("r", encoding="utf-8") as fp:
            data = json.load(fp)
        return data if isinstance(data, list) else []
    except (OSError, json.JSONDecodeError):
        return []


def save_balance_snapshots(snapshots: list[dict[str, Any]]) -> None:
    """Persist balance-sheet snapshots to local JSON.

    Input:
        snapshots: 保存したい履歴配列

    Output:
        None
    """
    BALANCE_SNAPSHOT_PATH.parent.mkdir(parents=True, exist_ok=True)
    with BALANCE_SNAPSHOT_PATH.open("w", encoding="utf-8") as fp:
        json.dump(snapshots, fp, ensure_ascii=False, indent=2)


def compute_snapshot(payload: dict[str, Any]) -> dict[str, Any]:
    """Convert a balance-sheet form payload into one stored snapshot.

    Input:
        payload: `assets`, `liabilities`, `notes`, `action_plan` を含む JSON

    Output:
        dict[str, Any]: 保存用のスナップショット
    """
    assets = payload.get("assets", {})
    liabilities = payload.get("liabilities", {})

    total_assets = (
        int(assets.get("cash", 0))
        + int(assets.get("investments", 0))
        + int(assets.get("real_estate", 0))
        + int(assets.get("other", 0))
    )
    total_liabilities = (
        int(liabilities.get("mortgage", 0))
        + int(liabilities.get("card_loan", 0))
        + int(liabilities.get("other", 0))
    )

    return {
        "id": datetime.utcnow().strftime("%Y%m%d%H%M%S%f"),
        "created_at": datetime.utcnow().isoformat(timespec="seconds") + "Z",
        "assets": assets,
        "liabilities": liabilities,
        "total_assets": total_assets,
        "total_liabilities": total_liabilities,
        "net_worth": total_assets - total_liabilities,
        "notes": str(payload.get("notes", "")),
        "action_plan": str(payload.get("action_plan", "")),
    }


def calculate_cashflow_baseline(records: list[dict[str, Any]]) -> dict[str, int]:
    """Summarize expense history for the balance-sheet screen.

    Input:
        records: 取引一覧

    Output:
        dict[str, int]: 年間支出、月平均支出、件数
    """
    total_expense = 0
    transaction_count = 0

    for row in records:
        try:
            total_expense += int(row.get("amount_total", 0))
            transaction_count += 1
        except (TypeError, ValueError):
            continue

    monthly_estimate = int(total_expense / 12) if total_expense else 0
    return {
        "annual_expense": total_expense,
        "monthly_expense_estimate": monthly_estimate,
        "transaction_count": transaction_count,
    }


@app.route("/")
def dashboard() -> str:
    """Render the main dashboard HTML.

    Input:
        none

    Output:
        str: レンダリング済み HTML
    """
    transactions = store.list_transactions()
    return render_template(
        "index.html",
        initial_transactions=transactions,
        initial_summary=store.build_summary(transactions),
        initial_monthly=store.build_monthly_analysis(transactions),
        initial_category_breakdown=store.build_category_breakdown(transactions),
        category_tree=CATEGORY_TREE,
        gas_connected=bool(store.gas_base_url),
    )


@app.get("/api/transactions")
def api_list_transactions():
    """Return transactions and dashboard aggregates as JSON.

    Input:
        none

    Output:
        Response: 取引一覧と集計情報
    """
    transactions = store.list_transactions()
    return jsonify(
        {
            "ok": True,
            "transactions": transactions,
            "summary": store.build_summary(transactions),
            "monthly": store.build_monthly_analysis(transactions),
            "category_breakdown": store.build_category_breakdown(transactions),
        }
    )


@app.get("/api/transactions/<transaction_id>")
def api_get_transaction(transaction_id: str):
    """Return one transaction detail as JSON.

    Input:
        transaction_id: 取引 ID

    Output:
        Response: 1件の取引データ
    """
    transaction = store.get_transaction(transaction_id)
    if not transaction:
        return jsonify({"ok": False, "error": "transaction not found"}), 404
    return jsonify({"ok": True, "transaction": transaction})


@app.patch("/api/transactions/<transaction_id>")
def api_update_transaction(transaction_id: str):
    """Update one transaction from the edit form.

    Input:
        transaction_id: 取引 ID
        request.json: 更新項目

    Output:
        Response: 更新結果
    """
    payload = request.get_json(silent=True) or {}
    actor_user = request.headers.get("X-Actor-User", "flask-admin")

    try:
        transaction = store.update_transaction(transaction_id, payload, actor_user)
    except ValueError as error:
        return jsonify({"ok": False, "error": str(error)}), 400

    if not transaction:
        return jsonify({"ok": False, "error": "transaction not found"}), 404

    return jsonify({"ok": True, "transaction": transaction})


@app.get("/api/audit-logs")
def api_audit_logs():
    """Return audit logs.

    Input:
        query parameter `transaction_id` (optional)

    Output:
        Response: 監査ログ一覧
    """
    transaction_id = request.args.get("transaction_id", "").strip()
    logs = store.list_audit_logs(transaction_id=transaction_id or None)
    return jsonify({"ok": True, "audit_logs": logs})


@app.route("/balance-sheet")
def balance_sheet() -> str:
    """Render the balance-sheet HTML.

    Input:
        none

    Output:
        str: レンダリング済み HTML
    """
    records = store.list_transactions()
    baseline = calculate_cashflow_baseline(records)
    snapshots = load_balance_snapshots()
    return render_template("balance_sheet.html", baseline=baseline, snapshots=snapshots)


@app.get("/api/balance-sheet/snapshots")
def get_balance_snapshots():
    """Return saved balance-sheet snapshots.

    Input:
        none

    Output:
        Response: スナップショット一覧
    """
    return jsonify(load_balance_snapshots())


@app.post("/api/balance-sheet/snapshots")
def create_balance_snapshot():
    """Create one balance-sheet snapshot from the form payload.

    Input:
        request.json: `assets`, `liabilities`, `notes`, `action_plan`

    Output:
        Response: 保存結果
    """
    payload = request.get_json(silent=True) or {}
    if "assets" not in payload or "liabilities" not in payload:
        return jsonify({"ok": False, "error": "assets and liabilities are required"}), 400

    try:
        snapshot = compute_snapshot(payload)
    except (TypeError, ValueError, AttributeError):
        return jsonify({"ok": False, "error": "numeric fields must be integers"}), 400

    snapshots = load_balance_snapshots()
    snapshots.append(snapshot)
    save_balance_snapshots(snapshots)
    return jsonify({"ok": True, "snapshot": snapshot})


@app.get("/api/balance-sheet/recommendation")
def balance_recommendation():
    """Return one recommendation derived from the latest balance-sheet snapshot.

    Input:
        none

    Output:
        Response: 改善提案
    """
    snapshots = load_balance_snapshots()
    latest = snapshots[-1] if snapshots else None
    baseline = calculate_cashflow_baseline(store.list_transactions())

    if not latest:
        return jsonify(
            {
                "message": "最初のバランスシートを保存すると改善提案が表示されます。",
                "priority": "start",
            }
        )

    net_worth = int(latest.get("net_worth", 0))
    monthly_expense = int(baseline.get("monthly_expense_estimate", 0))
    cash = (
        int(latest.get("assets", {}).get("cash", 0))
        if isinstance(latest.get("assets"), dict)
        else 0
    )

    if monthly_expense > 0 and cash < monthly_expense * 3:
        message = "生活防衛資金が3か月分未満です。まず現金資産の積み増しを優先しましょう。"
        priority = "high"
    elif net_worth < 0:
        message = "純資産がマイナスです。高金利負債から返済優先度を上げましょう。"
        priority = "high"
    else:
        message = "純資産は安定傾向です。余剰資金の積立投資比率を少しずつ高めるのがおすすめです。"
        priority = "medium"

    return jsonify(
        {"message": message, "priority": priority, "net_worth": net_worth}
    )


if __name__ == "__main__":
    app.run(debug=os.getenv("FLASK_DEBUG", "").lower() in {"1", "true", "yes"})
