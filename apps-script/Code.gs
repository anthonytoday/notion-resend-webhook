/**
 * Google Apps Script Web App — receives the raw Notion payload from the worker.
 *
 * CONTRACT: the worker forwards Notion's payload unchanged:
 *   { customerEmail, templateName, customerName, ... }
 * The previous version of this file expected { row: [...] } and would have
 * silently failed on every request. Do not reintroduce that shape without
 * changing the worker to match.
 *
 * Bound to: https://docs.google.com/spreadsheets/d/1lg8loH7k0lTAS9cactKlbJ0Tbb1gEtG_6x8Af0sKfBg
 *
 * Setup:
 *   1. That Sheet -> Extensions -> Apps Script -> paste this file.
 *   2. Deploy -> New deployment -> Web app. Execute as: Me. Access: Anyone.
 *   3. Copy the /exec URL into the GSHEET_WEBHOOK_URL repo secret.
 */

const SHEET_NAME = 'Downloads';
const HEADERS = [
  'Timestamp (UTC)', 'Email', 'Name', 'Template', 'Event', 'Raw payload'
];

function doPost(e) {
  try {
    const raw = (e && e.postData && e.postData.contents) || '{}';
    let body = {};
    try { body = JSON.parse(raw); } catch (err) { body = {}; }

    // Back-compat: accept the older { row: [...] } shape if anything still sends it.
    if (Array.isArray(body.row)) {
      sheet_().appendRow(body.row);
      return json_({ ok: true, mode: 'row' });
    }

    const email = String(body.customerEmail || body.email || '').trim().toLowerCase();
    const name = String(body.customerName || body.name || '');
    const template = String(body.templateName || body.template || '');
    const event = String(body.type || body.event || 'download');

    sheet_().appendRow([
      new Date().toISOString(), email, name, template, event, raw
    ]);

    return json_({ ok: true, email: email });
  } catch (err) {
    return json_({ ok: false, error: String(err) });
  }
}

function sheet_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  let sheet = ss.getSheetByName(SHEET_NAME);
  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
    sheet.appendRow(HEADERS);
    sheet.setFrozenRows(1);
  }
  return sheet;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function doGet() {
  return json_({ ok: true, service: 'sheets-receiver' });
}
