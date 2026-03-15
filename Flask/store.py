"""Data access layer for HouseholdAccount.

`TransactionStore` は、Flask から見た取引データの入口を 1 つにまとめる。
Apps Script と連携する場合も、ローカル JSON で動かす場合も、画面側は同じメソッドを使う。
"""

from __future__ import annotations

import json
from copy import deepcopy
from datetime import datetime
from pathlib import Path
from typing import Any
from urllib.error import HTTPError, URLError
from urllib.parse import urlencode
from urllib.request import Request, urlopen

CATEGORY_TREE: dict[str, dict[str, list[str]]] = {
    "生活費(食住)": {
        "食費": ["食料品", "外食", "朝ご飯", "昼ご飯", "夜ご飯"],
        "日用品": ["日用品", "子育て用品", "ドラッグストア"],
        "住宅": ["住宅家賃・地代", "ローン返済", "管理費・積立金"],
        "水道・光熱費": ["光熱費", "電気代", "ガス・灯油代", "水道代"],
        "通信費": ["携帯電話", "固定電話", "インターネット"],
        "その他出費": ["仕送り", "事業経費", "事業原価"],
    },
    "もの支出(娯楽・自己投資)": {
        "交際費": ["お土産", "飲み会", "プレゼント", "冠婚葬祭", "その他"],
        "教養・教育": ["新聞・雑誌", "習いごと", "学費"],
        "衣服": ["衣服", "クリーニング"],
    },
    "こと支出(移動等)": {
        "身体関連": ["フィットネス", "医療費", "ボデイケア", "美容院・理髪"],
        "趣味・娯楽": ["アウトドア", "ゴルフ", "スポーツ", "映画・音楽・ゲーム"],
        "移動費": ["ホテル", "電車", "バス", "タクシー", "飛行機"],
        "特別な支出": ["家具・家電", "住宅・リフォーム"],
    },
    "保留": {"未分類": ["未分類"]},
}


