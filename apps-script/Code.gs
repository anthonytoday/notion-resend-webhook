/**
 * Google Apps Script Web App — receives rows from the Cloudflare Worker.
 *
 * Use this if SHEETS_MODE = "apps_script" (recommended: no service account,
 * no private key in Cloudflare, no OAuth token exchange).
 *
 * Setup:
 *   1. Open the reporting Google Sheet -> Extensions -> Apps Script.
 *   2. Paste this file, replace SHEET_NAME if your tab is not "Downloads".
 *   3. Deploy -> New deployment -> Web app.
 *        Execute as: Me
 *        Who has access: Anyone
 *   4. Copy the /exec URL -> that is SHEETS_WEBAPP_URL.
 *   5. Set SHARED_SECRET below to the same value as the worker's WEBHOOK_SECRET.
 */

const SHEET_NAME = 'Downloads';
const SHARED_SECRET = 'PASTE_SAME_VALUE_AS_WEBHOOK_SECRET';

function doPost(e) {
  try {
    const body = JSON.parse(e.postData.contents);

    if (SHARED_SECRET !== 'PASTE_SAME_VALUE_AS_WEBHOOK_SECRET') {
      const provided = (body.secret || (e.parameter && e.parameter.token) || '');
      if (provided !== SHARED_SECRET) {
        return ContentService.createTextOutput(
          JSON.stringify({ ok: false, error: 'unauthorized' })
        ).setMimeType(ContentService.MimeType.JSON);
      }
    }

    const ss = SpreadsheetApp.getActiveSpreadsheet();
    let sheet = ss.getSheetByName(SHEET_NAME);

    if (!sheet) {
      sheet = ss.insertSheet(SHEET_NAME);
      sheet.appendRow([
        'Timestamp',
        'Email',
        'First Name',
        'Template',
        'Category',
        'Source',
        'Event ID',
      ]);
    }

    sheet.appendRow(body.row);

    return ContentService.createTextOutput(JSON.stringify({ ok: true })).setMimeType(
      ContentService.MimeType.JSON
    );
  } catch (err) {
    return ContentService.createTextOutput(
      JSON.stringify({ ok: false, error: String(err) })
    ).setMimeType(ContentService.MimeType.JSON);
  }
}

function doGet() {
  return ContentService.createTextOutput(JSON.stringify({ ok: true, service: 'sheets-receiver' }))
    .setMimeType(ContentService.MimeType.JSON);
}
