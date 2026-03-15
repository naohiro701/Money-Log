/**
 * LINE の通常テキスト返信を作成する。
 *
 * Input:
 * - `text`: 返信本文
 *
 * Output:
 * - LINE Messaging API の text message オブジェクト
 */
function createTextMessage_(text) {
  return {
    type: "text",
    text: text
  };
}

/**
 * LINE の選択式メッセージを作成する。
 * 手入力フローでカテゴリを段階的に選んでもらうために使う。
 *
 * Input:
 * - `altText`: LINE が代替表示に使う文言
 * - `options`: 選択肢配列
 *
 * Output:
 * - LINE Messaging API の flex message オブジェクト
 */
function createSelectionFlexMessage_(altText, options) {
  var limitedOptions = (options || []).slice(0, 10);
  return {
    type: "flex",
    altText: altText || "選択肢一覧",
    contents: {
      type: "carousel",
      contents: limitedOptions.map(function (option) {
        return {
          type: "bubble",
          size: "nano",
          body: {
            type: "box",
            layout: "vertical",
            contents: [
              {
                type: "button",
                style: "primary",
                color: "#006d77",
                action: {
                  type: "message",
                  label: option,
                  text: option
                }
              }
            ]
          }
        };
      })
    }
  };
}

/**
 * LINE へ返信メッセージを送信する。
 *
 * Input:
 * - `replyToken`: LINE が発行した返信トークン
 * - `messages`: 返信メッセージ配列または単体
 *
 * Output:
 * - なし
 */
function replyLineMessage_(replyToken, messages) {
  var channelAccessToken = trimString_(getSetting_("line_channel_access_token", ""));
  if (!channelAccessToken || !replyToken) return;

  var normalizedMessages = Array.isArray(messages) ? messages : [messages];
  var payload = {
    replyToken: replyToken,
    messages: normalizedMessages.slice(0, 5)
  };

  UrlFetchApp.fetch("https://api.line.me/v2/bot/message/reply", {
    method: "post",
    contentType: "application/json",
    headers: {
      Authorization: "Bearer " + channelAccessToken
    },
    payload: JSON.stringify(payload),
    muteHttpExceptions: true
  });
}

/**
 * LINE から画像バイナリを取得する。
 * レシート OCR フローの最初の入力データを用意する関数。
 *
 * Input:
 * - `messageId`: LINE のメッセージ ID
 *
 * Output:
 * - `Blob`
 */
function downloadLineMessageContent_(messageId) {
  var channelAccessToken = trimString_(getSetting_("line_channel_access_token", ""));
  if (!channelAccessToken) throw new Error("LINE token is not configured.");

  var response = UrlFetchApp.fetch(
    "https://api-data.line.me/v2/bot/message/" + messageId + "/content",
    {
      method: "get",
      headers: {
        Authorization: "Bearer " + channelAccessToken
      }
    }
  );

  return response.getBlob();
}

/**
 * 受け取ったレシート画像を Google Drive に一時保存する。
 * 後段の画像リサイズや障害調査に使えるよう、OCR 前の原本を一度ファイル化している。
 *
 * Input:
 * - `blob`: 画像データ
 * - `userId`: 送信者 ID
 *
 * Output:
 * - `File`
 * - 保存先未設定の場合は `null`
 */
function saveReceiptBlobToDrive_(blob, userId) {
  var folderId = trimString_(getSetting_("receipt_drive_folder_id", ""));
  if (!folderId) return null;

  var folder = DriveApp.getFolderById(folderId);
  var fileName = [
    Utilities.formatDate(new Date(), "Asia/Tokyo", "yyyyMMdd_HHmmss"),
    userId || "unknown",
    ".png"
  ].join("");

  var file = folder.createFile(blob.getAs("image/png").setName(fileName));
  return file;
}

/**
 * OCR に渡す前に画像をリサイズする。
 * 画像処理ライブラリが使えない環境では、元画像をそのまま返す。
 *
 * Input:
 * - `file`: Drive に保存したファイル
 * - `fallbackBlob`: リサイズ失敗時に使う元画像
 *
 * Output:
 * - OCR に渡す `Blob`
 */
function resizeImageBlob_(file, fallbackBlob) {
  if (typeof ImgApp !== "undefined" && file && file.getId) {
    try {
      var resized = ImgApp.doResize(file.getId(), 500);
      if (resized && resized.blob) return resized.blob;
    } catch (error) {
      appendSystemLog_("WARN", "resizeImageBlob_", "", error.message, "");
    }
  }
  return fallbackBlob;
}

