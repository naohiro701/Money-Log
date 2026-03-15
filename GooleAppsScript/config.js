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

function getV3Spreadsheet_() {
  return SpreadsheetApp.getActiveSpreadsheet();
}

function ensureV3Sheets_() {
  var sheetNames = Object.keys(V3_SHEET_HEADERS);
  sheetNames.forEach(function (sheetName) {
    getOrCreateSheet_(sheetName, V3_SHEET_HEADERS[sheetName]);
  });
}

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

function getSettingsSheet_() {
  var spreadsheet = getV3Spreadsheet_();
  return spreadsheet.getSheetByName("setting") || spreadsheet.getSheetByName("settings");
}

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

function getLegacySettingMap_() {
  var sheet = getSettingsSheet_();
  if (!sheet) return {};

  return {
    line_channel_access_token: safeCellValue_(sheet, 1, 2),
    gemini_api_key: safeCellValue_(sheet, 3, 2),
    receipt_drive_folder_id: safeCellValue_(sheet, 8, 2)
  };
}

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

function safeCellValue_(sheet, row, column) {
  if (!sheet) return "";
  if (sheet.getLastRow() < row || sheet.getLastColumn() < column) return "";
  return sheet.getRange(row, column).getValue();
}

function parseJsonSafely_(text, fallbackValue) {
  try {
    return JSON.parse(text);
  } catch (error) {
    return fallbackValue;
  }
}

function createJsonResponse_(payload) {
  return ContentService.createTextOutput(JSON.stringify(payload))
    .setMimeType(ContentService.MimeType.JSON);
}

function createTextResponse_(text) {
  return ContentService.createTextOutput(text || "");
}

function createId_(prefix) {
  return [prefix || "id", new Date().getTime(), Math.floor(Math.random() * 1000000)].join("_");
}

function toIsoString_(dateValue) {
  return (dateValue || new Date()).toISOString();
}

function trimString_(value) {
  if (value == null) return "";
  return String(value).replace(/^\s+|\s+$/g, "");
}

function toNumberOrZero_(value) {
  var numberValue = Number(value);
  return isNaN(numberValue) ? 0 : numberValue;
}

function isNumericText_(value) {
  return /^\d+$/.test(trimString_(value));
}

function normalizeDateString_(yearValue, monthValue, dayValue) {
  var year = trimString_(yearValue);
  var month = ("0" + trimString_(monthValue)).slice(-2);
  var day = ("0" + trimString_(dayValue)).slice(-2);
  if (!year || !month || !day) return "";
  return [year, month, day].join("-");
}

function normalizeTimeString_(value) {
  var text = trimString_(value);
  if (!text) return "12:00:00";

  if (/^\d{2}:\d{2}$/.test(text)) return text + ":00";
  if (/^\d{1,2}:\d{2}$/.test(text)) return ("0" + text).slice(-5) + ":00";
  if (/^\d{2}:\d{2}:\d{2}$/.test(text)) return text;
  if (/^\d{1,2}:\d{2}:\d{2}$/.test(text)) return ("0" + text).slice(-8);
  return "12:00:00";
}

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

function buildRowFromObject_(headers, rowObject) {
  return headers.map(function (header) {
    return rowObject.hasOwnProperty(header) ? rowObject[header] : "";
  });
}

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

function getEventId_(eventObj) {
  return trimString_(
    (eventObj && eventObj.webhookEventId) ||
    (eventObj && eventObj.message && eventObj.message.id) ||
    (eventObj && eventObj.replyToken) ||
    createId_("event")
  );
}

