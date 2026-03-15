/**
 * 台帳本体 `transactions` を一覧で取得する。
 * Flask の一覧画面で使いやすいように、各取引へ明細配列 `items` を付与して返す。
 *
 * Input: なし
 * Output:
 * - 取引オブジェクト配列
 */
function listTransactions_() {
  return readSheetRows_("transactions").map(function (transaction) {
    var record = cloneWithoutMeta_(transaction);
    record.items = listTransactionItems_(record.transaction_id);
    return record;
  });
}

/**
 * 指定した取引 ID の 1 件詳細を返す。
 *
 * Input:
 * - `transactionId`: 取引 ID
 *
 * Output:
 * - 取引オブジェクト
 * - 見つからない場合は `null`
 */
function getTransactionById_(transactionId) {
  var transaction = findTransactionRow_(transactionId);
  if (!transaction) return null;

  var record = cloneWithoutMeta_(transaction);
  record.items = listTransactionItems_(transactionId);
  return record;
}

/**
 * 新規取引を `transactions` シートへ 1 行追加する。
 *
 * Input:
 * - `transaction`: 保存対象の取引オブジェクト
 *
 * Output:
 * - 追加した取引オブジェクト
 */
function appendTransaction_(transaction) {
  var sheet = getOrCreateSheet_("transactions", V3_SHEET_HEADERS.transactions);
  sheet.appendRow(buildRowFromObject_(V3_SHEET_HEADERS.transactions, transaction));
  return transaction;
}

/**
 * 既存取引を更新する。
 * 渡された差分を既存データへマージし、`updated_at` を更新して保存する。
 *
 * Input:
 * - `transactionId`: 更新対象の取引 ID
 * - `updates`: 差分オブジェクト
 *
 * Output:
 * - 更新後の取引オブジェクト
 */
function updateTransaction_(transactionId, updates) {
  var sheet = getOrCreateSheet_("transactions", V3_SHEET_HEADERS.transactions);
  var existing = findTransactionRow_(transactionId);
  if (!existing) throw new Error("Transaction not found: " + transactionId);

  var merged = cloneWithoutMeta_(existing);
  Object.keys(updates || {}).forEach(function (key) {
    merged[key] = updates[key];
  });
  merged.updated_at = toIsoString_(new Date());

  var values = buildRowFromObject_(V3_SHEET_HEADERS.transactions, merged);
  sheet.getRange(existing.__rowNumber, 1, 1, values.length).setValues([values]);
  return getTransactionById_(transactionId);
}

/**
 * シート上で取引 ID に対応する行を探す。
 * 更新処理の行番号特定に使う内部関数。
 *
 * Input:
 * - `transactionId`: 取引 ID
 *
 * Output:
 * - 行オブジェクト
 * - 見つからない場合は `null`
 */
function findTransactionRow_(transactionId) {
  var rows = readSheetRows_("transactions");
  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].transaction_id) === trimString_(transactionId)) {
      return rows[i];
    }
  }
  return null;
}

/**
 * イベント ID から取引を検索する。
 * 将来の再受信チェックや移行処理で使えるように用意している。
 *
 * Input:
 * - `eventId`: LINE イベント ID
 *
 * Output:
 * - 取引オブジェクト
 * - 見つからない場合は `null`
 */
function findTransactionByEventId_(eventId) {
  var rows = readSheetRows_("transactions");
  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].event_id) === trimString_(eventId)) {
      return cloneWithoutMeta_(rows[i]);
    }
  }
  return null;
}

/**
 * 指定取引に紐づく明細一覧を取得する。
 *
 * Input:
 * - `transactionId`: 取引 ID
 *
 * Output:
 * - 明細配列
 */
function listTransactionItems_(transactionId) {
  return readSheetRows_("transaction_items")
    .filter(function (item) {
      return trimString_(item.transaction_id) === trimString_(transactionId);
    })
    .map(function (item) {
      return cloneWithoutMeta_(item);
    });
}

/**
 * 明細配列を保存用の形式へ変換する。
 * 数量と単価から `line_amount` を再計算し、明細 ID が無いものには新しい ID を付ける。
 *
 * Input:
 * - `transactionId`: 親取引 ID
 * - `items`: 明細配列
 *
 * Output:
 * - 正規化済み明細配列
 */
