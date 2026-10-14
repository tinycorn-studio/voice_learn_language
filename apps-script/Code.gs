/**
 * VoiceChatLearnLanguage — Google Apps Script Web App (`doPost`), v1.0
 *
 * Source of truth in Git (`apps-script/Code.gs`). Managed via `@google/clasp`.
 * Implements HMAC-SHA256 verification, timestamp replay window, `LockService.getScriptLock()`,
 * `event_id` idempotency, spreadsheet formula-injection protection, vocabulary CRUD,
 * deterministic SRS scoring (`docs/16_SRS.md`), and daily digest claiming (`docs/09_DATA_SCHEMA.md`).
 */

var ACTION_UPSERT = 'vocabulary.upsert';
var ACTION_LIST = 'vocabulary.list';
var ACTION_UPDATE = 'vocabulary.update';
var ACTION_DELETE = 'vocabulary.delete';
var ACTION_CARD_GET = 'card.get';
var ACTION_REVIEW_LIST_DUE = 'review.listDue';
var ACTION_REVIEW_PREVIEW = 'review.preview';
var ACTION_REVIEW_RECORD = 'review.record';
var ACTION_REVIEW_LOOKUP = 'review.lookup';
var ACTION_REVIEW_STATS = 'review.stats';
var ACTION_REVIEW_CLAIM_DIGEST = 'review.claimDigest';
var ACTION_REVIEW_FINISH_DIGEST = 'review.finishDigest';
var ACTION_USER_PREFERENCES = 'user.preferences';
var ACTION_MIGRATION_V3 = 'migration.schemaV3';

var WORDS_COLUMNS = [
  'word_id', 'user_id', 'word_key', 'word', 'lemma', 'part_of_speech', 'sense_key',
  'meaning_vi', 'ipa', 'example', 'source_excerpt', 'created_at', 'last_asked_at',
  'times_asked', 'review_state', 'repetitions', 'interval_days', 'ease_factor',
  'due_at', 'last_reviewed_at', 'version', 'deleted_at'
];

var CARDS_COLUMNS = [
  'card_id', 'user_id', 'word_id', 'card_type', 'state', 'due_at_utc',
  'stability', 'difficulty', 'elapsed_days', 'scheduled_days', 'learning_steps',
  'reps', 'lapses', 'last_review_at_utc', 'created_at_utc', 'updated_at_utc',
  'row_version', 'scheduler_version', 'parameters_version', 'is_suspended', 'legacy_snapshot_json'
];

var REVIEWS_COLUMNS = [
  'review_id', 'event_id', 'user_id', 'card_id', 'word_id', 'rating', 'reviewed_at',
  'old_due_at', 'new_due_at', 'old_interval_days', 'new_interval_days',
  'previous_state', 'next_state', 'stability', 'difficulty', 'review_log_json',
  'previous_version', 'next_version', 'scheduler_version', 'parameters_version',
  'previous_card_json', 'next_card_json'
];

var SETTINGS_COLUMNS = [
  'user_id', 'desired_retention', 'maximum_interval', 'scheduler_version',
  'parameters_version', 'scheduler_parameters_json', 'daily_new_card_limit',
  'daily_review_limit', 'timezone', 'updated_at_utc'
];

var EVENTS_COLUMNS = [
  'event_id', 'event_type', 'user_id', 'entity_id', 'occurred_at',
  'created_at', 'request_id', 'payload_hash', 'result_code', 'result_json'
];

var USERS_COLUMNS = [
  'user_id', 'telegram_chat_id', 'timezone', 'notifications_enabled',
  'daily_review_limit', 'reminder_local_hour', 'created_at', 'updated_at'
];

var DISPATCH_COLUMNS = [
  'dispatch_id', 'user_id', 'local_date', 'status', 'claimed_at',
  'sent_at', 'message_id', 'last_error', 'attempt_count', 'claim_token'
];

/**
 * Helper that can be run manually once in Apps Script Editor to create the required tabs
 * and exact header rows (`docs/09_DATA_SCHEMA.md`).
 */
function setupSheets() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Missing SHEET_ID in Script Properties');
  var ss = SpreadsheetApp.openById(sheetId);
  ensureTabWithHeaders_(ss, 'Words', WORDS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Cards', CARDS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Events', EVENTS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Reviews', REVIEWS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Users', USERS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Settings', SETTINGS_COLUMNS);
  ensureTabWithHeaders_(ss, 'DailyDispatchLog', DISPATCH_COLUMNS);
  SpreadsheetApp.flush();
}


function ensureTabWithHeaders_(ss, tabName, headers) {
  var sheet = ss.getSheetByName(tabName);
  if (!sheet) {
    sheet = ss.insertSheet(tabName);
  }
  if (sheet.getLastColumn() === 0) {
    sheet.appendRow(headers);
  }
}

/** Run after backing up an existing v1 Sheet; only appends headers, never rewrites data. */
function migrateSchemaV2() {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    [['Events', 'result_json'], ['DailyDispatchLog', 'claim_token']].forEach(function (entry) {
      var sheet = ss.getSheetByName(entry[0]);
      if (!sheet) throw new Error('Missing migration tab');
      if (!headerMap_(sheet)[entry[1]]) {
        sheet.getRange(1, sheet.getLastColumn() + 1).setValue(entry[1]);
      }
    });
    SpreadsheetApp.flush();
    props.setProperty('SCHEMA_VERSION', '2');
  } finally { lock.releaseLock(); }
}

/** Run after backing up existing Sheet; creates Cards and Settings tabs, migrates Words to Cards without duplicate IDs. */
function migrateSchemaV3(dryRun) {
  var props = PropertiesService.getScriptProperties();
  var ss = SpreadsheetApp.openById(props.getProperty('SHEET_ID'));
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var res = migrateSchemaV3_(ss, Boolean(dryRun));
    if (!dryRun) props.setProperty('SCHEMA_VERSION', '3');
    return res;
  } finally { lock.releaseLock(); }
}

