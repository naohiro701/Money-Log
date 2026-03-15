/**
 * レシート画像 1 件を取引データへ変換し、保存と同期を行う。
 * この関数が OCR フロー全体の実行単位になる。
 *
 * Input:
 * - `eventObj`: LINE の image メッセージ event
 *
 * Output:
 * - `createHandlerResult_` 形式の返信内容
 */
function handleReceiptMessage_(eventObj) {
  var userId = trimString_((eventObj.source || {}).userId) || "anonymous";
  var driveFile = null;

  try {
    var originalBlob = downloadLineMessageContent_(eventObj.message.id);
    driveFile = saveReceiptBlobToDrive_(originalBlob, userId);
    var imageBlob = resizeImageBlob_(driveFile, originalBlob);

    var rawReceipt = extractReceiptFromImage_(imageBlob);
    var normalizedReceipt = normalizeReceiptPayload_(rawReceipt);
    var categoryPath = resolveCategoryPath_(normalizedReceipt.category);
    var geocode = geocodeQuery_(
      trimString_(normalizedReceipt.store_address) !== "unknown"
        ? normalizedReceipt.store_address + " " + normalizedReceipt.store_name
        : normalizedReceipt.store_name
    );

    var now = new Date();
    var transactionId = createId_("tx");
    var transaction = {
      transaction_id: transactionId,
      event_id: getEventId_(eventObj),
      user_id: userId,
      input_channel: "receipt_image",
      status: "confirmed",
      date: normalizedReceipt.date,
      time: normalizedReceipt.time,
      amount_total: normalizedReceipt.total,
      store_name: normalizedReceipt.store_name,
      store_address: geocode.address !== "unknown" ? geocode.address : normalizedReceipt.store_address,
      lat: geocode.latitude,
      lon: geocode.longitude,
      category_main: categoryPath.main,
      category_sub: categoryPath.sub,
      category_detail: categoryPath.detail,
      payment_method: normalizedReceipt.payment_method,
      source_message: JSON.stringify(normalizedReceipt.raw_json),
      calendar_event_id: "",
      created_at: toIsoString_(now),
      updated_at: toIsoString_(now)
    };

    appendTransaction_(transaction);
    appendTransactionItems_(transactionId, normalizedReceipt.items);

    var syncResult = syncCalendarEvent_(transaction);
    if (syncResult.eventId) {
      transaction = updateTransaction_(transactionId, {
        calendar_event_id: syncResult.eventId
      });
    }

    return createHandlerResult_("receipt_image", transactionId, [
      createTextMessage_(formatReceiptConfirmationText_(transaction, normalizedReceipt.items))
    ]);
  } catch (error) {
    appendSystemLog_("ERROR", "handleReceiptMessage_", getEventId_(eventObj), error.message, "");
    return createHandlerResult_("receipt_image", "", [
      createTextMessage_("レシートの解析に失敗しました。画像を送り直すか、後で管理画面から修正してください。")
    ]);
  } finally {
    if (driveFile) {
      try {
        driveFile.setTrashed(true);
      } catch (error) {
        appendSystemLog_("WARN", "handleReceiptMessage_.finally", "", error.message, "");
      }
    }
  }
}