function normalizeTransactionItems_(transactionId, items) {
  return (items || []).map(function (item, index) {
    var quantity = Number(item.quantity || 1);
    if (isNaN(quantity) || quantity <= 0) quantity = 1;

    var unitPrice = Number(item.unit_price || item.price || 0);
    if (isNaN(unitPrice) || unitPrice < 0) unitPrice = 0;

    return {
      item_id: trimString_(item.item_id) || createId_("item"),
      transaction_id: transactionId,
      name: trimString_(item.name) || ("item_" + (index + 1)),
      quantity: quantity,
      unit_price: unitPrice,
      line_amount: quantity * unitPrice
    };
  });
}

/**
 * 明細配列を `transaction_items` シートへ追記する。
 *
 * Input:
 * - `transactionId`: 親取引 ID
 * - `items`: 明細配列
 *
 * Output:
 * - 保存した明細配列
 */
function appendTransactionItems_(transactionId, items) {
  var sheet = getOrCreateSheet_("transaction_items", V3_SHEET_HEADERS.transaction_items);
  var normalizedItems = normalizeTransactionItems_(transactionId, items);
  if (!normalizedItems.length) return [];

  var values = normalizedItems.map(function (item) {
    return buildRowFromObject_(V3_SHEET_HEADERS.transaction_items, item);
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, values[0].length).setValues(values);
  return normalizedItems;
}

/**
 * 指定取引の既存明細をすべて削除し、新しい明細で置き換える。
 * Flask の編集画面から明細を丸ごと更新するときに使う。
 *
 * Input:
 * - `transactionId`: 親取引 ID
 * - `items`: 新しい明細配列
 *
 * Output:
 * - 保存した明細配列
 */
function replaceTransactionItems_(transactionId, items) {
  var sheet = getOrCreateSheet_("transaction_items", V3_SHEET_HEADERS.transaction_items);
  var rows = readSheetRows_("transaction_items");
  for (var i = rows.length - 1; i >= 0; i--) {
    if (trimString_(rows[i].transaction_id) === trimString_(transactionId)) {
      sheet.deleteRow(rows[i].__rowNumber);
    }
  }
  return appendTransactionItems_(transactionId, items);
}

/**
 * 明細一覧から取引合計を再計算する。
 * レシート編集時に `amount_total` が未指定なら、この計算結果を使う。
 *
 * Input:
 * - `items`: 明細配列
 *
 * Output:
 * - 合計金額
 */
function recalculateTotalFromItems_(items) {
  return (items || []).reduce(function (sum, item) {
    return sum + toNumberOrZero_(item.line_amount || (item.quantity || 1) * (item.unit_price || 0));
  }, 0);
}

/**
 * 同じ LINE イベントがすでに処理済みか判定する。
 *
 * Input:
 * - `eventId`: LINE イベント ID
 *
 * Output:
 * - `boolean`
 */
function hasProcessedEvent_(eventId) {
  var rows = readSheetRows_("processed_events");
  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].event_id) === trimString_(eventId)) return true;
  }
  return false;
}

/**
 * 処理済みイベントを `processed_events` シートへ記録する。
 * LINE の再送による重複登録を防ぐための台帳。
 *
 * Input:
 * - `eventId`: LINE イベント ID
 * - `transactionId`: 作成または更新した取引 ID
 * - `channel`: `manual` / `receipt_image` など
 *
 * Output:
 * - なし
 */
function recordProcessedEvent_(eventId, transactionId, channel) {
  var sheet = getOrCreateSheet_("processed_events", V3_SHEET_HEADERS.processed_events);
  sheet.appendRow([
    eventId,
    transactionId || "",
    channel || "",
    toIsoString_(new Date())
  ]);
}

/**
 * システムログを保存する。
 * 例外や分岐結果をスプレッドシート上で追跡するために使う。
 *
 * Input:
 * - `level`: `INFO`, `WARN`, `ERROR`
 * - `moduleName`: 発生箇所
 * - `eventId`: 関連イベント ID
 * - `message`: 要約
 * - `payloadSnippet`: 元データの一部
 *
 * Output:
 * - なし
 */
