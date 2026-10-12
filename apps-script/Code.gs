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
var ACTION_REVIEW_LIST_DUE = 'review.listDue';
var ACTION_REVIEW_RECORD = 'review.record';
var ACTION_REVIEW_CLAIM_DIGEST = 'review.claimDigest';
var ACTION_REVIEW_FINISH_DIGEST = 'review.finishDigest';
var ACTION_USER_PREFERENCES = 'user.preferences';

var WORDS_COLUMNS = [
  'word_id', 'user_id', 'word_key', 'word', 'lemma', 'part_of_speech', 'sense_key',
  'meaning_vi', 'ipa', 'example', 'source_excerpt', 'created_at', 'last_asked_at',
  'times_asked', 'review_state', 'repetitions', 'interval_days', 'ease_factor',
  'due_at', 'last_reviewed_at', 'version', 'deleted_at'
];

var EVENTS_COLUMNS = [
  'event_id', 'event_type', 'user_id', 'entity_id', 'occurred_at',
  'created_at', 'request_id', 'payload_hash', 'result_code', 'result_json'
];

var REVIEWS_COLUMNS = [
  'review_id', 'event_id', 'user_id', 'word_id', 'rating', 'reviewed_at',
  'old_due_at', 'new_due_at', 'old_interval_days', 'new_interval_days'
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
 * Helper that can be run manually once in Apps Script Editor to create the 5 required tabs
 * and exact header rows (`docs/09_DATA_SCHEMA.md`, `M3-01`).
 */
function setupSheets() {
  var props = PropertiesService.getScriptProperties();
  var sheetId = props.getProperty('SHEET_ID');
  if (!sheetId) throw new Error('Missing SHEET_ID in Script Properties');
  var ss = SpreadsheetApp.openById(sheetId);
  ensureTabWithHeaders_(ss, 'Words', WORDS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Events', EVENTS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Reviews', REVIEWS_COLUMNS);
  ensureTabWithHeaders_(ss, 'Users', USERS_COLUMNS);
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
    if (body.payload.length > 12000) {
      return jsonResponse_({ ok: false, error: { code: 'PAYLOAD_TOO_LARGE', message: 'Payload exceeds 12000 chars' } });
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
    if (event.action === ACTION_REVIEW_LIST_DUE) {
      return jsonResponse_({ ok: true, data: listDueReviews_(ss, event) });
    }
    if (event.action === ACTION_REVIEW_RECORD) {
      return handleWithBusinessError_(function () { return recordReview_(ss, event); });
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

function listDueReviews_(ss, event) {
  var d = event.data || {};
  var limit = Math.min(50, Math.max(1, Number(d.limit || 10)));
  var nowIso = String(d.now_iso || new Date().toISOString());
  var nowMs = Date.parse(nowIso);

  var words = ss.getSheetByName('Words');
  if (!words) throw new Error('Missing Words tab');
  var wh = headerMap_(words);
  requireColumns_(wh, WORDS_COLUMNS);

  var rows = readAllRowsAsObjects_(words, wh);
  var due = [];
  for (var i = 0; i < rows.length; i++) {
    var r = rows[i];
    if (String(r.user_id) !== event.user_id) continue;
    if (String(r.deleted_at || '') !== '') continue;
    if (String(r.review_state) === 'suspended') continue;
    var dueMs = Date.parse(String(r.due_at || ''));
    if (!isFinite(dueMs) || dueMs <= nowMs) {
      due.push({
        review_id: 'due_' + String(r.word_id),
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
        version: Number(r.version || 1)
      });
    }
  }

  due.sort(function (a, b) {
    return Date.parse(a.due_at) - Date.parse(b.due_at);
  });

  return { items: due.slice(0, limit) };
}

function recordReview_(ss, event) {
  var d = event.data || {};
  var wordId = checkedText_(d.word_id, 120, true);
  var rating = checkedText_(d.rating, 16, true).toLowerCase();
  var reviewedAtIso = String(d.reviewed_at || event.issued_at || new Date().toISOString());

  var words = ss.getSheetByName('Words');
  var events = ss.getSheetByName('Events');
  var reviews = ss.getSheetByName('Reviews');
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
    if (replay !== null) return Object.assign({}, replay, { duplicate_event: true });

    var existingRevRow = findRow_(reviews, rh['event_id'], String(event.event_id));
    if (existingRevRow > 0) {
      var existingRev = readRowObject_(reviews, rh, existingRevRow);
      var existingWordRow = findRow_(words, wh['word_id'], wordId);
      var existingWord = existingWordRow > 0 ? readRowObject_(words, wh, existingWordRow) : {};
      return {
        review_id: String(existingRev.review_id),
        word_id: wordId,
        next_due_at: String(existingRev.new_due_at),
        interval_days: Number(existingRev.new_interval_days || 0),
        repetitions: Number(existingWord.repetitions || 0),
        ease_factor: Number(existingWord.ease_factor || 2.5),
        review_state: String(existingWord.review_state || 'review'),
        duplicate_event: true
      };
    }

    var wordRow = findRow_(words, wh['word_id'], wordId);
    if (wordRow <= 0) {
      throw new Error('NOT_FOUND:Word not found for review');
    }
    var wordObj = readRowObject_(words, wh, wordRow);
    if (String(wordObj.user_id) !== event.user_id || String(wordObj.deleted_at || '') !== '') {
      throw new Error('FORBIDDEN:Unauthorized word review');
    }
    if (d.version !== undefined && Number(d.version) !== Number(wordObj.version)) throw new Error('CONFLICT:Review card is stale');

    var srs = computeSrsNext_(
      {
        reviewState: String(wordObj.review_state || 'new'),
        repetitions: Number(wordObj.repetitions || 0),
        intervalDays: Number(wordObj.interval_days || 0),
        easeFactor: Number(wordObj.ease_factor || 2.5),
        dueAt: String(wordObj.due_at || reviewedAtIso)
      },
      rating,
      reviewedAtIso
    );

    var reviewId = 'rev_' + Utilities.getUuid();
    words.getRange(wordRow, wh['review_state']).setValue(srs.reviewState);
    words.getRange(wordRow, wh['repetitions']).setValue(srs.repetitions);
    words.getRange(wordRow, wh['interval_days']).setValue(srs.intervalDays);
    words.getRange(wordRow, wh['ease_factor']).setValue(srs.easeFactor);
    words.getRange(wordRow, wh['due_at']).setValue(srs.dueAt);
    words.getRange(wordRow, wh['last_reviewed_at']).setValue(reviewedAtIso);
    words.getRange(wordRow, wh['version']).setValue(Number(wordObj.version || 1) + 1);

    appendMapped_(reviews, rh, {
      review_id: reviewId,
      event_id: String(event.event_id),
      user_id: event.user_id,
      word_id: wordId,
      rating: rating,
      reviewed_at: reviewedAtIso,
      old_due_at: srs.oldDueAt,
      new_due_at: srs.dueAt,
      old_interval_days: srs.oldIntervalDays,
      new_interval_days: srs.intervalDays
    });

    var result = {
      review_id: reviewId,
      word_id: wordId,
      next_due_at: srs.dueAt,
      interval_days: srs.intervalDays,
      repetitions: srs.repetitions,
      ease_factor: srs.easeFactor,
      review_state: srs.reviewState,
      duplicate_event: false
    };
    appendMutationEvent_(events, eh, event, reviewId, result);
    SpreadsheetApp.flush();
    return result;
  } finally {
    lock.releaseLock();
  }
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

function computeSrsNext_(current, rating, reviewedAtIso) {
  var reviewedMs = Date.parse(reviewedAtIso);
  var oldEase = Math.min(3.0, Math.max(1.3, Number(current.easeFactor || 2.5)));
  var oldInterval = Math.max(0, Number(current.intervalDays || 0));
  var oldReps = Math.max(0, Math.floor(Number(current.repetitions || 0)));
  var tenMinMs = 10 * 60 * 1000;
  var oneDayMs = 24 * 60 * 60 * 1000;

  if (rating === 'again') {
    var easeAgain = Math.round(Math.max(1.3, oldEase - 0.2) * 100) / 100;
    return {
      reviewState: 'learning',
      repetitions: 0,
      intervalDays: 0,
      easeFactor: easeAgain,
      dueAt: new Date(reviewedMs + tenMinMs).toISOString(),
      oldDueAt: current.dueAt,
      oldIntervalDays: oldInterval
    };
  }
  if (rating === 'hard') {
    var easeHard = Math.round(Math.max(1.3, oldEase - 0.15) * 100) / 100;
    var intHard = Math.max(1, Math.ceil(oldInterval * 1.2));
    return {
      reviewState: 'review',
      repetitions: oldReps === 0 ? 1 : oldReps,
      intervalDays: intHard,
      easeFactor: easeHard,
      dueAt: new Date(reviewedMs + intHard * oneDayMs).toISOString(),
      oldDueAt: current.dueAt,
      oldIntervalDays: oldInterval
    };
  }
  if (rating === 'good') {
    var intGood = oldReps === 0 ? 1 : (oldReps === 1 ? 3 : Math.max(4, Math.ceil(oldInterval * oldEase)));
    return {
      reviewState: 'review',
      repetitions: oldReps + 1,
      intervalDays: intGood,
      easeFactor: oldEase,
      dueAt: new Date(reviewedMs + intGood * oneDayMs).toISOString(),
      oldDueAt: current.dueAt,
      oldIntervalDays: oldInterval
    };
  }
  var easeEasy = Math.round(Math.min(3.0, oldEase + 0.15) * 100) / 100;
  var intEasy = oldReps === 0 ? 4 : Math.max(5, Math.ceil(oldInterval * oldEase * 1.3));
  return {
    reviewState: 'review',
    repetitions: oldReps + 1,
    intervalDays: intEasy,
    easeFactor: easeEasy,
    dueAt: new Date(reviewedMs + intEasy * oneDayMs).toISOString(),
    oldDueAt: current.dueAt,
    oldIntervalDays: oldInterval
  };
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
  // Server review time changes across deliveries; it is not the mutation identity.
  if (event.action === ACTION_REVIEW_RECORD) delete data.reviewed_at;
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
