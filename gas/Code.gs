/**
 * Comment collection backend for the presenter danmaku.
 *
 * Bound to a Google Spreadsheet (sheet name: `comments`, columns: ts / text / color).
 * Deploy as a Web App ("Execute as: me", "Who has access: Anyone").
 *
 *   GET  …/exec                      -> the submission form (form.html)
 *   GET  …/exec?mode=feed&since=<id> -> JSON of comments with id > since
 *   submit(text, color)              -> appends one comment (called from form.html)
 *
 * `id` is the comment's timestamp (epoch ms from the `ts` column). The reader
 * passes back the latest id as `since` to fetch only new comments — that is how
 * duplicates are avoided. Timestamps only move forward, so clearing rows (even
 * mid-event) never makes ids go backwards and never breaks the reader's cursor.
 */

const SHEET_NAME = "comments";
const MAX_LEN = 60; // max characters per comment
const FEED_LIMIT = 200; // safety cap on rows returned per feed call

function sheet_() {
  return SpreadsheetApp.getActive().getSheetByName(SHEET_NAME);
}

function doGet(e) {
  const params = (e && e.parameter) || {};
  if (params.mode === "feed") return feed_(params);
  return HtmlService.createHtmlOutputFromFile("form")
    .setTitle("コメント送信フォーム")
    .addMetaTag("viewport", "width=device-width, initial-scale=1");
}

function feed_(params) {
  const since = Number(params.since) || 0;
  const sh = sheet_();
  const last = sh.getLastRow(); // includes header row 1
  const comments = [];
  let lastId = since; // newest id seen so far (never goes backwards)

  if (last >= 2) {
    const rows = sh.getRange(2, 1, last - 1, 3).getValues(); // ts, text, color
    rows.forEach(function (row) {
      const ts = row[0] instanceof Date ? row[0].getTime() : Number(row[0]);
      if (!ts) return;
      if (ts > lastId) lastId = ts;
      if (ts > since) {
        comments.push({
          id: ts,
          text: String(row[1]),
          color: row[2] ? String(row[2]) : null,
        });
      }
    });
  }

  comments.sort(function (a, b) {
    return a.id - b.id;
  });

  const body = JSON.stringify({
    comments: comments.slice(-FEED_LIMIT),
    lastId: lastId,
  });
  return ContentService.createTextOutput(body).setMimeType(ContentService.MimeType.JSON);
}

function submit(text, color) {
  const clean = String(text || "")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, MAX_LEN);
  if (!clean) throw new Error("empty");

  const lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    sheet_().appendRow([new Date(), clean, color || ""]);
  } finally {
    lock.releaseLock();
  }
  return true;
}