function appendSystemLog_(level, moduleName, eventId, message, payloadSnippet) {
  var sheet = getOrCreateSheet_("system_logs", V3_SHEET_HEADERS.system_logs);
  sheet.appendRow([
    createId_("log"),
    toIsoString_(new Date()),
    level || "INFO",
    moduleName || "",
    eventId || "",
    message || "",
    trimString_(payloadSnippet).slice(0, 500)
  ]);
}

/**
 * 取引更新時の変更前後を監査ログへ保存する。
 *
 * Input:
 * - `transactionId`: 取引 ID
 * - `action`: 操作種別
 * - `beforeObject`: 更新前データ
 * - `afterObject`: 更新後データ
 * - `actorUserId`: 実行者
 *
 * Output:
 * - なし
 */
function appendAuditLog_(transactionId, action, beforeObject, afterObject, actorUserId) {
  var sheet = getOrCreateSheet_("audit_logs", V3_SHEET_HEADERS.audit_logs);
  sheet.appendRow([
    createId_("audit"),
    toIsoString_(new Date()),
    transactionId || "",
    action || "update",
    JSON.stringify(beforeObject || {}),
    JSON.stringify(afterObject || {}),
    actorUserId || ""
  ]);
}

/**
 * 監査ログを一覧取得する。
 * 取引 ID が渡された場合は、その取引に関するログのみ返す。
 *
 * Input:
 * - `transactionId`: 取引 ID
 *
 * Output:
 * - 監査ログ配列
 */
function listAuditLogs_(transactionId) {
  return readSheetRows_("audit_logs")
    .filter(function (log) {
      return !transactionId || trimString_(log.transaction_id) === trimString_(transactionId);
    })
    .map(function (log) {
      return cloneWithoutMeta_(log);
    });
}

/**
 * Google カレンダー同期の結果を保存する。
 *
 * Input:
 * - `transactionId`: 取引 ID
 * - `syncAction`: `create`, `update`, `skip`
 * - `syncStatus`: `success`, `failed`, `skipped`
 * - `calendarEventId`: カレンダーイベント ID
 * - `errorMessage`: 失敗時メッセージ
 *
 * Output:
 * - なし
 */
function appendCalendarSyncLog_(transactionId, syncAction, syncStatus, calendarEventId, errorMessage) {
  var sheet = getOrCreateSheet_("calendar_sync_logs", V3_SHEET_HEADERS.calendar_sync_logs);
  sheet.appendRow([
    createId_("sync"),
    toIsoString_(new Date()),
    transactionId || "",
    syncAction || "create",
    syncStatus || "success",
    calendarEventId || "",
    errorMessage || ""
  ]);
}

/**
 * 利用者ごとの手入力途中状態を取得する。
 *
 * Input:
 * - `userId`: LINE user ID
 *
 * Output:
 * - 状態オブジェクト
 * - 見つからない場合は `null`
 */
function getUserStatus_(userId) {
  var rows = readSheetRows_("user_status");
  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].user_id) === trimString_(userId)) {
      return cloneWithoutMeta_(rows[i]);
    }
  }
  return null;
}

/**
 * 利用者の入力途中状態を新規作成または更新する。
 *
 * Input:
 * - `userId`: LINE user ID
 * - `statusObject`: 保存したい状態
 *
 * Output:
 * - 保存した状態オブジェクト
 */
function upsertUserStatus_(userId, statusObject) {
  var sheet = getOrCreateSheet_("user_status", V3_SHEET_HEADERS.user_status);
  var rows = readSheetRows_("user_status");
  var normalized = {
    user_id: userId,
    transaction_id: statusObject.transaction_id || "",
    step: statusObject.step || "",
    amount_total: statusObject.amount_total || "",
    category_main: statusObject.category_main || "",
    category_sub: statusObject.category_sub || "",
    updated_at: toIsoString_(new Date())
  };

  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].user_id) === trimString_(userId)) {
      var values = buildRowFromObject_(V3_SHEET_HEADERS.user_status, normalized);
      sheet.getRange(rows[i].__rowNumber, 1, 1, values.length).setValues([values]);
      return normalized;
    }
  }

  sheet.appendRow(buildRowFromObject_(V3_SHEET_HEADERS.user_status, normalized));
  return normalized;
}

