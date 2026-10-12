// KELVIN COREX — Google Sheets storage bridge
// Replace the value below with the SAME private secret entered as Vercel SHEETS_API_KEY.
const API_KEY = 'LGp7eIJoy48NSt6qU6+9s/d3B7Xx1s+Eme7z3HZpqTA=';
const SHEET_NAME = 'Appointments';
const HEADERS = ['id', 'name', 'phone', 'service', 'date', 'time', 'status', 'createdAt', 'updatedAt'];

function setup() {
  const props = PropertiesService.getScriptProperties();
  let id = props.getProperty('SPREADSHEET_ID');
  let ss = id ? SpreadsheetApp.openById(id) : SpreadsheetApp.create('Kelvin Corex Appointments');
  props.setProperty('SPREADSHEET_ID', ss.getId());
  let sheet = ss.getSheetByName(SHEET_NAME) || ss.insertSheet(SHEET_NAME);
  if (sheet.getLastRow() === 0) sheet.appendRow(HEADERS);
  Logger.log('Setup complete. Spreadsheet URL: ' + ss.getUrl());
  return ss.getUrl();
}

function doGet() {
  return output_({ ok: true, message: 'Kelvin Corex Sheets bridge is ready.' });
}

function doPost(e) {
  const lock = LockService.getScriptLock();
  let locked = false;
  try {
    const raw = e && e.postData && e.postData.contents ? e.postData.contents : '{}';
    const body = JSON.parse(raw);
    if (!API_KEY || API_KEY.indexOf('CHANGE_THIS_') === 0 || body.key !== API_KEY) {
      return output_({ error: 'Unauthorized Sheets bridge request. Check SHEETS_API_KEY and Code.gs API_KEY.' });
    }
    const ssId = PropertiesService.getScriptProperties().getProperty('SPREADSHEET_ID');
    if (!ssId) return output_({ error: 'Run setup() once in the Apps Script editor before using the booking app.' });
    const ss = SpreadsheetApp.openById(ssId);
    const sheet = ss.getSheetByName(SHEET_NAME);
    if (!sheet) return output_({ error: 'Appointments sheet missing. Run setup() again.' });
    const rows = readAppointments_(sheet);
    const action = String(body.action || '');

    if (action === 'list') return output_({ appointments: rows });

    if (action === 'create') {
      const a = body.appointment || {};
      const conflict = rows.find(x => x.date === String(a.date) && x.time === String(a.time) && x.status === 'approved');
      if (conflict) return output_({ error: 'This time slot is already booked. Please choose another time.' });
      lock.waitLock(10000); locked = true;
      // Recheck while holding the lock to reduce double-booking races.
      const freshRows = readAppointments_(sheet);
      const freshConflict = freshRows.find(x => x.date === String(a.date) && x.time === String(a.time) && x.status === 'approved');
      if (freshConflict) return output_({ error: 'This time slot is already booked. Please choose another time.' });
      sheet.appendRow(HEADERS.map(h => a[h] == null ? '' : a[h]));
      return output_({ success: true, appointment: a });
    }

    if (action === 'approve' || action === 'reject') {
      lock.waitLock(10000); locked = true;
      const freshRows = readAppointments_(sheet);
      const index = freshRows.findIndex(x => String(x.id) === String(body.id));
      if (index < 0) return output_({ error: 'Appointment not found.' });
      const current = freshRows[index];
      if (action === 'approve') {
        const conflict = freshRows.find(x => String(x.id) !== String(current.id) && x.date === current.date && x.time === current.time && x.status === 'approved');
        if (conflict) return output_({ error: 'That time slot is already approved for another customer.' });
      }
      current.status = action === 'approve' ? 'approved' : 'rejected';
      current.updatedAt = new Date().toISOString();
      sheet.getRange(index + 2, 1, 1, HEADERS.length).setValues([HEADERS.map(h => current[h] == null ? '' : current[h])]);
      return output_({ success: true, appointment: current });
    }

    if (action === 'delete') {
      lock.waitLock(10000); locked = true;
      const freshRows = readAppointments_(sheet);
      const index = freshRows.findIndex(x => String(x.id) === String(body.id));
      if (index < 0) return output_({ error: 'Appointment not found.' });
      sheet.deleteRow(index + 2);
      return output_({ success: true });
    }
    return output_({ error: 'Unknown action.' });
  } catch (err) {
    return output_({ error: String(err && err.message ? err.message : err) });
  } finally {
    if (locked) { try { lock.releaseLock(); } catch (_) {} }
  }
}

function readAppointments_(sheet) {
  const values = sheet.getDataRange().getValues();
  if (values.length <= 1) return [];
  const headers = values[0].map(String);
  return values.slice(1).filter(row => row.some(cell => cell !== '')).map(row => {
    const obj = {};
    headers.forEach((h, i) => obj[h] = row[i] instanceof Date ? row[i].toISOString() : String(row[i] == null ? '' : row[i]));
    return obj;
  });
}

function output_(data) {
  return ContentService.createTextOutput(JSON.stringify(data)).setMimeType(ContentService.MimeType.JSON);
}