class TransactionStore:
    """Transaction storage gateway.

    Input:
        data_dir: ローカル JSON を置くディレクトリ
        gas_base_url: Apps Script Web アプリ URL
        gas_admin_token: Apps Script 管理 API トークン

    Output:
        Flask から使うデータ取得・更新メソッド群
    """

    def __init__(
        self,
        data_dir: Path,
        gas_base_url: str = "",
        gas_admin_token: str = "",
    ) -> None:
        self.data_dir = data_dir
        self.data_dir.mkdir(parents=True, exist_ok=True)
        self.transactions_path = data_dir / "transactions.json"
        self.audit_logs_path = data_dir / "audit_logs.json"
        self.gas_base_url = gas_base_url
        self.gas_admin_token = gas_admin_token

    def list_transactions(self) -> list[dict[str, Any]]:
        """Load all transactions.

        Input:
            none

        Output:
            list[dict[str, Any]]: 正規化済み取引一覧

        Notes:
            Apps Script が設定されていればリモートから取得し、
            未設定ならローカル JSON を読む。
        """
        remote = self._remote_get("listTransactions")
        if remote is not None:
            payload = remote.get("transactions", remote)
            if isinstance(payload, list):
                return self._sorted_transactions(
                    [self._normalize_transaction(row) for row in payload]
                )

        local = self._read_json(self.transactions_path, [])
        if not isinstance(local, list):
            return []
        return self._sorted_transactions(
            [self._normalize_transaction(row) for row in local]
        )

    def get_transaction(self, transaction_id: str) -> dict[str, Any] | None:
        """Load one transaction by id.

        Input:
            transaction_id: 取引 ID

        Output:
            dict[str, Any] | None: 1件の取引。無ければ `None`
        """
        remote = self._remote_get("getTransaction", {"transaction_id": transaction_id})
        if remote is not None:
            payload = remote.get("transaction")
            return self._normalize_transaction(payload) if isinstance(payload, dict) else None

        transactions = self.list_transactions()
        return next(
            (row for row in transactions if row["transaction_id"] == transaction_id), None
        )

    def update_transaction(
        self, transaction_id: str, updates: dict[str, Any], actor_user: str
    ) -> dict[str, Any] | None:
        """Update one transaction.

        Input:
            transaction_id: 更新対象の取引 ID
            updates: 更新項目
            actor_user: 更新実行者

        Output:
            dict[str, Any] | None: 更新後の取引。見つからない場合は `None`
        """
        if not transaction_id:
            raise ValueError("transaction_id is required")

        remote = self._remote_post(
            "updateTransaction",
            {
                "admin_token": self.gas_admin_token,
                "transaction_id": transaction_id,
                "updates": updates,
                "actor_user_id": actor_user,
            },
        )
        if remote is not None:
            if remote.get("ok") is False:
                raise ValueError(str(remote.get("error", "GAS update failed")))
            payload = remote.get("transaction")
            return self._normalize_transaction(payload) if isinstance(payload, dict) else None

        transactions = self._read_json(self.transactions_path, [])
        if not isinstance(transactions, list):
            transactions = []

        target_index = next(
            (
                index
                for index, row in enumerate(transactions)
                if row.get("transaction_id") == transaction_id
            ),
            None,
        )
        if target_index is None:
            return None

        before = self._normalize_transaction(transactions[target_index])
        after = self._apply_updates(before, updates)
        transactions[target_index] = after
        self._write_json(self.transactions_path, self._sorted_transactions(transactions))
        self._append_local_audit_log(transaction_id, before, after, actor_user)
        return after

    def list_audit_logs(self, transaction_id: str | None = None) -> list[dict[str, Any]]:
        """Load audit logs.

        Input:
            transaction_id: 取引 ID。指定時はその取引だけを返す

        Output:
            list[dict[str, Any]]: 監査ログ一覧
        """
        remote = self._remote_get(
            "auditLogs", {"transaction_id": transaction_id or ""}
        )
        if remote is not None:
            payload = remote.get("audit_logs", [])
            if isinstance(payload, list):
                return self._sorted_audit_logs(payload)

        logs = self._read_json(self.audit_logs_path, [])
        if not isinstance(logs, list):
            return []
        if transaction_id:
            logs = [
                row
                for row in logs
                if row.get("transaction_id", "") == transaction_id
            ]
        return self._sorted_audit_logs(logs)

    def build_summary(self, transactions: list[dict[str, Any]]) -> dict[str, Any]:
        """Build dashboard KPI values.

        Input:
            transactions: 取引一覧

        Output:
            dict[str, Any]: 件数、総額、座標付き件数、未解決件数など
        """
        total_amount = sum(int(row.get("amount_total", 0)) for row in transactions)
        geocoded_count = sum(
            1
            for row in transactions
            if row.get("lat") not in {"", "unknown", None}
            and row.get("lon") not in {"", "unknown", None}
        )
        draft_count = sum(1 for row in transactions if row.get("status") == "draft")
        failed_count = sum(1 for row in transactions if row.get("status") == "failed")
        confirmed_count = sum(
            1 for row in transactions if row.get("status") == "confirmed"
        )
        unresolved_count = sum(
            1
            for row in transactions
            if row.get("store_address") in {"", "unknown", None}
            or row.get("category_main") in {"", "保留", None}
        )

        return {
            "transaction_count": len(transactions),
            "total_amount": total_amount,
            "geocoded_count": geocoded_count,
            "draft_count": draft_count,
            "failed_count": failed_count,
            "confirmed_count": confirmed_count,
            "unresolved_count": unresolved_count,
        }

    def build_monthly_analysis(
        self, transactions: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Aggregate transactions by month.

        Input:
            transactions: 取引一覧

        Output:
            list[dict[str, Any]]: 月別集計
        """
        buckets: dict[str, dict[str, Any]] = {}
        for row in transactions:
            month = (row.get("date", "") or "unknown")[:7]
            bucket = buckets.setdefault(
                month, {"month": month, "total_amount": 0, "transaction_count": 0}
            )
            bucket["total_amount"] += int(row.get("amount_total", 0))
            bucket["transaction_count"] += 1

        return [buckets[key] for key in sorted(buckets.keys())]

    def build_category_breakdown(
        self, transactions: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Aggregate transactions by main category.

        Input:
            transactions: 取引一覧

        Output:
            list[dict[str, Any]]: 大分類別集計
        """
        buckets: dict[str, dict[str, Any]] = {}
        for row in transactions:
            key = row.get("category_main") or "未設定"
            bucket = buckets.setdefault(
                key, {"category_main": key, "total_amount": 0, "transaction_count": 0}
            )
            bucket["total_amount"] += int(row.get("amount_total", 0))
            bucket["transaction_count"] += 1

        return sorted(
            buckets.values(),
            key=lambda row: (-int(row["total_amount"]), row["category_main"]),
        )

    def _remote_get(
        self, action: str, params: dict[str, Any] | None = None
    ) -> dict[str, Any] | None:
        """Call the Apps Script GET API.

        Input:
            action: API 名
            params: クエリパラメータ

        Output:
            dict[str, Any] | None: JSON 応答。失敗時は `None`
        """
        if not self.gas_base_url:
            return None

        query = {"action": action}
        if params:
            query.update({key: value for key, value in params.items() if value is not None})

        url = f"{self.gas_base_url}?{urlencode(query)}"
        try:
            with urlopen(url, timeout=10) as response:
                payload = json.loads(response.read().decode("utf-8"))
            return payload if isinstance(payload, dict) else {"transactions": payload}
        except (URLError, HTTPError, TimeoutError, json.JSONDecodeError):
            return None

    def _remote_post(self, action: str, payload: dict[str, Any]) -> dict[str, Any] | None:
        """Call the Apps Script POST API.

        Input:
            action: API 名
            payload: 送信 JSON

        Output:
            dict[str, Any] | None: JSON 応答。失敗時は `None`
        """
        if not self.gas_base_url or not self.gas_admin_token:
            return None

        url = f"{self.gas_base_url}?{urlencode({'action': action})}"
        body = json.dumps(payload).encode("utf-8")
        request = Request(
            url,
            data=body,
            headers={"Content-Type": "application/json"},
            method="POST",
        )

        try:
            with urlopen(request, timeout=10) as response:
                data = json.loads(response.read().decode("utf-8"))
            return data if isinstance(data, dict) else None
        except (URLError, HTTPError, TimeoutError, json.JSONDecodeError):
            return None

    def _apply_updates(
        self, transaction: dict[str, Any], updates: dict[str, Any]
    ) -> dict[str, Any]:
        """Apply update payload to one normalized transaction.

        Input:
            transaction: 更新前の取引
            updates: 更新内容

        Output:
            dict[str, Any]: 更新後の取引
        """
        updated = deepcopy(transaction)
        allowed_fields = {
            "date",
            "time",
            "amount_total",
            "store_name",
            "store_address",
            "lat",
            "lon",
            "category_main",
            "category_sub",
            "category_detail",
            "payment_method",
            "status",
            "source_message",
        }

        for key, value in updates.items():
            if key not in allowed_fields and key != "items":
                continue
            if key == "amount_total":
                updated[key] = int(value or 0)
            elif key == "items":
                continue
            else:
                updated[key] = value

        if "items" in updates and isinstance(updates["items"], list):
            updated["items"] = self._normalize_items(updates["items"])
            if "amount_total" not in updates:
                updated["amount_total"] = sum(
                    int(item["line_amount"]) for item in updated["items"]
                )

        updated["updated_at"] = datetime.utcnow().isoformat(timespec="seconds") + "Z"
        return self._normalize_transaction(updated)

    def _normalize_transaction(self, row: dict[str, Any] | None) -> dict[str, Any]:
        """Normalize one transaction into the shape used by Flask.

        Input:
            row: Apps Script API またはローカル JSON の 1 レコード

        Output:
            dict[str, Any]: 正規化済み取引
        """
        if not isinstance(row, dict):
            return {}

        normalized = {
            "transaction_id": str(row.get("transaction_id", "")),
            "event_id": str(row.get("event_id", "")),
            "user_id": str(row.get("user_id", "")),
            "input_channel": str(row.get("input_channel", "manual")),
            "status": str(row.get("status", "draft")),
            "date": str(row.get("date", "")),
            "time": str(row.get("time", "12:00:00")),
            "amount_total": self._to_int(row.get("amount_total", 0)),
            "store_name": str(row.get("store_name", "")),
            "store_address": str(row.get("store_address", "")),
            "lat": row.get("lat", ""),
            "lon": row.get("lon", ""),
            "category_main": str(row.get("category_main", "保留")),
            "category_sub": str(row.get("category_sub", "未分類")),
            "category_detail": str(row.get("category_detail", "未分類")),
            "payment_method": str(row.get("payment_method", "")),
            "source_message": str(row.get("source_message", "")),
            "calendar_event_id": str(row.get("calendar_event_id", "")),
            "created_at": str(
                row.get("created_at", datetime.utcnow().isoformat(timespec="seconds") + "Z")
            ),
            "updated_at": str(
                row.get("updated_at", datetime.utcnow().isoformat(timespec="seconds") + "Z")
            ),
            "items": self._normalize_items(row.get("items", [])),
        }
        return normalized

    def _normalize_items(self, items: Any) -> list[dict[str, Any]]:
        """Normalize line items into the shape used by Flask.

        Input:
            items: 明細配列

        Output:
            list[dict[str, Any]]: 正規化済み明細
        """
        if not isinstance(items, list):
            return []

        normalized: list[dict[str, Any]] = []
        for index, item in enumerate(items):
            if not isinstance(item, dict):
                continue
            quantity = self._to_float(item.get("quantity", 1), default=1.0)
            unit_price = self._to_int(item.get("unit_price", item.get("price", 0)))
            normalized.append(
                {
                    "item_id": str(item.get("item_id", f"item_{index + 1}")),
                    "name": str(item.get("name", f"item_{index + 1}")),
                    "quantity": quantity,
                    "unit_price": unit_price,
                    "line_amount": self._to_int(item.get("line_amount", quantity * unit_price)),
                }
            )
        return normalized

    def _append_local_audit_log(
        self,
        transaction_id: str,
        before: dict[str, Any],
        after: dict[str, Any],
        actor_user: str,
    ) -> None:
        """Append one audit log entry in local mode.

        Input:
            transaction_id: 取引 ID
            before: 更新前データ
            after: 更新後データ
            actor_user: 更新実行者

        Output:
            None
        """
        logs = self._read_json(self.audit_logs_path, [])
        if not isinstance(logs, list):
            logs = []

        logs.append(
            {
                "audit_id": f"audit_{datetime.utcnow().strftime('%Y%m%d%H%M%S%f')}",
                "timestamp": datetime.utcnow().isoformat(timespec="seconds") + "Z",
                "transaction_id": transaction_id,
                "action": "update_from_flask",
                "before_json": before,
                "after_json": after,
                "actor_user_id": actor_user,
            }
        )
        self._write_json(self.audit_logs_path, self._sorted_audit_logs(logs))

    def _sorted_transactions(
        self, transactions: list[dict[str, Any]]
    ) -> list[dict[str, Any]]:
        """Sort transactions from newest to oldest.

        Input:
            transactions: 取引一覧

        Output:
            list[dict[str, Any]]: ソート済み取引一覧
        """
        return sorted(
            [self._normalize_transaction(row) for row in transactions],
            key=lambda row: (row.get("date", ""), row.get("time", ""), row.get("updated_at", "")),
            reverse=True,
        )

    def _sorted_audit_logs(self, logs: list[dict[str, Any]]) -> list[dict[str, Any]]:
        """Sort audit logs from newest to oldest.

        Input:
            logs: 監査ログ一覧

        Output:
            list[dict[str, Any]]: ソート済み監査ログ一覧
        """
        return sorted(
            logs,
            key=lambda row: str(row.get("timestamp", "")),
            reverse=True,
        )

    def _read_json(self, path: Path, fallback: Any) -> Any:
        """Read JSON file safely.

        Input:
            path: 読み込む JSON ファイル
            fallback: 失敗時に返す値

        Output:
            Any: 読み込み結果
        """
        if not path.exists():
            return fallback
        try:
            with path.open("r", encoding="utf-8") as fp:
                return json.load(fp)
        except (OSError, json.JSONDecodeError):
            return fallback

    def _write_json(self, path: Path, data: Any) -> None:
        """Write JSON file.

        Input:
            path: 保存先ファイル
            data: 書き込むデータ

        Output:
            None
        """
        path.parent.mkdir(parents=True, exist_ok=True)
        with path.open("w", encoding="utf-8") as fp:
            json.dump(data, fp, ensure_ascii=False, indent=2)

    def _to_int(self, value: Any, default: int = 0) -> int:
        """Convert a value to int without raising.

        Input:
            value: 変換したい値
            default: 失敗時の戻り値

        Output:
            int
        """
        try:
            return int(float(value))
        except (TypeError, ValueError):
            return default

    def _to_float(self, value: Any, default: float = 0.0) -> float:
        """Convert a value to float without raising.

        Input:
            value: 変換したい値
            default: 失敗時の戻り値

        Output:
            float
        """
        try:
            return float(value)
        except (TypeError, ValueError):
            return default