function migrateSchemaV3_(ss, isDryRun) {
  // Inspect before any write: a dry-run must not create tabs or extend headers.
  var sourceWords = ss.getSheetByName('Words');
  if (!sourceWords) throw new Error('Missing Words tab');
  var sourceRows = readAllRowsAsObjects_(sourceWords, headerMap_(sourceWords));
  var currentCards = ss.getSheetByName('Cards');
  var currentRows = currentCards ? readAllRowsAsObjects_(currentCards, headerMap_(currentCards)) : [];
  var existing = {};
  currentRows.forEach(function (card) { existing[String(card.word_id)] = true; });
  var pending = sourceRows.filter(function (word) { return !String(word.deleted_at || '') && !existing[String(word.word_id)]; });
  if (isDryRun) return { migrated_cards: pending.length, status: 'DRY_RUN' };
  ensureTabWithHeaders_(ss, 'Cards', CARDS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Settings', SETTINGS_COLUMNS);

  [['Events', EVENTS_COLUMNS], ['DailyDispatchLog', DISPATCH_COLUMNS], ['Cards', CARDS_COLUMNS], ['Settings', SETTINGS_COLUMNS]].forEach(function (entry) {
    var tab = ss.getSheetByName(entry[0]);
    if (!tab) throw new Error('Missing migration tab: ' + entry[0]);
    var headers = headerMap_(tab);
    entry[1].forEach(function (column) { if (!headers[column]) { tab.getRange(1, tab.getLastColumn() + 1).setValue(column); headers[column] = tab.getLastColumn(); } });
  });

  var reviews = ss.getSheetByName('Reviews');
  if (reviews) {
    var rh = headerMap_(reviews);
    REVIEWS_COLUMNS.forEach(function (col) {
      if (!rh[col]) {
        reviews.getRange(1, reviews.getLastColumn() + 1).setValue(col);
      }
    });
  }

  var words = ss.getSheetByName('Words');
  var cards = ss.getSheetByName('Cards');
  if (!words || !cards) throw new Error('Missing Words or Cards tab');

  var wh = headerMap_(words);
  var ch = headerMap_(cards);
  var wordRows = readAllRowsAsObjects_(words, wh);
  var cardRows = readAllRowsAsObjects_(cards, ch);

  var existingCardsByWordId = {};
  for (var c = 0; c < cardRows.length; c++) {
    existingCardsByWordId[String(cardRows[c].word_id)] = true;
  }

  var count = 0;
  var now = new Date().toISOString();
  for (var w = 0; w < wordRows.length; w++) {
    var word = wordRows[w];
    if (String(word.deleted_at || '') !== '') continue;
    var wordId = String(word.word_id);
    if (!existingCardsByWordId[wordId]) {
      count++;
      if (!isDryRun) {
        var legacyState = String(word.review_state || 'new').toLowerCase();
        // Legacy SRS has no FSRS memory model: preserve dates/counts and archive it,
        // then let the official library initialize memory on the next real rating.
        var cardState = 'New';
        appendMapped_(cards, ch, {
          card_id: 'c_' + wordId,
          user_id: String(word.user_id),
          word_id: wordId,
          card_type: 'default',
          state: cardState,
          due_at_utc: String(word.due_at || now),
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: Number(word.interval_days || 0),
          learning_steps: 0,
          reps: Number(word.repetitions || 0),
          lapses: 0,
          last_review_at_utc: String(word.last_reviewed_at || ''),
          created_at_utc: String(word.created_at || now),
          updated_at_utc: now,
          row_version: Number(word.version || 1),
          scheduler_version: 'not-yet-scheduled',
          parameters_version: 'not-yet-scheduled',
          is_suspended: legacyState === 'suspended',
          legacy_snapshot_json: JSON.stringify(word)
        });
      }
    }
  }

  SpreadsheetApp.flush();
  return { migrated_cards: count, status: isDryRun ? 'DRY_RUN' : 'APPLIED' };
}


/** GET handler for Web App health check & configuration status probe. */
function doGet(e) {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  var ownerUserId = props.getProperty('OWNER_USER_ID');
  var sharedSecret = props.getProperty('GAS_SHARED_SECRET');
  return jsonResponse_({
    ok: true,
    service: 'voice-chat-gas',
    configured: Boolean(sheetId && ownerUserId && sharedSecret),
    sheet_status: sheetId ? 'configured' : 'missing',
    owner: ownerUserId ? ownerUserId : 'missing'
  });
}

/** Entry point: only HMAC-signed Worker requests may access or mutate the spreadsheet. */
function doPost(e) {

  try {
    if (!e || !e.postData || !e.postData.contents) {
      return jsonResponse_({ ok: false, error: { code: 'EMPTY_BODY', message: 'Empty request body' } });
    }
    var body = JSON.parse(e.postData.contents);
    if (typeof body.payload !== 'string' || typeof body.signature !== 'string') {
      return jsonResponse_({ ok: false, error: { code: 'INVALID_ENVELOPE', message: 'Missing payload or signature' } });
    }
    if (body.payload.length > 60000) {
      return jsonResponse_({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeds 60000 chars' } });
    }

    var props = PropertiesService.getScriptProperties();
    var sharedSecret = props.getProperty('GAS_SHARED_SECRET');
    var sheetId = props.getProperty('SHEET_ID');
    var ownerUserId = props.getProperty('OWNER_USER_ID');
    var maxAge = Number(props.getProperty('MAX_EVENT_AGE_SECONDS') || '300');
    if (!sharedSecret || !sheetId || !ownerUserId || !(maxAge > 0 && maxAge <= 3600)) {
      return jsonResponse_({ ok: false, error: { code: 'NOT_CONFIGURED', message: 'Script Properties incomplete' } });
    }
    if (!verifySignature_(body.payload, body.signature, sharedSecret)) {
      return jsonResponse_({ ok: false, error: { code: 'INVALID_SIGNATURE', message: 'HMAC signature mismatch' } });
    }

    var event = JSON.parse(body.payload);
    if (!event || typeof event.action !== 'string') {
      return jsonResponse_({ ok: false, error: { code: 'INVALID_EVENT', message: 'Missing action' } });
    }
    if (!/^[a-zA-Z0-9:_-]{12,128}$/.test(String(event.event_id || ''))) {
      return jsonResponse_({ ok: false, error: { code: 'INVALID_EVENT_ID', message: 'Invalid event_id format' } });
    }
    if (event.user_id !== ownerUserId) {
      return jsonResponse_({ ok: false, error: { code: 'FORBIDDEN', message: 'User does not match OWNER_USER_ID' } });
    }
    var issuedMs = Date.parse(String(event.issued_at || ''));
    if (!isFinite(issuedMs) || Math.abs(Date.now() - issuedMs) > maxAge * 1000) {
      return jsonResponse_({ ok: false, error: { code: 'EXPIRED_EVENT', message: 'Event timestamp outside allowed window' } });
    }

    var ss = SpreadsheetApp.openById(sheetId);
    if (event.action === 'mirror.applyBatch') {
      return handleWithBusinessError_(function () { return applyMirrorBatch_(ss, event, props); });
    }
    if (body.payload.length > 12000) {
      return jsonResponse_({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Business payload exceeds 12000 chars' } });
    }
    if (props.getProperty('DATA_AUTHORITY') === 'd1' && [ACTION_UPSERT, ACTION_UPDATE, ACTION_DELETE,
      ACTION_REVIEW_RECORD, ACTION_REVIEW_CLAIM_DIGEST, ACTION_REVIEW_FINISH_DIGEST, ACTION_USER_PREFERENCES, ACTION_MIGRATION_V3].indexOf(event.action) >= 0) {
      return jsonResponse_({ ok: false, error: { code: 'FORBIDDEN', message: 'D1 is authoritative; Sheet is read-only' } });
    }
    if (event.action === ACTION_UPSERT) {
      return handleWithBusinessError_(function () { return upsertWord_(ss, event); });
    }
    if (event.action === ACTION_LIST) {
      return jsonResponse_({ ok: true, data: listWords_(ss, event) });
    }
    if (event.action === ACTION_UPDATE) {
      return handleWithBusinessError_(function () { return updateWord_(ss, event); });
    }
    if (event.action === ACTION_DELETE) {
      return handleWithBusinessError_(function () { return deleteWord_(ss, event); });
    }
    if (event.action === ACTION_CARD_GET) {
      return handleWithBusinessError_(function () { var result = getCard_(ss, event); result.settings = readFsrsSettings_(ss, event.user_id); return result; });
    }
    if (event.action === ACTION_REVIEW_LIST_DUE) {
      return jsonResponse_({ ok: true, data: listDueReviews_(ss, event) });
    }
    if (event.action === ACTION_REVIEW_PREVIEW) {
      return jsonResponse_({ ok: true, data: previewReview_(ss, event) });
    }
    if (event.action === ACTION_REVIEW_RECORD) {
      return handleWithBusinessError_(function () { return recordReview_(ss, event); });
    }
    if (event.action === ACTION_REVIEW_LOOKUP) {
      return handleWithBusinessError_(function () {
        var events = ss.getSheetByName('Events');
        var result = mutationReplay_(events, headerMap_(events), Object.assign({}, event, { action: ACTION_REVIEW_RECORD }));
        return { result: result === null ? null : Object.assign({}, result, { duplicate_event: true, idempotent_replay: true }) };
      });
    }
    if (event.action === ACTION_REVIEW_STATS) {
      return jsonResponse_({ ok: true, data: getReviewStats_(ss, event) });
    }
    if (event.action === ACTION_REVIEW_CLAIM_DIGEST) {
      return jsonResponse_({ ok: true, data: claimDailyDigest_(ss, event) });
    }
    if (event.action === ACTION_REVIEW_FINISH_DIGEST) {
      return handleWithBusinessError_(function () { return finishDailyDigest_(ss, event); });
    }
    if (event.action === ACTION_USER_PREFERENCES) {
      return jsonResponse_({ ok: true, data: updateUserPreferences_(ss, event) });
    }
    if (event.action === ACTION_MIGRATION_V3) {
      return handleWithBusinessError_(function () { return migrateSchemaV3(Boolean(event.data && event.data.dry_run)); });
    }


    return jsonResponse_({ ok: false, error: { code: 'ACTION_NOT_IMPLEMENTED', message: 'Unsupported action' } });
  } catch (err) {
    console.error('GAS_doPost_failed', String(err && err.message || 'unknown').slice(0, 120));
    return jsonResponse_({ ok: false, error: { code: 'INTERNAL_ERROR', message: 'Internal Apps Script error' } });
  }
}

function handleWithBusinessError_(fn) {
  try {
    var data = fn();
    return jsonResponse_({ ok: true, data: data });
  } catch (err) {
    var msg = String(err && err.message || '');
    if (msg.indexOf('NOT_FOUND:') === 0) {
      return jsonResponse_({ ok: false, error: { code: 'NOT_FOUND', message: msg.slice(10) } });
    }
    if (msg.indexOf('CONFLICT:') === 0) {
      return jsonResponse_({ ok: false, error: { code: 'CONFLICT', message: msg.slice(9) } });
    }
    if (msg.indexOf('FORBIDDEN:') === 0) {
      return jsonResponse_({ ok: false, error: { code: 'FORBIDDEN', message: msg.slice(10) } });
    }
    throw err;
  }
}

function jsonResponse_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}

function verifySignature_(payload, incomingSignature, secret) {
  var raw = Utilities.computeHmacSha256Signature(payload, secret, Utilities.Charset.UTF_8);
  var expected = Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
  var actual = String(incomingSignature || '').replace(/=+$/, '');
  if (actual.length !== expected.length) return false;
  var difference = 0;
  for (var i = 0; i < expected.length; i++) {
    difference |= expected.charCodeAt(i) ^ actual.charCodeAt(i);
  }
  return difference === 0;
}

function canonicalJson_(value) {
  if (Array.isArray(value)) return '[' + value.map(canonicalJson_).join(',') + ']';
  if (value !== null && typeof value === 'object') return '{' + Object.keys(value).sort().map(function (key) {
    return JSON.stringify(key) + ':' + canonicalJson_(value[key]);
  }).join(',') + '}';
  return JSON.stringify(value);
}

/** Row metadata and values are written in the same range; partial cross-tab writes replay safely. */
function applyMirrorBatch_(ss, event, props) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var data = event.data || {};
    if (props.getProperty('DATA_AUTHORITY') !== 'd1' || props.getProperty('MIRROR_ENABLED') !== 'true' ||
        !props.getProperty('MIRROR_EPOCH')) throw new Error('FORBIDDEN:Mirror is not enabled');
    if (data.epoch !== props.getProperty('MIRROR_EPOCH')) throw new Error('CONFLICT:Mirror epoch mismatch');
    if (!Array.isArray(data.jobs) || !data.jobs.length || data.jobs.length > 3) throw new Error('CONFLICT:Invalid mirror jobs');
    var layouts = {
      Words: ['word_id', WORDS_COLUMNS], Cards: ['card_id', CARDS_COLUMNS], Reviews: ['review_id', REVIEWS_COLUMNS],
      Events: ['event_id', EVENTS_COLUMNS], Settings: ['user_id', SETTINGS_COLUMNS], Users: ['user_id', USERS_COLUMNS],
      DailyDispatchLog: ['dispatch_id', DISPATCH_COLUMNS]
    };
    var tables = {};
    var ids = [];
    data.jobs.forEach(function (job) {
      if (!job || typeof job.event_id !== 'string' || job.event_id.length > 160 || !Array.isArray(job.entities) ||
          !job.entities.length || job.entities.length > 10) throw new Error('CONFLICT:Invalid mirror job');
      ids.push(job.event_id);
      job.entities.forEach(function (entity) {
        var layout = entity && Object.prototype.hasOwnProperty.call(layouts, entity.tab) && layouts[entity.tab];
        var row = entity && entity.row;
        if (!layout || !row || typeof row !== 'object' || Array.isArray(row) || typeof entity.id !== 'string' ||
            row[layout[0]] !== entity.id || row.user_id !== event.user_id || !Number.isSafeInteger(entity.version) || entity.version < 0)
          throw new Error('CONFLICT:Invalid mirror entity');
        Object.keys(row).forEach(function (key) {
          var value = row[key];
          if (!(value === null || typeof value === 'boolean' || typeof value === 'number' && isFinite(value) ||
              typeof value === 'string' && value.length <= 48000)) throw new Error('CONFLICT:Invalid mirror cell');
        });
        if (entity.tab === 'Words' && row.version !== entity.version || entity.tab === 'Cards' && row.row_version !== entity.version)
          throw new Error('CONFLICT:Mirror version mismatch');
        var table = tables[entity.tab];
        if (!table) {
          var sheet = ss.getSheetByName(entity.tab);
          if (!sheet) throw new Error('CONFLICT:Missing mirror tab');
          var grid = sheet.getRange(1, 1, sheet.getLastRow(), sheet.getLastColumn()).getValues();
          var headers = grid[0].map(String);
          layout[1].forEach(function (column) { if (headers.indexOf(column) < 0) throw new Error('CONFLICT:Missing mirror column'); });
          ['_mirror_version', '_mirror_json', '_mirror_epoch'].forEach(function (column) { if (headers.indexOf(column) < 0) headers.push(column); });
          grid[0] = headers;
          var index = Object.create(null);
          for (var i = 1; i < grid.length; i++) {
            var id = String(grid[i][headers.indexOf(layout[0])] || '');
            if (!id) continue;
            if (Object.prototype.hasOwnProperty.call(index, id)) throw new Error('CONFLICT:Duplicate mirror entity');
            index[id] = i;
          }
          table = tables[entity.tab] = { sheet: sheet, grid: grid, headers: headers, index: index, first: Infinity, last: -1 };
        }
        var oldIndex = Object.prototype.hasOwnProperty.call(table.index, entity.id) ? table.index[entity.id] : -1;
        var oldRow = oldIndex >= 0 ? table.grid[oldIndex] : [];
        var rawVersion = oldRow[table.headers.indexOf('_mirror_version')];
        var oldVersion = rawVersion === undefined || rawVersion === '' ? -1 : Number(rawVersion);
        var oldEpoch = String(oldRow[table.headers.indexOf('_mirror_epoch')] || '');
        var json = canonicalJson_(row);
        if (oldEpoch && oldEpoch !== data.epoch) throw new Error('CONFLICT:Existing mirror epoch mismatch');
        if (oldVersion > entity.version) return;
        if (oldVersion === entity.version) {
          if (String(oldRow[table.headers.indexOf('_mirror_json')]) !== json) throw new Error('CONFLICT:Same mirror version differs');
          return;
        }
        if (oldIndex >= 0 && (entity.tab === 'Reviews' || entity.tab === 'Events')) {
          layout[1].forEach(function (column) {
            var oldValue = oldRow[table.headers.indexOf(column)];
            if (oldValue instanceof Date) oldValue = oldValue.toISOString();
            if (stripLeadingQuote_(String(oldValue === undefined || oldValue === null ? '' : oldValue)) !== String(row[column] === undefined || row[column] === null ? '' : row[column]))
              throw new Error('CONFLICT:Immutable mirror row differs');
          });
        }
        if (oldIndex >= 0 && oldVersion < 0 && (entity.tab === 'Words' || entity.tab === 'Cards') &&
            Number(oldRow[table.headers.indexOf(entity.tab === 'Words' ? 'version' : 'row_version')]) > entity.version) return;
        var values = table.headers.map(function (column) {
          if (column === '_mirror_version') return entity.version;
          if (column === '_mirror_json') return json;
          if (column === '_mirror_epoch') return data.epoch;
          var value = row[column];
          return value === undefined || value === null ? '' : typeof value === 'string' ? safeCell_(value) : value;
        });
        var target = oldIndex >= 0 ? oldIndex : table.grid.length;
        table.grid[target] = values; table.index[entity.id] = target;
        table.first = Math.min(table.first, target); table.last = Math.max(table.last, target);
      });
    });
    // Validate every entity before the first write. A crash between tabs is repaired by
    // replaying the same versions; no append-only audit row is overwritten with new data.
    Object.keys(tables).forEach(function (name) {
      var table = tables[name];
      if (table.last < 0) return;
      table.sheet.getRange(1, 1, 1, table.headers.length).setValues([table.headers]);
      var rows = table.grid.slice(table.first, table.last + 1).map(function (row) {
        return table.headers.map(function (_column, index) { return row[index] === undefined ? '' : row[index]; });
      });
      table.sheet.getRange(table.first + 1, 1, rows.length, table.headers.length).setValues(rows);
    });
    SpreadsheetApp.flush();
    return { applied_event_ids: ids };
  } finally { lock.releaseLock(); }
}

function upsertWord_(ss, event) {
  var d = event.data || {};
  var word = checkedText_(d.word, 120, true);
  var lemma = checkedText_(d.lemma || d.word, 120, true);
  var pos = checkedPos_(d.part_of_speech || 'unknown');
  var sense = checkedText_(d.sense_key || 'default', 100, true).toLowerCase();
  var meaning = checkedText_(d.meaning_vi || '', 300, false);
  var ipa = checkedText_(d.ipa || '', 120, false);
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
    requireColumns_(eh, EVENTS_COLUMNS);
    requireColumns_(wh, WORDS_COLUMNS);

    var eventRow = findRow_(events, eh['event_id'], String(event.event_id));
    if (eventRow > 0) {
      var oldEvent = readRowObject_(events, eh, eventRow);
      if (oldEvent.event_type !== event.action || oldEvent.user_id !== event.user_id || (oldEvent.payload_hash && oldEvent.payload_hash !== mutationFingerprint_(event))) throw new Error('CONFLICT:Event ID already used');
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
      words.getRange(wordRow, wh['deleted_at']).setValue('');
      if (String(words.getRange(wordRow, wh['review_state']).getValue()) === 'suspended') {
        words.getRange(wordRow, wh['review_state']).setValue('new');
        words.getRange(wordRow, wh['due_at']).setValue(now);
      }
      created = false;
    } else {
      id = 'w_' + Utilities.getUuid();
      created = true;
      appendMapped_(words, wh, {
        word_id: id, user_id: event.user_id, word_key: wordKey, word: safeCell_(word),
        lemma: safeCell_(lemma), part_of_speech: pos, sense_key: safeCell_(sense),
        meaning_vi: safeCell_(meaning), ipa: safeCell_(ipa), example: safeCell_(example),
        source_excerpt: safeCell_(sourceExcerpt), created_at: now, last_asked_at: now,
        times_asked: 1, review_state: 'new', repetitions: 0,
        interval_days: 0, ease_factor: 2.5, due_at: now,
        last_reviewed_at: '', version: 1, deleted_at: ''
      });
      var cards = ss.getSheetByName('Cards');
      if (cards) {
        var ch = headerMap_(cards);
        appendMapped_(cards, ch, {
          card_id: 'c_' + id,
          user_id: event.user_id,
          word_id: id,
          card_type: 'default',
          state: 'New',
          due_at_utc: now,
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: 0,
          learning_steps: 0,
          reps: 0,
          lapses: 0,
          last_review_at_utc: '',
          created_at_utc: now,
          updated_at_utc: now,
          row_version: 1,
          scheduler_version: 'not-yet-scheduled',
          parameters_version: 'not-yet-scheduled',
          is_suspended: false
        });
      }
    }

    appendMutationEvent_(events, eh, event, id, { word_id: id, duplicate_event: false, created: created });
    SpreadsheetApp.flush();
    return { word_id: id, duplicate_event: false, created: created };
  } finally {
    lock.releaseLock();
  }
}

function listWords_(ss, event) {
  var d = event.data || {};
  var limit = Math.min(50, Math.max(1, Number(d.limit || 20)));
  var cursor = d.cursor ? String(d.cursor) : null;
  var search = d.search ? norm_(String(d.search)) : '';

  var words = ss.getSheetByName('Words');
  if (!words) throw new Error('Missing Words tab');
  var wh = headerMap_(words);
  requireColumns_(wh, WORDS_COLUMNS);

  var allRows = readAllRowsAsObjects_(words, wh);
  var filtered = [];
  for (var i = 0; i < allRows.length; i++) {
    var row = allRows[i];
    if (String(row.user_id) !== event.user_id) continue;
    if (String(row.deleted_at || '') !== '') continue;
    if (search) {
      var hay = norm_(String(row.word) + ' ' + String(row.lemma) + ' ' + String(row.meaning_vi));
      if (hay.indexOf(search) === -1) continue;
    }
    filtered.push(toVocabularyItem_(row));
  }

  var startIndex = 0;
  if (cursor) {
    for (var j = 0; j < filtered.length; j++) {
      if (filtered[j].word_id === cursor) {
        startIndex = j + 1;
        break;
      }
    }
  }

  var page = filtered.slice(startIndex, startIndex + limit);
  var nextCursor = (startIndex + limit < filtered.length && page.length > 0)
    ? page[page.length - 1].word_id
    : null;

  return { items: page, next_cursor: nextCursor };
}

function updateWord_(ss, event) {
  var d = event.data || {};
  var wordId = checkedText_(d.word_id, 120, true);
  var expectedVersion = Number(d.version || 0);
  var now = new Date().toISOString();

  var words = ss.getSheetByName('Words');
  var events = ss.getSheetByName('Events');
  if (!words || !events) throw new Error('Missing Words/Events tabs');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var wh = headerMap_(words);
    var eh = headerMap_(events);
    requireColumns_(wh, WORDS_COLUMNS);
    requireColumns_(eh, EVENTS_COLUMNS);

    var replay = mutationReplay_(events, eh, event);
    if (replay !== null) return replay;

    var wordRow = findRow_(words, wh['word_id'], wordId);
    if (wordRow <= 0) {
      throw new Error('NOT_FOUND:Vocabulary item not found');
    }
    var rowObj = readRowObject_(words, wh, wordRow);
    if (String(rowObj.user_id) !== event.user_id || String(rowObj.deleted_at || '') !== '') {
      throw new Error('NOT_FOUND:Vocabulary item not found');
    }

    var currentVersion = Number(rowObj.version || 1);
    if (expectedVersion > 0 && currentVersion !== expectedVersion) {
      throw new Error('CONFLICT:Version mismatch');
    }

    // Validate the complete proposed row before changing any cell.
    var updatedObj = Object.assign({}, rowObj);
    if (typeof d.meaning_vi === 'string') updatedObj.meaning_vi = safeCell_(checkedText_(d.meaning_vi, 300, false));
    if (typeof d.example === 'string') updatedObj.example = safeCell_(checkedText_(d.example, 500, false));
    if (typeof d.part_of_speech === 'string') updatedObj.part_of_speech = checkedPos_(d.part_of_speech);
    if (typeof d.sense_key === 'string') updatedObj.sense_key = safeCell_(checkedText_(d.sense_key, 100, true).toLowerCase());
    var newKey = [
      event.user_id,
      norm_(updatedObj.lemma),
      norm_(updatedObj.part_of_speech),
      norm_(updatedObj.sense_key)
    ].join('|');
    var collision = findRow_(words, wh['word_key'], newKey);
    if (collision > 0 && collision !== wordRow) throw new Error('CONFLICT:Word sense already exists');
    updatedObj.word_key = newKey;
    updatedObj.version = currentVersion + 1;
    Object.keys(updatedObj).forEach(function (key) {
      words.getRange(wordRow, wh[key]).setValue(updatedObj[key]);
    });
    var result = toVocabularyItem_(updatedObj);
    appendMutationEvent_(events, eh, event, wordId, result);
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function deleteWord_(ss, event) {
  var d = event.data || {};
  var wordId = checkedText_(d.word_id, 120, true);
  var now = new Date().toISOString();

  var words = ss.getSheetByName('Words');
  var events = ss.getSheetByName('Events');
  if (!words || !events) throw new Error('Missing Words/Events tabs');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var wh = headerMap_(words);
    var eh = headerMap_(events);
    requireColumns_(wh, WORDS_COLUMNS);
    requireColumns_(eh, EVENTS_COLUMNS);

    var replay = mutationReplay_(events, eh, event);
    if (replay !== null) return replay;

    var wordRow = findRow_(words, wh['word_id'], wordId);
    if (wordRow <= 0) {
      throw new Error('NOT_FOUND:Vocabulary item not found');
    }
    var rowObj = readRowObject_(words, wh, wordRow);
    if (String(rowObj.user_id) !== event.user_id) {
      throw new Error('FORBIDDEN:Not owner of vocabulary item');
    }

    words.getRange(wordRow, wh['deleted_at']).setValue(now);
    words.getRange(wordRow, wh['review_state']).setValue('suspended');
    words.getRange(wordRow, wh['version']).setValue(Number(rowObj.version || 1) + 1);

    var result = { word_id: wordId, deleted: true };
    appendMutationEvent_(events, eh, event, wordId, result);
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function getCard_(ss, event) {
  var d = event.data || {};
  var cardId = d.card_id ? String(d.card_id).trim() : '';
  var wordId = d.word_id ? String(d.word_id).trim() : '';
  if (!cardId && !wordId) {
    throw new Error('INVALID_ARGUMENT:Either card_id or word_id is required');
  }

  var words = ss.getSheetByName('Words');
  if (!words) throw new Error('Missing Words tab');
  var wh = headerMap_(words);
  requireColumns_(wh, WORDS_COLUMNS);

  var cards = ss.getSheetByName('Cards');
  if (cards) {
    var ch = headerMap_(cards);
    requireColumns_(ch, CARDS_COLUMNS);

    var cardRow = -1;
    if (cardId) {
      cardRow = findRow_(cards, ch['card_id'], cardId);
      if (cardRow <= 0 && cardId.indexOf('c_') === 0) {
        cardRow = findRow_(cards, ch['word_id'], cardId.substring(2));
      }
    }
    if (cardRow <= 0 && wordId) {
      cardRow = findRow_(cards, ch['word_id'], wordId);
      if (cardRow <= 0) {
        cardRow = findRow_(cards, ch['card_id'], 'c_' + wordId);
      }
    }

    if (cardRow > 0) {
      var cObj = readRowObject_(cards, ch, cardRow);
      if (String(cObj.user_id) !== event.user_id) {
        throw new Error('FORBIDDEN:Unauthorized card access');
      }
      var parentRow = findRow_(words, wh['word_id'], String(cObj.word_id));
      var parent = parentRow > 0 ? readRowObject_(words, wh, parentRow) : null;
      if (!parent || parent.user_id !== event.user_id || String(parent.deleted_at || '') || String(cObj.is_suspended) === 'true' || String(parent.review_state) === 'suspended') throw new Error('NOT_FOUND:Card is inactive');
      return {
        card: {
          card_id: String(cObj.card_id),
          user_id: String(cObj.user_id),
          word_id: String(cObj.word_id),
          card_type: String(cObj.card_type || 'default'),
          state: String(cObj.state || 'New'),
          due_at_utc: String(cObj.due_at_utc || new Date().toISOString()),
          stability: Number(cObj.stability || 0),
          difficulty: Number(cObj.difficulty || 0),
          elapsed_days: Number(cObj.elapsed_days || 0),
          scheduled_days: Number(cObj.scheduled_days || 0),
          learning_steps: Number(cObj.learning_steps || 0),
          reps: Number(cObj.reps || 0),
          lapses: Number(cObj.lapses || 0),
          last_review_at_utc: cObj.last_review_at_utc ? String(cObj.last_review_at_utc) : null,
          created_at_utc: String(cObj.created_at_utc || new Date().toISOString()),
          updated_at_utc: String(cObj.updated_at_utc || new Date().toISOString()),
          row_version: Number(cObj.row_version || 1),
          scheduler_version: String(cObj.scheduler_version || 'not-yet-scheduled'),
          parameters_version: String(cObj.parameters_version || 'not-yet-scheduled'),
          is_suspended: String(cObj.is_suspended) === 'true' || cObj.is_suspended === true,
          legacy_snapshot_json: String(cObj.legacy_snapshot_json || '')
        }
      };
    }
  }

  // Not found in Cards tab, check Words tab
  var targetWordId = wordId || (cardId.indexOf('c_') === 0 ? cardId.substring(2) : cardId);
  var wordRow = findRow_(words, wh['word_id'], targetWordId);
  if (wordRow <= 0) {
    throw new Error('NOT_FOUND:Card or Word not found');
  }
  var wObj = readRowObject_(words, wh, wordRow);
  if (String(wObj.user_id) !== event.user_id || String(wObj.deleted_at || '') !== '') {
    throw new Error('FORBIDDEN:Unauthorized card access');
  }

  var now = new Date().toISOString();
  var legacyState = String(wObj.review_state || 'new').toLowerCase();
  if (legacyState === 'suspended') throw new Error('NOT_FOUND:Card is inactive');
  var cardState = 'New';
  var newCard = {
    card_id: 'c_' + targetWordId,
    user_id: String(wObj.user_id),
    word_id: targetWordId,
    card_type: 'default',
    state: cardState,
    due_at_utc: String(wObj.due_at || now),
    stability: 0,
    difficulty: 0,
    elapsed_days: 0,
    scheduled_days: Number(wObj.interval_days || 0),
    learning_steps: 0,
    reps: Number(wObj.repetitions || 0),
    lapses: 0,
    last_review_at_utc: wObj.last_reviewed_at ? String(wObj.last_reviewed_at) : null,
    created_at_utc: String(wObj.created_at || now),
    updated_at_utc: now,
    row_version: Number(wObj.version || 1),
    scheduler_version: 'not-yet-scheduled',
    parameters_version: 'not-yet-scheduled',
    is_suspended: legacyState === 'suspended',
    legacy_snapshot_json: JSON.stringify(wObj)
  };

  // Reads stay read-only; only locked migration/recordReview may materialize a card.

  return { card: newCard };
}

function previewReview_(ss, event) {
  var cardData = getCard_(ss, event);
  return {
    card_id: cardData.card.card_id,
    current_state: cardData.card.state,
    card: cardData.card
  };
}

function legacyReviewState_(state) {
  return state === 'Relearning' || state === 'Learning' ? 'learning' : String(state).toLowerCase();
}

function readFsrsSettings_(ss, userId) {
  var sheet = ss.getSheetByName('Settings');
  if (!sheet) return {};
  var h = headerMap_(sheet);
  var row = findRow_(sheet, h['user_id'], userId);
  if (row <= 0) return {};
  var stored = readRowObject_(sheet, h, row);
  var settings = stored.scheduler_parameters_json ? JSON.parse(String(stored.scheduler_parameters_json)) : {};
  if (stored.desired_retention !== '') settings.request_retention = Number(stored.desired_retention);
  if (stored.maximum_interval !== '') settings.maximum_interval = Number(stored.maximum_interval);
  if (stored.timezone) settings.timezone = String(stored.timezone);
  if (stored.parameters_version) settings.parameters_version = String(stored.parameters_version);
  return settings;
}

function listDueReviews_(ss, event) {
  var d = event.data || {};
  var limit = Math.min(50, Math.max(1, Number(d.limit || 10)));
  var nowIso = String(d.now_iso || new Date().toISOString());
  var nowMs = Date.parse(nowIso);

  var words = ss.getSheetByName('Words');
  if (!words) throw new Error('Missing Words tab');
  var wh = headerMap_(words);
  requireColumns_(wh, WORDS_COLUMNS);

  var cards = ss.getSheetByName('Cards');
  var due = [];

  if (cards) {
    var ch = headerMap_(cards);
    requireColumns_(ch, CARDS_COLUMNS);

    var cardRows = readAllRowsAsObjects_(cards, ch);
    var wordRows = readAllRowsAsObjects_(words, wh);
    var wordMap = {};
    for (var w = 0; w < wordRows.length; w++) {
      var wItem = wordRows[w];
      if (String(wItem.user_id) === event.user_id && String(wItem.deleted_at || '') === '' && wItem.review_state !== 'suspended') {
        wordMap[String(wItem.word_id)] = wItem;
      }
    }

    for (var c = 0; c < cardRows.length; c++) {
      var cr = cardRows[c];
      if (String(cr.user_id) !== event.user_id) continue;
      if (String(cr.is_suspended) === 'true' || cr.is_suspended === true) continue;
      var parentWord = wordMap[String(cr.word_id)];
      if (!parentWord) continue;

      var dueMs = Date.parse(String(cr.due_at_utc || ''));
      if (!isFinite(dueMs) || dueMs <= nowMs) {
        due.push({
          review_id: 'due_' + String(cr.card_id),
          card_id: String(cr.card_id),
          card_type: String(cr.card_type || 'default'),
          word_id: String(cr.word_id),
          word: stripLeadingQuote_(String(parentWord.word)),
          lemma: stripLeadingQuote_(String(parentWord.lemma)),
          part_of_speech: String(parentWord.part_of_speech || 'unknown'),
          meaning_vi: stripLeadingQuote_(String(parentWord.meaning_vi || '')),
          example: stripLeadingQuote_(String(parentWord.example || '')),
          source_excerpt: stripLeadingQuote_(String(parentWord.source_excerpt || '')),
          due_at: String(cr.due_at_utc || nowIso),
          review_state: legacyReviewState_(String(cr.state || 'New')),
          repetitions: Number(cr.reps || 0),
          interval_days: Number(cr.scheduled_days || 0),
          ease_factor: 2.5,
          version: Number(cr.row_version || 1),
          state: String(cr.state || 'New'),
          due_at_utc: String(cr.due_at_utc || nowIso),
          stability: Number(cr.stability || 0),
          difficulty: Number(cr.difficulty || 0),
          elapsed_days: Number(cr.elapsed_days || 0),
          scheduled_days: Number(cr.scheduled_days || 0),
          learning_steps: Number(cr.learning_steps || 0),
          reps: Number(cr.reps || 0),
          lapses: Number(cr.lapses || 0),
          last_review_at_utc: cr.last_review_at_utc ? String(cr.last_review_at_utc) : undefined,
          row_version: Number(cr.row_version || 1),
          scheduler_version: String(cr.scheduler_version || 'not-yet-scheduled'),
          parameters_version: String(cr.parameters_version || 'not-yet-scheduled')
        });
      }
    }
  }
  {
    var rows = readAllRowsAsObjects_(words, wh);
    for (var i = 0; i < rows.length; i++) {
      var r = rows[i];
      if (String(r.user_id) !== event.user_id) continue;
      if (String(r.deleted_at || '') !== '') continue;
      if (String(r.review_state) === 'suspended') continue;
      if (cards && cardRows.some(function (card) { return String(card.word_id) === String(r.word_id); })) continue;
      var dueMsW = Date.parse(String(r.due_at || ''));
      if (!isFinite(dueMsW) || dueMsW <= nowMs) {
        due.push({
          review_id: 'due_' + String(r.word_id),
          card_id: 'c_' + String(r.word_id),
          card_type: 'default',
          word_id: String(r.word_id),
          word: stripLeadingQuote_(String(r.word)),
          lemma: stripLeadingQuote_(String(r.lemma)),
          part_of_speech: String(r.part_of_speech || 'unknown'),
          meaning_vi: stripLeadingQuote_(String(r.meaning_vi || '')),
          example: stripLeadingQuote_(String(r.example || '')),
          source_excerpt: stripLeadingQuote_(String(r.source_excerpt || '')),
          due_at: String(r.due_at),
          review_state: String(r.review_state || 'new'),
          repetitions: Number(r.repetitions || 0),
          interval_days: Number(r.interval_days || 0),
          ease_factor: Number(r.ease_factor || 2.5),
          version: Number(r.version || 1),
          state: 'New',
          due_at_utc: String(r.due_at),
          stability: 0,
          difficulty: 0,
          elapsed_days: 0,
          scheduled_days: Number(r.interval_days || 0),
          learning_steps: 0,
          reps: Number(r.repetitions || 0),
          lapses: 0,
          row_version: Number(r.version || 1),
          scheduler_version: 'not-yet-scheduled',
          parameters_version: 'not-yet-scheduled'
        });
      }
    }
  }

  due.sort(function (a, b) {
    return Date.parse(a.due_at) - Date.parse(b.due_at);
  });

  return { items: due.slice(0, limit) };
}

function recordReview_(ss, event) {
  var d = event.data || {};
  var wordId = d.word_id ? checkedText_(d.word_id, 120, false) : '';
  var cardId = d.card_id ? checkedText_(d.card_id, 120, false) : '';
  if (!wordId && !cardId) throw new Error('INVALID_ARGUMENT:Missing word_id or card_id');
  var rating = checkedText_(d.rating, 16, true).toLowerCase();
  var reviewedAtIso = String(d.reviewed_at || event.issued_at || new Date().toISOString());

  var words = ss.getSheetByName('Words');
  var events = ss.getSheetByName('Events');
  var reviews = ss.getSheetByName('Reviews');
  var cards = ss.getSheetByName('Cards');
  if (!words || !events || !reviews) throw new Error('Missing Words/Events/Reviews tabs');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var wh = headerMap_(words);
    var eh = headerMap_(events);
    var rh = headerMap_(reviews);
    requireColumns_(wh, WORDS_COLUMNS);
    requireColumns_(eh, EVENTS_COLUMNS);
    requireColumns_(rh, REVIEWS_COLUMNS);

    var replay = mutationReplay_(events, eh, event);
    if (replay !== null) return Object.assign({}, replay, { duplicate_event: true, idempotent_replay: true });
    if (!d.fsrs_card || !d.fsrs_review_log) throw new Error('INVALID_ARGUMENT:Official FSRS snapshot and log required');

    var existingRevRow = findRow_(reviews, rh['event_id'], String(event.event_id));
    if (existingRevRow > 0) {
      // Sheets cannot transact across tabs. Never invent a successful replay from
      // mutable current rows if the original Events snapshot was not persisted.
      throw new Error('CONFLICT:Incomplete review requires reconciliation');
    }

    var cardRow = -1;
    var ch = null;
    var cardObj = null;
    if (cards) {
      ch = headerMap_(cards);
      requireColumns_(ch, CARDS_COLUMNS);
      if (cardId) cardRow = findRow_(cards, ch['card_id'], cardId);
      if (cardRow <= 0 && wordId) cardRow = findRow_(cards, ch['word_id'], wordId);
      if (cardRow <= 0 && cardId && cardId.indexOf('c_') === 0) {
        cardRow = findRow_(cards, ch['word_id'], cardId.substring(2));
      }
      if (cardRow > 0) {
        cardObj = readRowObject_(cards, ch, cardRow);
      }
    }

    var effTargetWordId = wordId || (cardObj ? String(cardObj.word_id) : (cardId.indexOf('c_') === 0 ? cardId.substring(2) : cardId));
    var wordRow = findRow_(words, wh['word_id'], effTargetWordId);
    if (wordRow <= 0) {
      throw new Error('NOT_FOUND:Word not found for review');
    }
    var wordObj = readRowObject_(words, wh, wordRow);
    if (String(wordObj.user_id) !== event.user_id || String(wordObj.deleted_at || '') !== '') {
      throw new Error('FORBIDDEN:Unauthorized word review');
    }
    if (wordObj.review_state === 'suspended' || (cardObj && (String(cardObj.user_id) !== event.user_id || String(cardObj.word_id) !== effTargetWordId))) {
      throw new Error('FORBIDDEN:Unauthorized card review');
    }

    var expectedVersion = d.expected_version !== undefined ? Number(d.expected_version) : (d.version !== undefined ? Number(d.version) : 0);
    if (expectedVersion > 0) {
      var wordVer = Number(wordObj.version || 1);
      var cardVer = cardObj ? Number(cardObj.row_version || 1) : wordVer;
      if (expectedVersion !== cardVer) {
        throw new Error('CONFLICT:Review card is stale');
      }
    }

    var reviewId = 'rev_' + Utilities.getUuid();
    var finalCardId = cardObj ? String(cardObj.card_id) : ('c_' + effTargetWordId);
    var finalState = 'Review';
    var finalDueAt = reviewedAtIso;
    var finalIntervalDays = 1;
    var finalStability = 0;
    var finalDifficulty = 0;
    var finalReps = Number(wordObj.repetitions || 0) + 1;
    var finalLapses = 0;
    var finalRowVersion = Number((cardObj ? cardObj.row_version : wordObj.version) || 1) + 1;
    var prevState = cardObj ? String(cardObj.state || 'New') : String(wordObj.review_state || 'new');
    var oldDueAt = cardObj ? String(cardObj.due_at_utc || wordObj.due_at || '') : String(wordObj.due_at || '');
    var oldInterval = cardObj ? Number(cardObj.scheduled_days || wordObj.interval_days || 0) : Number(wordObj.interval_days || 0);
    var previousCard = cardObj || getCard_(ss, event).card;

    if (d.fsrs_card) {
      var fc = d.fsrs_card;
      if (fc.card_id !== finalCardId || fc.word_id !== effTargetWordId || fc.user_id !== event.user_id || Number(fc.row_version) !== finalRowVersion || (cardObj && String(cardObj.is_suspended) === 'true')) throw new Error('CONFLICT:FSRS snapshot does not match locked Card version');
      if (['New', 'Learning', 'Review', 'Relearning'].indexOf(fc.state) < 0 || !isFinite(Date.parse(fc.due_at_utc)) || !(fc.stability >= 0 && isFinite(fc.stability)) || !(fc.difficulty >= 0 && fc.difficulty <= 10)) throw new Error('INVALID_ARGUMENT:Invalid FSRS snapshot');
      finalState = String(fc.state || 'Review');
      finalDueAt = String(fc.due_at_utc || reviewedAtIso);
      finalIntervalDays = Number(fc.scheduled_days || 0);
      finalStability = Number(fc.stability || 0);
      finalDifficulty = Number(fc.difficulty || 0);
      finalReps = Number(fc.reps || 0);
      finalLapses = Number(fc.lapses || 0);
      finalRowVersion = Number(fc.row_version || finalRowVersion);

      if (cards) {
        if (cardRow > 0) {
          cards.getRange(cardRow, ch['state']).setValue(finalState);
          cards.getRange(cardRow, ch['due_at_utc']).setValue(finalDueAt);
          cards.getRange(cardRow, ch['stability']).setValue(finalStability);
          cards.getRange(cardRow, ch['difficulty']).setValue(finalDifficulty);
          cards.getRange(cardRow, ch['elapsed_days']).setValue(Number(fc.elapsed_days || 0));
          cards.getRange(cardRow, ch['scheduled_days']).setValue(finalIntervalDays);
          cards.getRange(cardRow, ch['learning_steps']).setValue(Number(fc.learning_steps || 0));
          cards.getRange(cardRow, ch['reps']).setValue(finalReps);
          cards.getRange(cardRow, ch['lapses']).setValue(finalLapses);
          cards.getRange(cardRow, ch['last_review_at_utc']).setValue(reviewedAtIso);
          cards.getRange(cardRow, ch['updated_at_utc']).setValue(reviewedAtIso);
          cards.getRange(cardRow, ch['row_version']).setValue(finalRowVersion);
          cards.getRange(cardRow, ch['scheduler_version']).setValue(fc.scheduler_version);
          cards.getRange(cardRow, ch['parameters_version']).setValue(fc.parameters_version);
        } else {
          appendMapped_(cards, ch, {
            card_id: finalCardId,
            user_id: event.user_id,
            word_id: effTargetWordId,
            card_type: 'default',
            state: finalState,
            due_at_utc: finalDueAt,
            stability: finalStability,
            difficulty: finalDifficulty,
            elapsed_days: Number(fc.elapsed_days || 0),
            scheduled_days: finalIntervalDays,
            learning_steps: Number(fc.learning_steps || 0),
            reps: finalReps,
            lapses: finalLapses,
            last_review_at_utc: reviewedAtIso,
            created_at_utc: String(wordObj.created_at || reviewedAtIso),
            updated_at_utc: reviewedAtIso,
            row_version: finalRowVersion,
            scheduler_version: String(fc.scheduler_version || 'not-yet-scheduled'),
            parameters_version: String(fc.parameters_version || 'not-yet-scheduled'),
            is_suspended: false,
            legacy_snapshot_json: fc.legacy_snapshot_json || ''
          });
        }
      }
    }

    words.getRange(wordRow, wh['review_state']).setValue(legacyReviewState_(finalState));
    words.getRange(wordRow, wh['repetitions']).setValue(finalReps);
    words.getRange(wordRow, wh['interval_days']).setValue(finalIntervalDays);
    words.getRange(wordRow, wh['due_at']).setValue(finalDueAt);
    words.getRange(wordRow, wh['last_reviewed_at']).setValue(reviewedAtIso);
    words.getRange(wordRow, wh['version']).setValue(Number(wordObj.version || 1) + 1);

    appendMapped_(reviews, rh, {
      review_id: reviewId,
      event_id: String(event.event_id),
      user_id: event.user_id,
      card_id: finalCardId,
      word_id: effTargetWordId,
      rating: rating,
      reviewed_at: reviewedAtIso,
      old_due_at: oldDueAt,
      new_due_at: finalDueAt,
      old_interval_days: oldInterval,
      new_interval_days: finalIntervalDays,
      previous_state: prevState,
      next_state: finalState,
      stability: finalStability,
      difficulty: finalDifficulty,
      review_log_json: d.fsrs_review_log ? JSON.stringify(d.fsrs_review_log) : '',
      previous_version: finalRowVersion - 1,
      next_version: finalRowVersion,
      scheduler_version: d.fsrs_card ? d.fsrs_card.scheduler_version : 'legacy',
      parameters_version: d.fsrs_card ? d.fsrs_card.parameters_version : 'legacy',
      previous_card_json: JSON.stringify(previousCard),
      next_card_json: JSON.stringify(d.fsrs_card || {})
    });

    var result = {
      review_id: reviewId,
      card_id: finalCardId,
      word_id: effTargetWordId,
      next_due_at: finalDueAt,
      interval_days: finalIntervalDays,
      repetitions: finalReps,
      ease_factor: 2.5,
      review_state: legacyReviewState_(finalState),
      state: finalState,
      stability: finalStability,
      difficulty: finalDifficulty,
      reps: finalReps,
      lapses: finalLapses,
      row_version: finalRowVersion,
      idempotent_replay: false,
      duplicate_event: false
    };
    appendMutationEvent_(events, eh, event, reviewId, result);
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
}

function getReviewStats_(ss, event) {
  var d = event.data || {};
  var nowIso = String(d.now_iso || new Date().toISOString());
  var nowMs = Date.parse(nowIso);
  var todayDateStr = new Date(nowMs + 7 * 3600000).toISOString().substring(0, 10);
  var localDayEndMs = Date.parse(todayDateStr + 'T00:00:00.000Z') + 17 * 3600000;

  var newCount = 0;
  var learningCount = 0;
  var reviewCount = 0;
  var relearningCount = 0;
  var dueTodayCount = 0;
  var totalCards = 0;
  var completedTodayCount = 0;

  var cards = ss.getSheetByName('Cards');
  var activeWords = {};
  var wordsForStats = ss.getSheetByName('Words');
  readAllRowsAsObjects_(wordsForStats, headerMap_(wordsForStats)).forEach(function (word) {
    if (word.user_id === event.user_id && !String(word.deleted_at || '') && word.review_state !== 'suspended') activeWords[String(word.word_id)] = true;
  });
  if (cards) {
    var ch = headerMap_(cards);
    requireColumns_(ch, CARDS_COLUMNS);
    var cardRows = readAllRowsAsObjects_(cards, ch);
    Object.keys(activeWords).forEach(function (wordId) {
      if (!cardRows.some(function (card) { return String(card.word_id) === wordId; })) {
        var wordRow = findRow_(wordsForStats, headerMap_(wordsForStats)['word_id'], wordId);
        var legacy = readRowObject_(wordsForStats, headerMap_(wordsForStats), wordRow);
        totalCards++; newCount++;
        if (Date.parse(String(legacy.due_at)) < localDayEndMs) dueTodayCount++;
      }
    });
    for (var i = 0; i < cardRows.length; i++) {
      var cr = cardRows[i];
      if (String(cr.user_id) !== event.user_id) continue;
      if (!activeWords[String(cr.word_id)]) continue;
      if (String(cr.is_suspended) === 'true' || cr.is_suspended === true) continue;
      totalCards++;
      var st = String(cr.state || 'New');
      if (st === 'New') newCount++;
      else if (st === 'Learning') learningCount++;
      else if (st === 'Review') reviewCount++;
      else if (st === 'Relearning') relearningCount++;

      var dueMs = Date.parse(String(cr.due_at_utc || ''));
      if (!isFinite(dueMs) || dueMs < localDayEndMs) {
        dueTodayCount++;
      }
    }
  } else {
    var words = ss.getSheetByName('Words');
    if (words) {
      var wh = headerMap_(words);
      var wordRows = readAllRowsAsObjects_(words, wh);
      for (var j = 0; j < wordRows.length; j++) {
        var wr = wordRows[j];
        if (String(wr.user_id) !== event.user_id) continue;
        if (String(wr.deleted_at || '') !== '') continue;
        if (String(wr.review_state) === 'suspended') continue;
        totalCards++;
        var wst = String(wr.review_state || 'new').toLowerCase();
        if (wst === 'new') newCount++;
        else if (wst === 'learning') learningCount++;
        else reviewCount++;

        var dueMsW = Date.parse(String(wr.due_at || ''));
        if (!isFinite(dueMsW) || dueMsW < localDayEndMs) {
          dueTodayCount++;
        }
      }
    }
  }

  var totalReviewsCount = 0;
  var reviews = ss.getSheetByName('Reviews');
  if (reviews) {
    var rh = headerMap_(reviews);
    var revRows = readAllRowsAsObjects_(reviews, rh);
    for (var k = 0; k < revRows.length; k++) {
      var rr = revRows[k];
      if (String(rr.user_id) !== event.user_id) continue;
      totalReviewsCount++;
      var revAt = String(rr.reviewed_at || '');
      if (isFinite(Date.parse(revAt)) && new Date(Date.parse(revAt) + 7 * 3600000).toISOString().substring(0, 10) === todayDateStr) {
        completedTodayCount++;
      }
    }
  }

  return {
    user_id: event.user_id,
    new_cards: newCount,
    learning_cards: learningCount,
    review_cards: reviewCount,
    relearning_cards: relearningCount,
    due_today: dueTodayCount,
    completed_today: completedTodayCount,
    total_active_cards: totalCards,
    total_cards: totalCards,
    total_reviews_count: totalReviewsCount
  };
}

function claimDailyDigest_(ss, event) {
  var d = event.data || {};
  var localDate = checkedText_(d.local_date, 20, true);
  var limit = Math.min(50, Math.max(1, Number(d.limit || 10)));
  var dispatchId = localDate + '|' + event.user_id;
  var now = String(d.now_iso || new Date().toISOString());
  var nowMs = Date.parse(now);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(localDate) || !isFinite(nowMs)) throw new Error('Invalid digest date');

  var users = ss.getSheetByName('Users');
  var dispatchLog = ss.getSheetByName('DailyDispatchLog');
  if (!users || !dispatchLog) throw new Error('Missing Users/DailyDispatchLog tabs');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var uh = headerMap_(users);
    var dh = headerMap_(dispatchLog);
    requireColumns_(uh, USERS_COLUMNS);
    requireColumns_(dh, DISPATCH_COLUMNS);

    var userRow = findRow_(users, uh['user_id'], event.user_id);
    var notificationsEnabled = true;
    var telegramChatId = event.user_id.replace(/^telegram:/, '');
    if (userRow > 0) {
      var uObj = readRowObject_(users, uh, userRow);
      notificationsEnabled = String(uObj.notifications_enabled) !== 'false';
      if (uObj.telegram_chat_id) {
        telegramChatId = String(uObj.telegram_chat_id);
      }
      if (Number(uObj.daily_review_limit) > 0) {
        limit = Math.min(limit, Number(uObj.daily_review_limit));
      }
    }

    if (!notificationsEnabled) {
      return {
        dispatch_id: dispatchId,
        already_dispatched: false,
        notifications_enabled: false,
        telegram_chat_id: telegramChatId,
        due_cards: []
      };
    }

    var existingDispatchRow = findRow_(dispatchLog, dh['dispatch_id'], dispatchId);
    var attempts = 0;
    if (existingDispatchRow > 0) {
      var previous = readRowObject_(dispatchLog, dh, existingDispatchRow);
      attempts = Number(previous.attempt_count || 1);
      var ageMs = nowMs - Date.parse(String(previous.claimed_at));
      // A crashed sender may have delivered the message. Do not retry an ambiguous send.
      if (previous.status === 'claimed' && ageMs >= 300000) {
        dispatchLog.getRange(existingDispatchRow, dh['status']).setValue('unknown');
        dispatchLog.getRange(existingDispatchRow, dh['last_error']).setValue('Sender outcome unknown; manual reconciliation required');
      }
      if (previous.status !== 'failed' || attempts >= 3 || ageMs < 30000 * Math.pow(2, attempts - 1)) {
        return { dispatch_id: dispatchId, already_dispatched: true, notifications_enabled: true, telegram_chat_id: telegramChatId, due_cards: [] };
      }
    }

    var dueList = listDueReviews_(ss, {
      user_id: event.user_id,
      data: { limit: limit, now_iso: d.now_iso || now }
    });

    var claimToken = Utilities.getUuid();
    if (dueList.items.length > 0) {
      var claim = {
        dispatch_id: dispatchId,
        user_id: event.user_id,
        local_date: localDate,
        status: 'claimed',
        claimed_at: now,
        sent_at: '',
        message_id: '',
        last_error: '',
        attempt_count: attempts + 1,
        claim_token: claimToken
      };
      if (existingDispatchRow > 0) {
        Object.keys(claim).forEach(function (key) { dispatchLog.getRange(existingDispatchRow, dh[key]).setValue(claim[key]); });
      } else {
        appendMapped_(dispatchLog, dh, claim);
      }
      SpreadsheetApp.flush();
    }

    return {
      dispatch_id: dispatchId,
      already_dispatched: false,
      notifications_enabled: true,
      telegram_chat_id: telegramChatId,
      due_cards: dueList.items,
      claim_token: claimToken
    };
  } finally {
    lock.releaseLock();
  }
}

function finishDailyDigest_(ss, event) {
  var d = event.data || {};
  if (['sent', 'failed', 'unknown'].indexOf(d.status) < 0) throw new Error('Invalid digest outcome');
  var sheet = ss.getSheetByName('DailyDispatchLog');
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var h = headerMap_(sheet);
    requireColumns_(h, DISPATCH_COLUMNS);
    var row = findRow_(sheet, h['dispatch_id'], String(d.dispatch_id));
    if (row <= 0) throw new Error('NOT_FOUND:Digest claim not found');
    var old = readRowObject_(sheet, h, row);
    if (old.user_id !== event.user_id || old.claim_token !== d.claim_token) throw new Error('CONFLICT:Digest claim changed');
    if (old.status === d.status) return { updated: true };
    if (old.status !== 'claimed' && old.status !== 'unknown') throw new Error('CONFLICT:Digest outcome already recorded');
    sheet.getRange(row, h['status']).setValue(d.status);
    sheet.getRange(row, h['sent_at']).setValue(d.status === 'sent' ? new Date().toISOString() : '');
    sheet.getRange(row, h['message_id']).setValue(d.message_id ? String(d.message_id) : '');
    sheet.getRange(row, h['last_error']).setValue(d.status === 'sent' ? '' : 'Telegram send ' + d.status);
    SpreadsheetApp.flush();
    return { updated: true };
  } finally { lock.releaseLock(); }
}

