-- Domain schema v3 preserved; SQL schema revision is tracked independently.
CREATE TABLE system_state (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
INSERT INTO system_state VALUES ('schema_version', '1'), ('writes_enabled', 'true'), ('source_epoch', 'initial');

CREATE TABLE words (
  word_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  word_key TEXT NOT NULL UNIQUE,
  created_at TEXT NOT NULL,
  deleted_at TEXT NOT NULL DEFAULT '',
  version INTEGER NOT NULL CHECK(version >= 1),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  UNIQUE(user_id, word_id),
  CHECK(COALESCE(json_extract(record_json, '$.word_id') = word_id
    AND json_extract(record_json, '$.user_id') = user_id
    AND json_extract(record_json, '$.word_key') = word_key
    AND json_extract(record_json, '$.version') = version
    AND json_extract(record_json, '$.deleted_at') = deleted_at, 0))
);
CREATE INDEX words_owner_created ON words(user_id, deleted_at, created_at DESC, word_id);

CREATE TABLE cards (
  card_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  word_id TEXT NOT NULL,
  due_at_utc TEXT NOT NULL,
  state TEXT NOT NULL CHECK(state IN ('New','Learning','Review','Relearning')),
  is_suspended INTEGER NOT NULL DEFAULT 0 CHECK(is_suspended IN (0,1)),
  row_version INTEGER NOT NULL CHECK(row_version >= 1),
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  UNIQUE(user_id, card_id),
  FOREIGN KEY(user_id, word_id) REFERENCES words(user_id, word_id),
  CHECK(COALESCE(json_extract(record_json, '$.card_id') = card_id
    AND json_extract(record_json, '$.user_id') = user_id
    AND json_extract(record_json, '$.word_id') = word_id
    AND json_extract(record_json, '$.due_at_utc') = due_at_utc
    AND json_extract(record_json, '$.state') = state
    AND json_extract(record_json, '$.row_version') = row_version
    AND json_extract(record_json, '$.is_suspended') = is_suspended, 0))
);
CREATE INDEX cards_due ON cards(user_id, is_suspended, due_at_utc, card_id);
CREATE INDEX cards_word ON cards(user_id, word_id, card_id);

CREATE TABLE events (
  event_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  action TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  payload_hash TEXT NOT NULL,
  fingerprint_scheme TEXT NOT NULL CHECK(fingerprint_scheme IN ('gas-hmac-v1','d1-hmac-v1','legacy-unverified')),
  result_json TEXT CHECK(result_json IS NULL OR json_valid(result_json)),
  record_json TEXT NOT NULL CHECK(json_valid(record_json))
);
CREATE INDEX events_owner_time ON events(user_id, occurred_at, event_id);

CREATE TABLE reviews (
  review_id TEXT PRIMARY KEY,
  event_id TEXT NOT NULL UNIQUE REFERENCES events(event_id),
  user_id TEXT NOT NULL,
  card_id TEXT NOT NULL,
  word_id TEXT NOT NULL,
  reviewed_at TEXT NOT NULL,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)),
  FOREIGN KEY(user_id, card_id) REFERENCES cards(user_id, card_id),
  FOREIGN KEY(user_id, word_id) REFERENCES words(user_id, word_id),
  CHECK(COALESCE(json_extract(record_json, '$.review_id') = review_id
    AND json_extract(record_json, '$.event_id') = event_id
    AND json_extract(record_json, '$.user_id') = user_id
    AND json_extract(record_json, '$.card_id') = card_id
    AND json_extract(record_json, '$.word_id') = word_id
    AND json_extract(record_json, '$.reviewed_at') = reviewed_at, 0))
);
CREATE INDEX reviews_owner_time ON reviews(user_id, reviewed_at, review_id);
CREATE TRIGGER reviews_immutable_update BEFORE UPDATE ON reviews BEGIN
  SELECT RAISE(ABORT, 'Reviews are append-only');
END;
CREATE TRIGGER reviews_immutable_delete BEFORE DELETE ON reviews BEGIN
  SELECT RAISE(ABORT, 'Reviews are append-only');
END;

CREATE TABLE settings (user_id TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(json_valid(record_json)));
CREATE TABLE users (user_id TEXT PRIMARY KEY, record_json TEXT NOT NULL CHECK(json_valid(record_json)));
CREATE TABLE daily_dispatches (
  dispatch_id TEXT PRIMARY KEY, user_id TEXT NOT NULL, local_date TEXT NOT NULL,
  status TEXT NOT NULL CHECK(status IN ('claimed','sent','failed','unknown','skipped')),
  claim_token TEXT NOT NULL DEFAULT '', attempt_count INTEGER NOT NULL DEFAULT 0,
  record_json TEXT NOT NULL CHECK(json_valid(record_json)), UNIQUE(user_id, local_date)
);

-- A failed CHECK aborts DB.batch atomically; checking UPDATE changes after commit is too late.
CREATE TABLE mutation_guards (guard_id TEXT PRIMARY KEY, valid INTEGER NOT NULL CHECK(valid = 1));
CREATE TABLE sync_outbox (
  sequence INTEGER PRIMARY KEY AUTOINCREMENT, event_id TEXT NOT NULL UNIQUE,
  payload_json TEXT NOT NULL CHECK(json_valid(payload_json)), committed_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','delivered','dead')),
  next_attempt_at TEXT NOT NULL, attempts INTEGER NOT NULL DEFAULT 0,
  lease_token TEXT NOT NULL DEFAULT '', lease_until TEXT NOT NULL DEFAULT '',
  delivered_at TEXT NOT NULL DEFAULT '', last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX outbox_ready ON sync_outbox(status, next_attempt_at, sequence);
CREATE TABLE telegram_updates (
  update_id INTEGER PRIMARY KEY, event_id TEXT NOT NULL, committed_at TEXT NOT NULL,
  result_json TEXT NOT NULL CHECK(json_valid(result_json))
);
CREATE TABLE telegram_deliveries (
  delivery_id TEXT PRIMARY KEY, update_id INTEGER NOT NULL,
  chat_id TEXT NOT NULL, message_id INTEGER NOT NULL,
  revision INTEGER NOT NULL, payload_json TEXT NOT NULL CHECK(json_valid(payload_json)),
  status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','leased','delivered','dead')),
  attempts INTEGER NOT NULL DEFAULT 0, next_attempt_at TEXT NOT NULL,
  lease_token TEXT NOT NULL DEFAULT '', lease_until TEXT NOT NULL DEFAULT '',
  last_error TEXT NOT NULL DEFAULT ''
);
CREATE INDEX telegram_deliveries_ready ON telegram_deliveries(status, next_attempt_at, delivery_id);
CREATE TABLE migration_runs (
  migration_run_id TEXT PRIMARY KEY, source_checksum TEXT NOT NULL,
  state TEXT NOT NULL, checkpoint_json TEXT NOT NULL CHECK(json_valid(checkpoint_json)),
  updated_at TEXT NOT NULL
);
