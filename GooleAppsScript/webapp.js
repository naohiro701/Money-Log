/**
 * GET リクエストの共通入口。
 * Flask 画面から呼ばれる一覧、詳細、監査ログ、地図表示用データを返す。
 *
 * Input:
 * - `e.parameter.action`: 実行する API 名
 * - `e.parameter.transaction_id`: 必要に応じて対象取引 ID
 *
 * Output:
 * - JSON レスポンス
 */
function doGet(e) {
  ensureV3Sheets_();

  try {
    var action = trimString_((e && e.parameter && e.parameter.action) || "mapData");
    if (action === "listTransactions") {
      return createJsonResponse_({
        ok: true,
        transactions: listTransactions_()
      });
    }
    if (action === "getTransaction") {
      var transactionId = trimString_(e.parameter.transaction_id);
      return createJsonResponse_({
        ok: true,
        transaction: getTransactionById_(transactionId)
      });
    }
    if (action === "summary") {
      return createJsonResponse_({
        ok: true,
        summary: buildSummary_(),
        monthly: buildMonthlyAnalysis_()
      });
    }
    if (action === "auditLogs") {
      return createJsonResponse_({
        ok: true,
        audit_logs: listAuditLogs_(trimString_(e.parameter.transaction_id))
      });
    }

    return createJsonResponse_(buildMapData_());
  } catch (error) {
    appendSystemLog_("ERROR", "doGet", "", error.message, "");
    return createJsonResponse_({
      ok: false,
      error: error.message
    });
  }
}

/**
 * POST リクエストの共通入口。
 * `action` がある場合は管理 API として扱い、無い場合は LINE Webhook として扱う。
 *
 * Input:
 * - `e.parameter.action`: 管理 API 名
 * - `e.postData.contents`: JSON 文字列
 *
 * Output:
 * - JSON またはテキストレスポンス
 */
function doPost(e) {
  ensureV3Sheets_();

  try {
    var action = trimString_((e && e.parameter && e.parameter.action) || "");
    if (action) {
      return handleAdminAction_(action, e);
    }
    return handleLineWebhook_(e);
  } catch (error) {
    appendSystemLog_("ERROR", "doPost", "", error.message, "");
    return createJsonResponse_({
      ok: false,
      error: error.message
    });
  }
}

/**
 * LINE Webhook の本文を読み取り、含まれているイベントを順番に処理する。
 *
 * Input:
 * - `e.postData.contents`: LINE Webhook JSON
 *
 * Output:
 * - `"ok"` を返すテキストレスポンス
 */
function handleLineWebhook_(e) {
  var payload = parseJsonSafely_(e.postData.contents, {});
  var events = payload.events || [];

  events.forEach(function (eventObj) {
    processLineEvent_(eventObj);
  });

  return createTextResponse_("ok");
}

/**
 * LINE の 1 イベントを処理する。
 * イベント種別を見て、手入力フローまたは OCR フローへ渡し、返信メッセージを送る。
 *
 * Input:
 * - `eventObj`: LINE event object
 *
 * Output:
 * - なし
 */
function processLineEvent_(eventObj) {
  var eventId = getEventId_(eventObj);
  if (hasProcessedEvent_(eventId)) {
    appendSystemLog_("INFO", "processLineEvent_", eventId, "Skipped duplicate event", "");
    return;
  }

  if (eventObj.type !== "message") {
    recordProcessedEvent_(eventId, "", eventObj.type || "unknown");
    return;
  }

  var result;
  var messageType = trimString_((eventObj.message || {}).type);
  if (messageType === "image") {
    result = handleReceiptMessage_(eventObj);
  } else if (messageType === "text" || messageType === "location") {
    result = handleManualMessage_(eventObj);
  } else {
    result = createHandlerResult_("unknown", "", [
      createTextMessage_("このメッセージ形式にはまだ対応していません。")
    ]);
  }

  replyLineMessage_(eventObj.replyToken, result.messages);
  recordProcessedEvent_(eventId, result.transaction_id, result.channel);
}

/**
 * Flask からの管理 API を処理する。
 * 認証に成功した場合のみ、取引更新または Google カレンダー再同期を実行する。
 *
 * Input:
 * - `action`: API 名
 * - `e.postData.contents`: JSON 文字列
 *
 * Output:
 * - JSON レスポンス
 */
function handleAdminAction_(action, e) {
  var payload = parseJsonSafely_(e.postData.contents, {});
  if (!isAdminAuthorized_(payload)) {
    return createJsonResponse_({
      ok: false,
      error: "unauthorized"
    });
  }

  if (action === "updateTransaction") {
    return createJsonResponse_({
      ok: true,
      transaction: updateTransactionFromAdmin_(payload)
    });
  }

  if (action === "resyncCalendar") {
    var transaction = getTransactionById_(trimString_(payload.transaction_id));
    if (!transaction) throw new Error("Transaction not found.");
    var syncResult = syncCalendarEvent_(transaction);
    if (syncResult.eventId) {
      transaction = updateTransaction_(transaction.transaction_id, {
        calendar_event_id: syncResult.eventId
      });
    }
    return createJsonResponse_({
      ok: true,
      transaction: transaction,
      sync: syncResult
    });
  }

  return createJsonResponse_({
    ok: false,
    error: "Unsupported action: " + action
  });
}

