/**
 * VoiceChatLearnLanguage — Apps Script starter, v0.1
 *
 * WARNING: this is only the M3 foundation. Full CRUD, reviews, export, robust recovery,
 * automated dispatch, tests and production hardening are NOT IMPLEMENTED.
 * See docs/05_APPS_SCRIPT_SETUP.md and docs/09_DATA_SCHEMA.md.
 */

var ACTION_UPSERT = 'vocabulary.upsert';

/** Entry point: only HMAC-signed Worker requests may change the spreadsheet. */
function doPost(e) {
  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: { code: 'EMPTY_BODY' } });
    }
    var body = JSON.parse(e.postData.contents);
    if (typeof body.payload !== 'string' || typeof body.signature !== 'string') {
      return jsonResponse_({ ok: false, error: { code: 'INVALID_ENVELOPE' } });
    }
    if (body.payload.length > 12000) {
      return jsonResponse_({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE' } });
    }

    var props = PropertiesService.getScriptProperties();
    var sharedSecret = props.getProperty('GAS_SHARED_SECRET');
    var sheetId = props.getProperty('SHEET_ID');
    var ownerUserId = props.getProperty('OWNER_USER_ID');
    var maxAge = Number(props.getProperty('MAX_EVENT_AGE_SECONDS') || '300');
    if (!sharedSecret || !sheetId || !ownerUserId || !(maxAge > 0 && maxAge <= 3600)) {
      return jsonResponse_({ ok: false, error: { code: 'NOT_CONFIGURED' } });
    }
    if (!verifySignature_(body.payload, body.signature, sharedSecret)) {
      return jsonResponse_({ ok: false, error: { code: 'INVALID_SIGNATURE' } });
    }

    var event = JSON.parse(body.payload);
    if (!event || event.action !== ACTION_UPSERT) {
      return jsonResponse_({ ok: false, error: { code: 'ACTION_NOT_IMPLEMENTED' } });
    }
    if (!/^[a-zA-Z0-9:_-]{12,128}$/.test(String(event.event_id || ''))) {
      return jsonResponse_({ ok: false, error: { code: 'INVALID_EVENT_ID' } });
    }
    if (event.user_id !== ownerUserId) {
      return jsonResponse_({ ok: false, error: { code: 'FORBIDDEN' } });
    }
    var issuedMs = Date.parse(String(event.issued_at || ''));
    if (!isFinite(issuedMs) || Math.abs(Date.now() - issuedMs) > maxAge * 1000) {
      return jsonResponse_({ ok: false, error: { code: 'EXPIRED_EVENT' } });
    }

    var result = upsertWord_(SpreadsheetApp.openById(sheetId), event);
    return jsonResponse_({ ok: true, data: result });
  } catch (err) {
    // Never print full request, secret or transcript. Do not expose stack to callers.
    console.error('GAS_doPost_failed', String(err && err.message || 'unknown').slice(0, 120));
    return jsonResponse_({ ok: false, error: { code: 'INTERNAL_ERROR' } });
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifySignature_(payload, incomingSignature, secret) {
  var raw = Utilities.computeHmacSha256Signature(payload, secret, Utilities.Charset.UTF_8);
  var expected = Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
  // Length-constant comparison for known-size HMAC; GAS runtime cannot promise strict constant timing.
  var actual = String(incomingSignature || '').replace(/=+$/, '');
  if (actual.length !== expected.length) return false;
  var difference = 0;
  for (var i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return difference === 0;
}

/**
 * A limited single-user Sheet upsert. Spreadsheet edits are NOT ACID transactions;
 * a crash between Words/Events writes needs reconciliation (M3-04).
 */
function upsertWord_(ss, event) {
  var d = event.data || {};
  var word = checkedText_(d.word, 120, true);
  var lemma = checkedText_(d.lemma || d.word, 120, true);
  var pos = checkedText_(d.part_of_speech || 'unknown', 32, true).toLowerCase();
  var sense = checkedText_(d.sense_key || 'default', 100, true).toLowerCase();
  var meaning = checkedText_(d.meaning_vi || '', 300, false);
  var example = checkedText_(d.example || '', 500, false);
  var sourceExcerpt = checkedText_(d.source_excerpt || '', 500, false);
  var wordKey = [event.user_id, norm_(lemma), norm_(pos), norm_(sense)].join('|');
  var now = new Date().toISOString();
  var words = ss.getSheetByName('Words');
  var events = ss.getSheetByName('Events');
  if (!words || !events) throw new Error('Missing Words/Events tabs');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var eh = headerMap_(events);
    var wh = headerMap_(words);
    requireColumns_(eh, ['event_id','event_type','user_id','entity_id','occurred_at','created_at','request_id','payload_hash','result_code']);
    requireColumns_(wh, ['word_id','user_id','word_key','word','lemma','part_of_speech','sense_key','meaning_vi','ipa','example','source_excerpt','created_at','last_asked_at','times_asked','review_state','repetitions','interval_days','ease_factor','due_at','last_reviewed_at','version','deleted_at']);

    var eventRow = findRow_(events, eh['event_id'], String(event.event_id));
    if (eventRow > 0) {
      var existingEntity = String(events.getRange(eventRow, eh['entity_id']).getValue());
      return { word_id: existingEntity, duplicate_event: true, created: false };
    }
    var wordRow = findRow_(words, wh['word_key'], wordKey);
    var id;
    var created;
    if (wordRow > 0) {
      id = String(words.getRange(wordRow, wh['word_id']).getValue());
      var count = Number(words.getRange(wordRow, wh['times_asked']).getValue() || 0);
      var version = Number(words.getRange(wordRow, wh['version']).getValue() || 0);
      words.getRange(wordRow, wh['last_asked_at']).setValue(now);
      words.getRange(wordRow, wh['times_asked']).setValue(count + 1);
      words.getRange(wordRow, wh['version']).setValue(version + 1);
      created = false;
    } else {
      id = 'w_' + Utilities.getUuid();
      created = true;
      appendMapped_(words, wh, {
        word_id: id, user_id: event.user_id, word_key: wordKey, word: safeCell_(word),
        lemma: safeCell_(lemma), part_of_speech: pos, sense_key: safeCell_(sense),
        meaning_vi: safeCell_(meaning), ipa: '', example: safeCell_(example),
        source_excerpt: safeCell_(sourceExcerpt), created_at: now, last_asked_at: now,
        times_asked: 1, review_state: 'new', repetitions: 0,
        interval_days: 0, ease_factor: 2.5, due_at: now,
        last_reviewed_at: '', version: 1, deleted_at: ''
      });
    }
    appendMapped_(events, eh, {
      event_id: String(event.event_id), event_type: ACTION_UPSERT,
      user_id: event.user_id, entity_id: id,
      occurred_at: String(event.issued_at), created_at: now,
      request_id: safeCell_(String(event.request_id || '').slice(0, 80)),
      payload_hash: '', result_code: created ? 'CREATED' : 'UPDATED'
    });
    SpreadsheetApp.flush();
    return { word_id: id, duplicate_event: false, created: created };
  } finally {
    lock.releaseLock();
  }
}

function checkedText_(value, max, required) {
  if (typeof value !== 'string') throw new Error('Invalid text field');
  var s = value.trim();
  if (s.length > max || (required && !s)) throw new Error('Invalid field length');
  return s;
}
function norm_(value) {
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function safeCell_(value) {
  var s = String(value);
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}
function headerMap_(sheet) {
  var cols = sheet.getLastColumn();
  if (cols < 1) throw new Error('Missing header');
  var values = sheet.getRange(1, 1, 1, cols).getValues()[0];
  var map = {};
  values.forEach(function (name, i) { if (name) map[String(name)] = i + 1; });
  return map;
}
function requireColumns_(map, names) {
  names.forEach(function (n) { if (!map[n]) throw new Error('Column missing: ' + n); });
}
function findRow_(sheet, column, expected) {
  var last = sheet.getLastRow();
  if (last <= 1) return -1;
  var data = sheet.getRange(2, column, last - 1, 1).getValues();
  for (var i = 0; i < data.length; i++) {
    if (String(data[i][0]) === expected) return i + 2;
  }
  return -1;
}
function appendMapped_(sheet, headers, entry) {
  var cols = sheet.getLastColumn();
  var row = Array(cols).fill('');
  Object.keys(entry).forEach(function (k) {
    if (headers[k]) row[headers[k] - 1] = entry[k];
  });
  sheet.appendRow(row);
}
