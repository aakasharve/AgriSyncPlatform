/**
 * ShramSafal — "पहिला जबाबदार गट" waitlist receiver.
 *
 * Paste into the Apps Script editor, run testSetup() once, then deploy as a
 * Web app (Execute as: Me — Who has access: Anyone).
 *
 * WHY openById AND NOT getActiveSpreadsheet:
 *   getActiveSpreadsheet() means "the sheet this script is attached to", and
 *   returns null in a standalone project created at script.google.com. Opening
 *   by id works in both standalone and sheet-bound projects, so the script
 *   cannot break depending on how the project happened to be created.
 *
 * WHY THE SITE POSTS text/plain AND NOT application/json:
 *   A JSON content-type makes the browser send a CORS preflight (OPTIONS)
 *   request first. Apps Script web apps do not answer OPTIONS, so the POST
 *   would never arrive. text/plain is a "simple request" and skips it. The
 *   body is still JSON; this parses it as such.
 *
 * WHY IT ALWAYS RETURNS ok:true/false:
 *   The farmer must only see a thank-you when a row was really written.
 *   Every path returns a result — never silence.
 */

// The Google Sheet that receives submissions.
// https://docs.google.com/spreadsheets/d/<THIS PART>/edit
// The real ID lives only in the deployed Apps Script project ("Website
// Inbound"); it is kept out of this public repo because the sheet holds
// farmers' phone numbers.
var SPREADSHEET_ID = 'PASTE_SHEET_ID_HERE';

var SHEET_NAME = 'Waitlist';

// Accepted fields, in sheet column order. Anything not listed is ignored, so a
// stray field cannot shift the columns.
var FIELDS = [
  ['name',      'नाव / Name'],
  ['mobile',    'मोबाईल / Mobile'],
  ['district',  'जिल्हा / District'],
  ['village',   'गाव / Village'],
  ['farm-size', 'शेतीचा आकार / Farm size'],
  ['crop',      'पीक / Crop'],
  ['role',      'भूमिका / Role'],
  ['labour',    'मजूर व्यवस्थापन / Manages labour']
];

/**
 * RUN THIS ONCE from the editor.
 * It triggers the Google permission prompt, proves the sheet is reachable,
 * and creates the Waitlist tab with its header row.
 */
function testSetup() {
  var sheet = getSheet();
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  Logger.log('OK — connected to spreadsheet: "%s"', ss.getName());
  Logger.log('OK — tab ready: "%s"', sheet.getName());
  Logger.log('Rows currently in the tab (including header): %s', sheet.getLastRow());
  Logger.log('Setup complete. You can deploy now.');
  return 'ok';
}

function doPost(e) {
  var lock = LockService.getScriptLock();
  try {
    // Serialise writes so two submissions at the same moment cannot collide.
    lock.waitLock(20000);

    if (!e || !e.postData || !e.postData.contents) {
      return reply(false, 'empty request');
    }

    var data;
    try {
      data = JSON.parse(e.postData.contents);
    } catch (err) {
      return reply(false, 'could not read submission');
    }

    // Honeypot: a hidden field real people never see. If it is filled, a bot
    // submitted the form. Answer ok so the bot moves on, but write nothing.
    if (data.company_website) {
      return reply(true, 'ok');
    }

    var name = String(data.name || '').trim();
    var mobile = String(data.mobile || '').trim();
    if (!name || !mobile) {
      return reply(false, 'name and mobile are required');
    }

    var sheet = getSheet();

    var row = [new Date()];
    for (var i = 0; i < FIELDS.length; i++) {
      row.push(String(data[FIELDS[i][0]] || '').trim());
    }
    row.push(String(data.language || ''));

    sheet.appendRow(row);
    return reply(true, 'saved');

  } catch (err) {
    return reply(false, String(err));
  } finally {
    try { lock.releaseLock(); } catch (ignored) {}
  }
}

/** Health check: opening the web app URL in a browser should show ok:true. */
function doGet() {
  return reply(true, 'ShramSafal waitlist endpoint is live');
}

function getSheet() {
  var ss = SpreadsheetApp.openById(SPREADSHEET_ID);
  var sheet = ss.getSheetByName(SHEET_NAME);

  if (!sheet) {
    sheet = ss.insertSheet(SHEET_NAME);
  }

  // Write the header row once, then freeze it.
  if (sheet.getLastRow() === 0) {
    var headers = ['वेळ / Timestamp'];
    for (var i = 0; i < FIELDS.length; i++) {
      headers.push(FIELDS[i][1]);
    }
    headers.push('भाषा / Language');

    sheet.appendRow(headers);
    sheet.getRange(1, 1, 1, headers.length).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }

  return sheet;
}

function reply(ok, message) {
  return ContentService
    .createTextOutput(JSON.stringify({ ok: ok, message: message }))
    .setMimeType(ContentService.MimeType.JSON);
}