function updateUserPreferences_(ss, event) {
  var d = event.data || {};
  var now = new Date().toISOString();
  var users = ss.getSheetByName('Users');
  var events = ss.getSheetByName('Events');
  if (!users) throw new Error('Missing Users tab');

  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  try {
    var uh = headerMap_(users);
    var eh = headerMap_(events);
    requireColumns_(uh, USERS_COLUMNS);
    requireColumns_(eh, EVENTS_COLUMNS);
    var replay = mutationReplay_(events, eh, event);
    if (replay !== null) return replay;
    var userRow = findRow_(users, uh['user_id'], event.user_id);
    var enabled = d.notifications_enabled !== undefined ? Boolean(d.notifications_enabled) : true;
    var chatId = d.telegram_chat_id ? String(d.telegram_chat_id) : event.user_id.replace(/^telegram:/, '');
    var limit = Number(d.daily_review_limit || 10);

    if (userRow > 0) {
      users.getRange(userRow, uh['telegram_chat_id']).setValue(chatId);
      users.getRange(userRow, uh['notifications_enabled']).setValue(enabled ? 'true' : 'false');
      users.getRange(userRow, uh['updated_at']).setValue(now);
    } else {
      appendMapped_(users, uh, {
        user_id: event.user_id,
        telegram_chat_id: chatId,
        timezone: 'Asia/Ho_Chi_Minh',
        notifications_enabled: enabled ? 'true' : 'false',
        daily_review_limit: limit,
        reminder_local_hour: 8,
        created_at: now,
        updated_at: now
      });
    }
    var result = { updated: true, notifications_enabled: enabled };
    appendMutationEvent_(events, eh, event, event.user_id, result);
    SpreadsheetApp.flush();
    return result;
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
function checkedPos_(value) {
  var pos = checkedText_(value, 32, true).toLowerCase();
  if (['noun', 'verb', 'adjective', 'adverb', 'phrase', 'idiom', 'preposition', 'conjunction', 'pronoun', 'interjection', 'unknown'].indexOf(pos) < 0) throw new Error('Invalid part of speech');
  return pos;
}
function mutationFingerprint_(event) {
  var data = Object.assign({}, event.data);
  // Server review time and server FSRS calculations change across deliveries; they are not the mutation identity.
  if (event.action === ACTION_REVIEW_RECORD) {
    if (data.client_request) data = { client_request: data.client_request };
    delete data.reviewed_at;
    delete data.fsrs_card;
    delete data.fsrs_review_log;
    delete data.expected_version;
    delete data.version;
  }
  var raw = Utilities.computeHmacSha256Signature(JSON.stringify({ action: event.action, user_id: event.user_id, data: data }), PropertiesService.getScriptProperties().getProperty('GAS_SHARED_SECRET'), Utilities.Charset.UTF_8);
  return Utilities.base64EncodeWebSafe(raw).replace(/=+$/, '');
}
function mutationReplay_(events, headers, event) {
  var row = findRow_(events, headers['event_id'], String(event.event_id));
  if (row <= 0) return null;
  var old = readRowObject_(events, headers, row);
  if (old.user_id !== event.user_id || old.event_type !== event.action || old.payload_hash !== mutationFingerprint_(event) || !old.result_json) {
    throw new Error('CONFLICT:Event ID already used for a different or legacy operation');
  }
  return JSON.parse(String(old.result_json));
}
function appendMutationEvent_(events, headers, event, entityId, result) {
  appendMapped_(events, headers, {
    event_id: String(event.event_id), event_type: event.action, user_id: event.user_id,
    entity_id: entityId, occurred_at: String(event.issued_at), created_at: new Date().toISOString(),
    request_id: safeCell_(String(event.request_id || '').slice(0, 80)),
    payload_hash: mutationFingerprint_(event), result_code: 'OK', result_json: JSON.stringify(result)
  });
}
function norm_(value) {
  return String(value).normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}
function safeCell_(value) {
  var s = String(value);
  return /^[\s]*[=+\-@]/.test(s) ? "'" + s : s;
}
function stripLeadingQuote_(value) {
  var s = String(value || '');
  return /^'[\s]*[=+\-@]/.test(s) ? s.slice(1) : s;
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
function readRowObject_(sheet, headers, rowNum) {
  var cols = sheet.getLastColumn();
  var vals = sheet.getRange(rowNum, 1, 1, cols).getValues()[0];
  var obj = {};
  Object.keys(headers).forEach(function (k) {
    obj[k] = vals[headers[k] - 1];
  });
  return obj;
}
function readAllRowsAsObjects_(sheet, headers) {
  var last = sheet.getLastRow();
  var cols = sheet.getLastColumn();
  if (last <= 1 || cols < 1) return [];
  var matrix = sheet.getRange(2, 1, last - 1, cols).getValues();
  var keys = Object.keys(headers);
  var out = [];
  for (var i = 0; i < matrix.length; i++) {
    var obj = {};
    for (var j = 0; j < keys.length; j++) {
      var k = keys[j];
      obj[k] = matrix[i][headers[k] - 1];
    }
    out.push(obj);
  }
  return out;
}
function toVocabularyItem_(row) {
  return {
    word_id: String(row.word_id),
    user_id: String(row.user_id),
    word_key: String(row.word_key),
    word: stripLeadingQuote_(String(row.word)),
    lemma: stripLeadingQuote_(String(row.lemma)),
    part_of_speech: String(row.part_of_speech || 'unknown'),
    sense_key: stripLeadingQuote_(String(row.sense_key || 'default')),
    meaning_vi: stripLeadingQuote_(String(row.meaning_vi || '')),
    ipa: stripLeadingQuote_(String(row.ipa || '')),
    example: stripLeadingQuote_(String(row.example || '')),
    source_excerpt: stripLeadingQuote_(String(row.source_excerpt || '')),
    created_at: String(row.created_at),
    last_asked_at: String(row.last_asked_at),
    times_asked: Number(row.times_asked || 1),
    review_state: String(row.review_state || 'new'),
    repetitions: Number(row.repetitions || 0),
    interval_days: Number(row.interval_days || 0),
    ease_factor: Number(row.ease_factor || 2.5),
    due_at: String(row.due_at),
    last_reviewed_at: String(row.last_reviewed_at || ''),
    version: Number(row.version || 1),
    deleted_at: String(row.deleted_at || '')
  };
}
function appendMapped_(sheet, headers, entry) {
  var cols = sheet.getLastColumn();
  var row = Array(cols).fill('');
  Object.keys(entry).forEach(function (k) {
    if (headers[k]) row[headers[k] - 1] = entry[k];
  });
  sheet.appendRow(row);
}

/**
 * Tiện ích 1-Click: Cấu hình nhanh Script Properties và tự động tạo các Tab Schema v3 trên Google Sheet.
 * Người dùng chỉ cần chọn hàm này và bấm "Run" (Chạy) trên Apps Script Editor!
 */
function runQuickSetup() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');

  if (!sheetId) {
    try {
      var activeSs = SpreadsheetApp.getActiveSpreadsheet();
      if (activeSs) {
        sheetId = activeSs.getId();
      }
    } catch (e) {}
  }

  if (!sheetId) {
    // Tự động tạo một file Google Sheet mới trên Google Drive nếu chưa có
    var newSs = SpreadsheetApp.create('VoiceChatLearnLanguage');
    sheetId = newSs.getId();
    Logger.log('>>> ĐÃ TỰ ĐỘNG TẠO FILE GOOGLE SHEET MỚI TẠI: ' + newSs.getUrl());
  }

  props.setProperty('SHEET_ID', sheetId);
  if (!props.getProperty('GAS_SHARED_SECRET')) {
    props.setProperty('GAS_SHARED_SECRET', 'replace_with_gas_shared_secret');
  }
  props.setProperty('OWNER_USER_ID', props.getProperty('OWNER_USER_ID') || 'telegram:889395521');

  props.setProperty('MAX_EVENT_AGE_SECONDS', '300');
  props.setProperty('SCHEMA_VERSION', '3');

  setupSheets();
  Logger.log('>>> THÀNH CÔNG: Đã khởi tạo đầy đủ 7 Tab Schema v3 trên Google Sheet ID: ' + sheetId);
  Logger.log('>>> LINK GOOGLE SHEET CỦA BẠN: https://docs.google.com/spreadsheets/d/' + sheetId + '/edit');
}
