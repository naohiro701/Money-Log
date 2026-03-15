/**
 * HouseholdAccount が使用するシート名とヘッダー定義。
 * ここで定義した順序を基準に、スプレッドシートの列構成を固定する。
 */
var V3_SHEET_HEADERS = {
  transactions: [
    "transaction_id",
    "event_id",
    "user_id",
    "input_channel",
    "status",
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
    "source_message",
    "calendar_event_id",
    "created_at",
    "updated_at"
  ],
  transaction_items: [
    "item_id",
    "transaction_id",
    "name",
    "quantity",
    "unit_price",
    "line_amount"
  ],
  system_logs: [
    "log_id",
    "timestamp",
    "level",
    "module",
    "event_id",
    "message",
    "payload_snippet"
  ],
  audit_logs: [
    "audit_id",
    "timestamp",
    "transaction_id",
    "action",
    "before_json",
    "after_json",
    "actor_user_id"
  ],
  calendar_sync_logs: [
    "sync_log_id",
    "timestamp",
    "transaction_id",
    "sync_action",
    "sync_status",
    "calendar_event_id",
    "error_message"
  ],
  user_status: [
    "user_id",
    "transaction_id",
    "step",
    "amount_total",
    "category_main",
    "category_sub",
    "updated_at"
  ],
  processed_events: [
    "event_id",
    "transaction_id",
    "channel",
    "created_at"
  ]
};

/**
 * 現在の Apps Script が紐づいているスプレッドシートを返す。
 *
 * Input: なし
 * Output: `Spreadsheet`
 */
function getV3Spreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

/**
 * 本システムが必要とするシートをすべて存在させる。
 * `doGet` と `doPost` の最初で呼び、初回実行時でも保存処理を失敗させない。
 *
 * Input: なし
 * Output: なし
 */
function ensureV3Sheets_() {
  var sheetNames = Object.keys(V3_SHEET_HEADERS);
  sheetNames.forEach(function (sheetName) {
    getOrCreateSheet_(sheetName, V3_SHEET_HEADERS[sheetName]);
  });
}

/**
 * 指定したシートを取得し、存在しない場合は作成する。
 * ヘッダー行が未作成であれば、1行目へヘッダーを書き込む。
 *
 * Input:
 * - `sheetName`: シート名
 * - `headers`: 1行目へ書く列名一覧
 *
 * Output:
 * - `Sheet`
 */
function getOrCreateSheet_(sheetName, headers) {
  var spreadsheet = getV3Spreadsheet_();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.appendRow(headers);
  }

  return sheet;
}

/**
 * 設定値を保存しているシートを取得する。
 * `setting` を優先し、互換のため `settings` も許可する。
 *
 * Input: なし
 * Output:
 * - `Sheet`
 * - 設定シートが無い場合は `null`
 */
function getSettingsSheet_() {
  var spreadsheet = getV3Spreadsheet_();
  return spreadsheet.getSheetByName("setting") || spreadsheet.getSheetByName("settings");
}

/**
 * 設定シートを `key -> value` のオブジェクトへ変換する。
 *
 * Input: なし
 * Output:
 * - `{ key: value }`
 */
function getSettingsMap_() {
  var sheet = getSettingsSheet_();
  var map = {};
  if (!sheet || sheet.getLastRow() < 1) return map;

  var values = sheet.getDataRange().getValues();
  values.forEach(function (row) {
    var key = trimString_(row[0]);
    if (!key) return;
    map[key] = row[1];
  });
  return map;
}

/**
 * 旧セル参照形式の設定値を読み出す。
 * 既存運用からの移行時に、設定シートを書き換える前でも動作させるために使う。
 *
 * Input: なし
 * Output:
 * - `{ line_channel_access_token, gemini_api_key, receipt_drive_folder_id }`
 */