/**
 * 管理 API の認証トークンを検証する。
 *
 * Input:
 * - `payload.admin_token`: リクエスト側が送るトークン
 *
 * Output:
 * - `true`: 認証成功
 * - `false`: 認証失敗
 */
function isAdminAuthorized_(payload) {
  var expectedToken = trimString_(getSetting_("admin_token", ""));
  if (!expectedToken) return false;
  return trimString_(payload.admin_token) === expectedToken;
}

/**
 * Flask から渡された更新内容を台帳へ反映する。
 * 取引更新、明細更新、再ジオコーディング、カレンダー再同期、監査ログ保存までをまとめて行う。
 *
 * Input:
 * - `payload.transaction_id`: 更新対象の取引 ID
 * - `payload.updates`: 更新したい項目
 * - `payload.actor_user_id`: 更新実行者
 *
 * Output:
 * - 更新後の取引オブジェクト
 */
function updateTransactionFromAdmin_(payload) {
  var transactionId = trimString_(payload.transaction_id);
  if (!transactionId) throw new Error("transaction_id is required.");

  var existing = getTransactionById_(transactionId);
  if (!existing) throw new Error("Transaction not found: " + transactionId);

  var updates = payload.updates || {};
  var normalizedUpdates = normalizeAdminUpdates_(existing, updates);
  var updated = updateTransaction_(transactionId, normalizedUpdates);

  if (updates.hasOwnProperty("items") && Array.isArray(updates.items)) {
    replaceTransactionItems_(transactionId, updates.items);
    updated = getTransactionById_(transactionId);
    if (!updates.amount_total) {
      updated = updateTransaction_(transactionId, {
        amount_total: recalculateTotalFromItems_(updated.items)
      });
    }
  }

  if ((updates.store_name || updates.store_address) && !updates.hasOwnProperty("lat") && !updates.hasOwnProperty("lon")) {
    var geocode = geocodeQuery_(trimString_(updated.store_address) || trimString_(updated.store_name));
    updated = updateTransaction_(transactionId, {
      store_address: geocode.address,
      lat: geocode.latitude,
      lon: geocode.longitude
    });
  }

  if (updated.status === "confirmed") {
    var syncResult = syncCalendarEvent_(updated);
    if (syncResult.eventId) {
      updated = updateTransaction_(transactionId, {
        calendar_event_id: syncResult.eventId
      });
    }
  }

  appendAuditLog_(
    transactionId,
    "update_from_flask",
    existing,
    updated,
    trimString_(payload.actor_user_id) || "flask-admin"
  );

  return updated;
}

/**
 * Flask から渡された更新内容を、台帳の保存形式へ整形する。
 * 日付や時刻の表記ゆれ、カテゴリ 3 階層の補完をここで行う。
 *
 * Input:
 * - `existing`: 現在の取引データ
 * - `updates`: 画面から送られた更新内容
 *
 * Output:
 * - 台帳へそのまま保存できる更新データ
 */
function normalizeAdminUpdates_(existing, updates) {
  var normalized = {
    date: existing.date,
    time: existing.time,
    amount_total: existing.amount_total,
    store_name: existing.store_name,
    store_address: existing.store_address,
    lat: existing.lat,
    lon: existing.lon,
    category_main: existing.category_main,
    category_sub: existing.category_sub,
    category_detail: existing.category_detail,
    payment_method: existing.payment_method,
    status: existing.status,
    source_message: existing.source_message
  };

  if (updates.hasOwnProperty("date")) normalized.date = trimString_(updates.date) || existing.date;
  if (updates.hasOwnProperty("time")) normalized.time = normalizeTimeString_(updates.time);
  if (updates.hasOwnProperty("amount_total")) normalized.amount_total = toNumberOrZero_(updates.amount_total);
  if (updates.hasOwnProperty("store_name")) normalized.store_name = trimString_(updates.store_name);
  if (updates.hasOwnProperty("store_address")) normalized.store_address = trimString_(updates.store_address);
  if (updates.hasOwnProperty("lat")) normalized.lat = trimString_(updates.lat);
  if (updates.hasOwnProperty("lon")) normalized.lon = trimString_(updates.lon);
  if (updates.hasOwnProperty("payment_method")) normalized.payment_method = trimString_(updates.payment_method);
  if (updates.hasOwnProperty("status")) normalized.status = trimString_(updates.status) || existing.status;
  if (updates.hasOwnProperty("source_message")) normalized.source_message = trimString_(updates.source_message);

  if (updates.category_detail) {
    var categoryPath = resolveCategoryPath_(updates.category_detail);
    normalized.category_main = categoryPath.main;
    normalized.category_sub = categoryPath.sub;
    normalized.category_detail = categoryPath.detail;
  } else if (updates.category_sub) {
    var partialCategoryPath = resolveCategoryPath_(updates.category_sub);
    normalized.category_main = partialCategoryPath.main;
    normalized.category_sub = partialCategoryPath.sub;
    normalized.category_detail = partialCategoryPath.detail;
  } else if (updates.category_main) {
    var mainCategoryPath = resolveCategoryPath_(updates.category_main);
    normalized.category_main = mainCategoryPath.main;
    normalized.category_sub = mainCategoryPath.sub;
    normalized.category_detail = mainCategoryPath.detail;
  }

  return normalized;
}