/**
 * 利用者の入力途中状態を削除する。
 * 手入力フロー完了時またはエラー復旧時に使用する。
 *
 * Input:
 * - `userId`: LINE user ID
 *
 * Output:
 * - なし
 */
function clearUserStatus_(userId) {
  var sheet = getOrCreateSheet_("user_status", V3_SHEET_HEADERS.user_status);
  var rows = readSheetRows_("user_status");
  for (var i = rows.length - 1; i >= 0; i--) {
    if (trimString_(rows[i].user_id) === trimString_(userId)) {
      sheet.deleteRow(rows[i].__rowNumber);
    }
  }
}

/**
 * 地図表示用のレコード配列を作成する。
 * 座標を持つ取引だけに絞り、Flask の地図画面がそのまま読める形で返す。
 *
 * Input: なし
 * Output:
 * - 地図表示用レコード配列
 */
function buildMapData_() {
  return listTransactions_()
    .filter(function (transaction) {
      return trimString_(transaction.lat) !== "" &&
        trimString_(transaction.lon) !== "" &&
        trimString_(transaction.lat) !== "unknown" &&
        trimString_(transaction.lon) !== "unknown";
    })
    .map(function (transaction) {
      return {
        transaction_id: transaction.transaction_id,
        date: transaction.date,
        lat: Number(transaction.lat),
        lng: Number(transaction.lon),
        size: Number(transaction.amount_total || 0),
        shop: transaction.store_name,
        category_main: transaction.category_main,
        status: transaction.status,
        description: [
          transaction.store_name || "名称未設定",
          "金額: " + transaction.amount_total + "円",
          "日付: " + transaction.date
        ].join("\n")
      };
    });
}

/**
 * ダッシュボードの KPI 集計を作成する。
 *
 * Input: なし
 * Output:
 * - `{ transaction_count, total_amount, geocoded_count, ... }`
 */
function buildSummary_() {
  var transactions = listTransactions_();
  var summary = {
    transaction_count: transactions.length,
    total_amount: 0,
    geocoded_count: 0,
    draft_count: 0,
    failed_count: 0,
    uncategorized_count: 0
  };

  transactions.forEach(function (transaction) {
    summary.total_amount += toNumberOrZero_(transaction.amount_total);
    if (trimString_(transaction.lat) && trimString_(transaction.lat) !== "unknown") {
      summary.geocoded_count += 1;
    }
    if (transaction.status === "draft") summary.draft_count += 1;
    if (transaction.status === "failed") summary.failed_count += 1;
    if (transaction.category_main === CATEGORY_FALLBACK_V3.main) summary.uncategorized_count += 1;
  });

  return summary;
}

/**
 * 月単位の集計を作成する。
 * Flask の月別支出グラフで利用する。
 *
 * Input: なし
 * Output:
 * - `[{ month, total_amount, transaction_count }]`
 */
function buildMonthlyAnalysis_() {
  var buckets = {};
  listTransactions_().forEach(function (transaction) {
    var monthKey = trimString_(transaction.date).slice(0, 7) || "unknown";
    if (!buckets[monthKey]) {
      buckets[monthKey] = { month: monthKey, total_amount: 0, transaction_count: 0 };
    }
    buckets[monthKey].total_amount += toNumberOrZero_(transaction.amount_total);
    buckets[monthKey].transaction_count += 1;
  });

  return Object.keys(buckets).sort().map(function (key) {
    return buckets[key];
  });
}

/**
 * 内部管理用の `__rowNumber` を除外したコピーを作る。
 * API レスポンスへ行番号を漏らさないための関数。
 *
 * Input:
 * - `objectValue`: シート行オブジェクト
 *
 * Output:
 * - メタ情報を除いたオブジェクト
 */
function cloneWithoutMeta_(objectValue) {
  var clone = {};
  Object.keys(objectValue || {}).forEach(function (key) {
    if (key === "__rowNumber") return;
    clone[key] = objectValue[key];
  });
  return clone;
}