function getLegacySettingMap_() {
  var sheet = getSettingsSheet_();
  if (!sheet) return {};

  return {
    line_channel_access_token: safeCellValue_(sheet, 1, 2),
    gemini_api_key: safeCellValue_(sheet, 3, 2),
    receipt_drive_folder_id: safeCellValue_(sheet, 8, 2)
  };
}

/**
 * 指定キーの設定値を返す。
 * 新形式の `setting` シートを優先し、値が無い場合のみ旧形式へフォールバックする。
 *
 * Input:
 * - `key`: 取得したい設定名
 * - `fallbackValue`: どこにも値が無い場合の既定値
 *
 * Output:
 * - 設定値
 */
function getSetting_(key, fallbackValue) {
  var settingsMap = getSettingsMap_();
  if (settingsMap.hasOwnProperty(key) && trimString_(settingsMap[key]) !== "") {
    return settingsMap[key];
  }

  var legacyMap = getLegacySettingMap_();
  if (legacyMap.hasOwnProperty(key) && trimString_(legacyMap[key]) !== "") {
    return legacyMap[key];
  }

  return fallbackValue == null ? "" : fallbackValue;
}

/**
 * シートの指定セルを安全に読み出す。
 * 存在しない行や列を参照した場合は空文字を返す。
 *
 * Input:
 * - `sheet`: 対象シート
 * - `row`: 行番号
 * - `column`: 列番号
 *
 * Output:
 * - セル値または空文字
 */
function safeCellValue_(sheet, row, column) {
  if (!sheet) return "";
  if (sheet.getLastRow() < row || sheet.getLastColumn() < column) return "";
  return sheet.getRange(row, column).getValue();
}

/**
 * JSON 文字列を解析する。
 * 解析に失敗した場合は例外を投げず、呼び出し側が指定した代替値を返す。
 *
 * Input:
 * - `text`: JSON 文字列
 * - `fallbackValue`: 解析失敗時に返す値
 *
 * Output:
 * - 解析済みオブジェクト
 */
function parseJsonSafely_(text, fallbackValue) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallbackValue;
  }
}

/**
 * Apps Script の JSON レスポンスを作成する。
 *
 * Input:
 * - `payload`: レスポンス本文として返すオブジェクト
 *
 * Output:
 * - `TextOutput`
 */
function createJsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

/**
 * Apps Script のテキストレスポンスを作成する。
 *
 * Input:
 * - `text`: 返却文字列
 *
 * Output:
 * - `TextOutput`
 */
function createTextResponse_(text) {
  return ContentService.createTextOutput(text || "");
}

/**
 * 一意な識別子を生成する。
 * 取引、ログ、監査ログなど、シート上で主キーとして使う。
 *
 * Input:
 * - `prefix`: 種別名
 *
 * Output:
 * - 例: `tx_1710000000000_123456`
 */
function createId_(prefix) {
  return [prefix || "id", new Date().getTime(), Math.floor(Math.random() * 1000000)].join("_");
}

/**
 * 日時を ISO 文字列へ変換する。
 *
 * Input:
 * - `dateValue`: `Date`
 *
 * Output:
 * - ISO8601 文字列
 */
function toIsoString_(dateValue) {
  return (dateValue || new Date()).toISOString();
}

/**
 * 文字列の前後空白を除去し、`null` や `undefined` は空文字へ変換する。
 *
 * Input:
 * - 任意の値
 *
 * Output:
 * - 整形済み文字列
 */
function trimString_(value) {
  if (value == null) return "";
  return String(value).replace(/^\s+|\s+$/g, "");
}

/**
 * 数値として解釈できる値を数値へ変換する。
 * 変換できない場合は 0 を返す。
 *
 * Input:
 * - 任意の値
 *
 * Output:
 * - `number`
 */
function toNumberOrZero_(value) {
  var numberValue = Number(value);
  return isNaN(numberValue) ? 0 : numberValue;
}

/**
 * 文字列が半角数字のみで構成されているか判定する。
 * LINE 手入力で「金額入力かどうか」を見分けるために使う。
 *
 * Input:
 * - `value`: LINE のテキスト
 *
 * Output:
 * - `boolean`
 */