/**
 * Gemini Vision へ画像を送り、レシート情報を JSON として取得する。
 *
 * Input:
 * - `imageBlob`: レシート画像
 *
 * Output:
 * - OCR 生結果のオブジェクト
 */
function extractReceiptFromImage_(imageBlob) {
  var geminiApiKey = trimString_(getSetting_("gemini_api_key", ""));
  if (!geminiApiKey) throw new Error("Gemini API key is not configured.");

  var promptText = [
    "以下の画像はレシートです。",
    "次の構造の JSON だけを返してください。コードブロック記号は不要です。",
    "store_name, store_address, phone_number, year, month, day, time, receipt_number, items, subtotal, tax, total, payment_method, change, category を含めてください。",
    "items は name, price, quantity を持つ配列にしてください。",
    "カテゴリは家計簿で使いやすい自然な日本語にしてください。"
  ].join("\n");

  var body = {
    contents: [
      {
        parts: [
          { text: promptText },
          {
            inlineData: {
              mimeType: "image/png",
              data: Utilities.base64Encode(imageBlob.getBytes())
            }
          }
        ]
      }
    ]
  };

  var response = UrlFetchApp.fetch(
    "https://generativelanguage.googleapis.com/v1/models/gemini-2.5-flash:generateContent?key=" + geminiApiKey,
    {
      method: "post",
      contentType: "application/json",
      payload: JSON.stringify(body),
      muteHttpExceptions: true
    }
  );

  var result = parseJsonSafely_(response.getContentText(), {});
  var rawText = (((result.candidates || [])[0] || {}).content || {}).parts;
  rawText = rawText && rawText[0] ? rawText[0].text : "{}";
  var cleaned = trimString_(rawText).replace(/```json/g, "").replace(/```/g, "");
  return parseJsonSafely_(cleaned, {});
}

/**
 * OCR 生結果を台帳保存用の形式へ整える。
 * 日付、時刻、金額、カテゴリ、明細の表記ゆれを吸収し、不足値には既定値を入れる。
 *
 * Input:
 * - `rawReceipt`: OCR 生結果
 *
 * Output:
 * - 正規化済みレシートデータ
 */
function normalizeReceiptPayload_(rawReceipt) {
  var today = new Date();
  var year = trimString_(rawReceipt.year) || Utilities.formatDate(today, "Asia/Tokyo", "yyyy");
  var month = trimString_(rawReceipt.month) || Utilities.formatDate(today, "Asia/Tokyo", "MM");
  var day = trimString_(rawReceipt.day) || Utilities.formatDate(today, "Asia/Tokyo", "dd");
  var items = normalizeTransactionItems_(createId_("tmp"), rawReceipt.items || []);
  var total = toNumberOrZero_(rawReceipt.total);

  if (!total) {
    total = recalculateTotalFromItems_(items);
  }

  return {
    store_name: trimString_(rawReceipt.store_name) || "店舗名未取得",
    store_address: trimString_(rawReceipt.store_address) || "unknown",
    phone_number: trimString_(rawReceipt.phone_number) || "unknown",
    receipt_number: trimString_(rawReceipt.receipt_number),
    date: normalizeDateString_(year, month, day),
    time: normalizeTimeString_(rawReceipt.time),
    subtotal: toNumberOrZero_(rawReceipt.subtotal),
    tax: toNumberOrZero_(rawReceipt.tax),
    total: total,
    payment_method: trimString_(rawReceipt.payment_method) || "不明",
    change: toNumberOrZero_(rawReceipt.change),
    category: trimString_(rawReceipt.category),
    items: items.map(function (item) {
      return {
        name: item.name,
        quantity: item.quantity,
        unit_price: item.unit_price,
        line_amount: item.line_amount
      };
    }),
    raw_json: rawReceipt
  };
}

/**
 * 店舗名や住所から緯度経度を取得する。
 * 住所未解決でも処理全体を止めず、`unknown` を返して保存を継続する。
 *
 * Input:
 * - `queryText`: 店舗名または住所
 *
 * Output:
 * - `{ address, latitude, longitude }`
 */
