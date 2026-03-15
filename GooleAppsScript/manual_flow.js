/**
 * 手入力フローの現在地を判定し、次に実行する関数へ渡す。
 * 金額入力、カテゴリ選択、位置情報入力の順に取引を完成させる。
 *
 * Input:
 * - `eventObj`: LINE の text または location メッセージ
 *
 * Output:
 * - `createHandlerResult_` 形式の結果
 */
function handleManualMessage_(eventObj) {
  var userId = trimString_((eventObj.source || {}).userId) || "anonymous";
  var message = eventObj.message || {};
  var userStatus = getUserStatus_(userId);

  if (message.type === "text" && isNumericText_(message.text)) {
    return startManualTransaction_(eventObj, userId, message.text);
  }

  if (!userStatus) {
    return createHandlerResult_("manual", "", [
      createTextMessage_("最初に金額を半角数字で送ってください。例: 1280")
    ]);
  }

  if (userStatus.step === "awaiting_category_main") {
    return handleManualMainCategorySelection_(eventObj, userStatus);
  }
  if (userStatus.step === "awaiting_category_sub") {
    return handleManualSubCategorySelection_(eventObj, userStatus);
  }
  if (userStatus.step === "awaiting_category_detail") {
    return handleManualDetailCategorySelection_(eventObj, userStatus);
  }
  if (userStatus.step === "awaiting_location") {
    return finalizeManualTransaction_(eventObj, userStatus);
  }

  return createHandlerResult_("manual", userStatus.transaction_id, [
    createTextMessage_("状態が不明になりました。もう一度金額から入力してください。")
  ]);
}

/**
 * 金額入力を受け取り、下書き取引を新規作成する。
 * ここでは金額と利用者 ID だけを保存し、カテゴリ選択は次のステップへ持ち越す。
 *
 * Input:
 * - `eventObj`: LINE event object
 * - `userId`: LINE user ID
 * - `amountText`: 金額文字列
 *
 * Output:
 * - 大分類選択用の返信メッセージ
 */
function startManualTransaction_(eventObj, userId, amountText) {
  var now = new Date();
  var transaction = {
    transaction_id: createId_("tx"),
    event_id: getEventId_(eventObj),
    user_id: userId,
    input_channel: "manual",
    status: "draft",
    date: Utilities.formatDate(now, "Asia/Tokyo", "yyyy-MM-dd"),
    time: Utilities.formatDate(now, "Asia/Tokyo", "HH:mm:ss"),
    amount_total: toNumberOrZero_(amountText),
    store_name: "",
    store_address: "",
    lat: "",
    lon: "",
    category_main: "",
    category_sub: "",
    category_detail: "",
    payment_method: "",
    source_message: trimString_(amountText),
    calendar_event_id: "",
    created_at: toIsoString_(now),
    updated_at: toIsoString_(now)
  };

  appendTransaction_(transaction);
  upsertUserStatus_(userId, {
    transaction_id: transaction.transaction_id,
    step: "awaiting_category_main",
    amount_total: transaction.amount_total
  });

  return createHandlerResult_("manual", transaction.transaction_id, [
    createTextMessage_("金額を記録しました。大分類を選んでください。"),
    createSelectionFlexMessage_("大分類を選択", getMainCategories_())
  ]);
}

/**
 * 大分類の選択結果を保存し、次の中分類選択へ進める。
 *
 * Input:
 * - `eventObj`: LINE text event
 * - `userStatus`: 現在の入力状態
 *
 * Output:
 * - 中分類選択用の返信メッセージ
 */
function handleManualMainCategorySelection_(eventObj, userStatus) {
  var messageText = trimString_((eventObj.message || {}).text);
  if (getMainCategories_().indexOf(messageText) === -1) {
    return createHandlerResult_("manual", userStatus.transaction_id, [
      createTextMessage_("大分類の選択肢から選んでください。"),
      createSelectionFlexMessage_("大分類を選択", getMainCategories_())
    ]);
  }

  updateTransaction_(userStatus.transaction_id, {
    category_main: messageText
  });
  upsertUserStatus_(trimString_((eventObj.source || {}).userId), {
    transaction_id: userStatus.transaction_id,
    step: "awaiting_category_sub",
    amount_total: userStatus.amount_total,
    category_main: messageText
  });

  return createHandlerResult_("manual", userStatus.transaction_id, [
    createTextMessage_("中分類を選んでください。"),
    createSelectionFlexMessage_("中分類を選択", getSubCategories_(messageText))
  ]);
}

/**
 * 中分類の選択結果を保存し、次の小分類選択へ進める。
 *
 * Input:
 * - `eventObj`: LINE text event
 * - `userStatus`: 現在の入力状態
 *
 * Output:
 * - 小分類選択用の返信メッセージ
 */
