function listTransactions_() {
  return readSheetRows_("transactions").map(function (transaction) {
    var record = cloneWithoutMeta_(transaction);
    record.items = listTransactionItems_(record.transaction_id);
    return record;
  });
}

function getTransactionById_(transactionId) {
  var transaction = findTransactionRow_(transactionId);
  if (!transaction) return null;

  var record = cloneWithoutMeta_(transaction);
  record.items = listTransactionItems_(transactionId);
  return record;
}

function appendTransaction_(transaction) {
  var sheet = getOrCreateSheet_("transactions", V3_SHEET_HEADERS.transactions);
  sheet.appendRow(buildRowFromObject_(V3_SHEET_HEADERS.transactions, transaction));
  return transaction;
}

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

function findTransactionRow_(transactionId) {
  var rows = readSheetRows_("transactions");
  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].transaction_id) === trimString_(transactionId)) {
      return rows[i];
    }
  }
  return null;
}

function findTransactionByEventId_(eventId) {
  var rows = readSheetRows_("transactions");
  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].event_id) === trimString_(eventId)) {
      return cloneWithoutMeta_(rows[i]);
    }
  }
  return null;
}

function listTransactionItems_(transactionId) {
  return readSheetRows_("transaction_items")
    .filter(function (item) {
      return trimString_(item.transaction_id) === trimString_(transactionId);
    })
    .map(function (item) {
      return cloneWithoutMeta_(item);
    });
}

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

function recalculateTotalFromItems_(items) {
  return (items || []).reduce(function (sum, item) {
    return sum + toNumberOrZero_(item.line_amount || (item.quantity || 1) * (item.unit_price || 0));
  }, 0);
}

function hasProcessedEvent_(eventId) {
  var rows = readSheetRows_("processed_events");
  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].event_id) === trimString_(eventId)) return true;
  }
  return false;
}

function recordProcessedEvent_(eventId, transactionId, channel) {
  var sheet = getOrCreateSheet_("processed_events", V3_SHEET_HEADERS.processed_events);
  sheet.appendRow([
    eventId,
    transactionId || "",
    channel || "",
    toIsoString_(new Date())
  ]);
}

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

function listAuditLogs_(transactionId) {
  return readSheetRows_("audit_logs")
    .filter(function (log) {
      return !transactionId || trimString_(log.transaction_id) === trimString_(transactionId);
    })
    .map(function (log) {
      return cloneWithoutMeta_(log);
    });
}

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

function getUserStatus_(userId) {
  var rows = readSheetRows_("user_status");
  for (var i = 0; i < rows.length; i++) {
    if (trimString_(rows[i].user_id) === trimString_(userId)) {
      return cloneWithoutMeta_(rows[i]);
    }
  }
  return null;
}

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

function clearUserStatus_(userId) {
  var sheet = getOrCreateSheet_("user_status", V3_SHEET_HEADERS.user_status);
  var rows = readSheetRows_("user_status");
  for (var i = rows.length - 1; i >= 0; i--) {
    if (trimString_(rows[i].user_id) === trimString_(userId)) {
      sheet.deleteRow(rows[i].__rowNumber);
    }
  }
}

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

function cloneWithoutMeta_(objectValue) {
  var clone = {};
  Object.keys(objectValue || {}).forEach(function (key) {
    if (key === "__rowNumber") return;
    clone[key] = objectValue[key];
  });
  return clone;
}