function isNumericText_(value) {
  return /^\d+$/.test(trimString_(value));
}

/**
 * 年・月・日を `YYYY-MM-DD` へそろえる。
 *
 * Input:
 * - `yearValue`, `monthValue`, `dayValue`
 *
 * Output:
 * - `YYYY-MM-DD`
 * - どれか欠けている場合は空文字
 */
function normalizeDateString_(yearValue, monthValue, dayValue) {
  var year = trimString_(yearValue);
  var month = ("0" + trimString_(monthValue)).slice(-2);
  var day = ("0" + trimString_(dayValue)).slice(-2);
  if (!year || !month || !day) return "";
  return [year, month, day].join("-");
}

/**
 * 時刻表記を `HH:mm:ss` にそろえる。
 * OCR 結果やフォーム入力の表記ゆれを吸収するために使う。
 *
 * Input:
 * - `value`: 時刻文字列
 *
 * Output:
 * - `HH:mm:ss`
 */
function normalizeTimeString_(value) {
  var text = trimString_(value);
  if (!text) return "12:00:00";

  if (/^\d{2}:\d{2}$/.test(text)) return text + ":00";
  if (/^\d{1,2}:\d{2}$/.test(text)) return ("0" + text).slice(-5) + ":00";
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) return ("0" + text).slice(-8);
  return "12:00:00";
}

/**
 * シートを行オブジェクトの配列として読み出す。
 * 内部的に更新行を特定するため、`__rowNumber` を追加して返す。
 *
 * Input:
 * - `sheetName`: 読み出すシート名
 *
 * Output:
 * - `[{ __rowNumber, ...columns }]`
 */
function readSheetRows_(sheetName) {
  var sheet = getOrCreateSheet_(sheetName, V3_SHEET_HEADERS[sheetName] || []);
  if (sheet.getLastRow() < 2) return [];

  var headers = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0];
  var values = sheet.getRange(2, 1, sheet.getLastRow() - 1, sheet.getLastColumn()).getValues();

  return values.map(function (row, index) {
    var obj = { __rowNumber: index + 2 };
    headers.forEach(function (header, columnIndex) {
      obj[header] = row[columnIndex];
    });
    return obj;
  });
}

/**
 * オブジェクトを、指定ヘッダー順の配列へ変換する。
 * シートへ1行書き込む前の共通処理として使う。
 *
 * Input:
 * - `headers`: 列順
 * - `rowObject`: 1行分のオブジェクト
 *
 * Output:
 * - 書き込み用配列
 */
function buildRowFromObject_(headers, rowObject) {
  return headers.map(function (header) {
    return rowObject.hasOwnProperty(header) ? rowObject[header] : "";
  });
}

/**
 * フロー関数の戻り値形式を統一する。
 * `processLineEvent_` が手入力フローと OCR フローを同じ形で扱えるようにするための関数。
 *
 * Input:
 * - `channel`: `manual` などの入力経路
 * - `transactionId`: 対象取引 ID
 * - `messages`: LINE 返信メッセージ配列または単体
 *
 * Output:
 * - `{ channel, transaction_id, messages }`
 */
function createHandlerResult_(channel, transactionId, messages) {
  var normalizedMessages = Array.isArray(messages) ? messages : [messages];
  return {
    channel: channel || "unknown",
    transaction_id: transactionId || "",
    messages: normalizedMessages.filter(function (message) {
      return !!message;
    })
  };
}

/**
 * LINE イベントから一意なイベント ID を取得する。
 * 冪等性管理のキーとして使う。
 *
 * Input:
 * - `eventObj`: LINE event object
 *
 * Output:
 * - イベント ID 文字列
 */
function getEventId_(eventObj) {
  return trimString_(
    (eventObj && eventObj.webhookEventId) ||
    (eventObj && eventObj.message && eventObj.message.id) ||
    (eventObj && eventObj.replyToken) ||
    createId_("event")
  );
}