function geocodeQuery_(queryText) {
  var query = trimString_(queryText);
  if (!query) {
    return { address: "unknown", latitude: "unknown", longitude: "unknown" };
  }

  try {
    var geocoder = Maps.newGeocoder();
    geocoder.setLanguage("ja");
    var response = geocoder.geocode(query);
    if (response.results && response.results[0]) {
      return {
        address: response.results[0].formatted_address,
        latitude: response.results[0].geometry.location.lat,
        longitude: response.results[0].geometry.location.lng
      };
    }
  } catch (error) {
    appendSystemLog_("WARN", "geocodeQuery_", "", error.message, query);
  }

  return { address: "unknown", latitude: "unknown", longitude: "unknown" };
}

/**
 * Google カレンダーの説明文を生成する。
 *
 * Input:
 * - `transaction`: 取引データ
 *
 * Output:
 * - 説明文文字列
 */
function buildCalendarDescription_(transaction) {
  return [
    "金額: " + transaction.amount_total + "円",
    "カテゴリ: " + [transaction.category_main, transaction.category_sub, transaction.category_detail].filter(Boolean).join(" > "),
    "登録方法: " + transaction.input_channel,
    transaction.source_message ? "元データ: " + transaction.source_message : ""
  ].filter(Boolean).join("\n");
}

/**
 * 取引内容を Google カレンダーへ登録または更新する。
 *
 * Input:
 * - `transaction`: 取引データ
 *
 * Output:
 * - `{ status, eventId, error? }`
 */
function syncCalendarEvent_(transaction) {
  var calendarId = trimString_(getSetting_("calendar_id", ""));
  if (!calendarId) {
    appendCalendarSyncLog_(transaction.transaction_id, "skip", "skipped", "", "calendar_id is not configured");
    return { status: "skipped", eventId: "" };
  }

  try {
    var calendar = CalendarApp.getCalendarById(calendarId);
    if (!calendar) throw new Error("Calendar not found: " + calendarId);

    var startAt = new Date(transaction.date + "T" + normalizeTimeString_(transaction.time) + "+09:00");
    if (isNaN(startAt.getTime())) {
      throw new Error("Invalid date or time: " + transaction.date + " " + transaction.time);
    }
    var endAt = new Date(startAt.getTime() + 10 * 60 * 1000);

    var event = null;
    if (trimString_(transaction.calendar_event_id)) {
      event = calendar.getEventById(transaction.calendar_event_id);
    }

    if (event) {
      event.setTitle(transaction.store_name || "支出記録");
      event.setTime(startAt, endAt);
      event.setLocation(transaction.store_address || "");
      event.setDescription(buildCalendarDescription_(transaction));
      appendCalendarSyncLog_(transaction.transaction_id, "update", "success", event.getId(), "");
      return { status: "updated", eventId: event.getId() };
    }

    event = calendar.createEvent(transaction.store_name || "支出記録", startAt, endAt, {
      description: buildCalendarDescription_(transaction),
      location: transaction.store_address || ""
    });
    appendCalendarSyncLog_(transaction.transaction_id, "create", "success", event.getId(), "");
    return { status: "created", eventId: event.getId() };
  } catch (error) {
    appendCalendarSyncLog_(transaction.transaction_id, "create", "failed", transaction.calendar_event_id || "", error.message);
    return { status: "failed", eventId: transaction.calendar_event_id || "", error: error.message };
  }
}

/**
 * 手入力完了時に返す確認メッセージを作る。
 *
 * Input:
 * - `transaction`: 確定した取引
 *
 * Output:
 * - 返信文字列
 */
function formatManualConfirmationText_(transaction) {
  return [
    "手入力の家計データを登録しました。",
    "日付: " + transaction.date,
    "金額: " + transaction.amount_total + "円",
    "カテゴリ: " + [transaction.category_main, transaction.category_sub, transaction.category_detail].join(" > "),
    "店舗/場所: " + (transaction.store_name || transaction.store_address || "未設定")
  ].join("\n");
}

/**
 * レシート登録完了時に返す確認メッセージを作る。
 *
 * Input:
 * - `transaction`: 保存済み取引
 * - `items`: 明細配列
 *
 * Output:
 * - 返信文字列
 */
function formatReceiptConfirmationText_(transaction, items) {
  var itemLines = (items || []).slice(0, 5).map(function (item) {
    return "・" + item.name + " x" + item.quantity + " / " + item.line_amount + "円";
  });

  return [
    "レシートを登録しました。",
    "店舗: " + transaction.store_name,
    "日付: " + transaction.date + " " + transaction.time,
    "合計: " + transaction.amount_total + "円",
    "カテゴリ: " + [transaction.category_main, transaction.category_sub, transaction.category_detail].join(" > ")
  ].concat(itemLines).join("\n");
}