function handleManualSubCategorySelection_(eventObj, userStatus) {
  var messageText = trimString_((eventObj.message || {}).text);
  var categoryMain = trimString_(userStatus.category_main);
  var options = getSubCategories_(categoryMain);
  if (options.indexOf(messageText) === -1) {
    return createHandlerResult_("manual", userStatus.transaction_id, [
      createTextMessage_("中分類の選択肢から選んでください。"),
      createSelectionFlexMessage_("中分類を選択", options)
    ]);
  }

  updateTransaction_(userStatus.transaction_id, {
    category_main: categoryMain,
    category_sub: messageText
  });
  upsertUserStatus_(trimString_((eventObj.source || {}).userId), {
    transaction_id: userStatus.transaction_id,
    step: "awaiting_category_detail",
    amount_total: userStatus.amount_total,
    category_main: categoryMain,
    category_sub: messageText
  });

  return createHandlerResult_("manual", userStatus.transaction_id, [
    createTextMessage_("小分類を選んでください。"),
    createSelectionFlexMessage_("小分類を選択", getDetailCategories_(categoryMain, messageText))
  ]);
}

/**
 * 小分類の選択結果を保存し、最後の位置情報入力へ進める。
 *
 * Input:
 * - `eventObj`: LINE text event
 * - `userStatus`: 現在の入力状態
 *
 * Output:
 * - 位置情報入力を促す返信メッセージ
 */
function handleManualDetailCategorySelection_(eventObj, userStatus) {
  var messageText = trimString_((eventObj.message || {}).text);
  var categoryMain = trimString_(userStatus.category_main);
  var categorySub = trimString_(userStatus.category_sub);
  var options = getDetailCategories_(categoryMain, categorySub);
  if (options.indexOf(messageText) === -1) {
    return createHandlerResult_("manual", userStatus.transaction_id, [
      createTextMessage_("小分類の選択肢から選んでください。"),
      createSelectionFlexMessage_("小分類を選択", options)
    ]);
  }

  updateTransaction_(userStatus.transaction_id, {
    category_main: categoryMain,
    category_sub: categorySub,
    category_detail: messageText
  });
  upsertUserStatus_(trimString_((eventObj.source || {}).userId), {
    transaction_id: userStatus.transaction_id,
    step: "awaiting_location",
    amount_total: userStatus.amount_total,
    category_main: categoryMain,
    category_sub: categorySub
  });

  return createHandlerResult_("manual", userStatus.transaction_id, [
    createTextMessage_("最後に位置情報を送るか、店舗名・住所をテキストで送ってください。")
  ]);
}

/**
 * 手入力フローを完了し、位置情報を付与して取引を確定する。
 * 取引確定後、Google カレンダーへの登録も実行する。
 *
 * Input:
 * - `eventObj`: LINE location または text event
 * - `userStatus`: 現在の入力状態
 *
 * Output:
 * - 完了メッセージ
 */
function finalizeManualTransaction_(eventObj, userStatus) {
  var locationResult = resolveManualLocation_(eventObj.message || {});
  var existing = getTransactionById_(userStatus.transaction_id);
  if (!existing) {
    clearUserStatus_(trimString_((eventObj.source || {}).userId));
    return createHandlerResult_("manual", "", [
      createTextMessage_("途中データが見つかりませんでした。もう一度金額から入力してください。")
    ]);
  }

  var updated = updateTransaction_(userStatus.transaction_id, {
    store_name: locationResult.store_name,
    store_address: locationResult.address,
    lat: locationResult.latitude,
    lon: locationResult.longitude,
    status: "confirmed"
  });

  var syncResult = syncCalendarEvent_(updated);
  if (syncResult.eventId) {
    updated = updateTransaction_(userStatus.transaction_id, {
      calendar_event_id: syncResult.eventId
    });
  }

  clearUserStatus_(trimString_((eventObj.source || {}).userId));
  return createHandlerResult_("manual", userStatus.transaction_id, [
    createTextMessage_(formatManualConfirmationText_(updated))
  ]);
}

/**
 * LINE メッセージから保存用の位置情報オブジェクトを作る。
 * `location` メッセージならそのまま使い、テキストなら Geocode で住所と座標を補完する。
 *
 * Input:
 * - `message`: LINE message object
 *
 * Output:
 * - `{ store_name, address, latitude, longitude }`
 */
function resolveManualLocation_(message) {
  if (message.type === "location") {
    return {
      store_name: trimString_(message.title) || "",
      address: trimString_(message.address) || "unknown",
      latitude: trimString_(message.latitude) || "unknown",
      longitude: trimString_(message.longitude) || "unknown"
    };
  }

  var text = trimString_(message.text);
  var geocode = geocodeQuery_(text);
  return {
    store_name: text,
    address: geocode.address,
    latitude: geocode.latitude,
    longitude: geocode.longitude
  };
}
