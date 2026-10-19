-- M9-03: per-user daily usage counters for free-tier quota enforcement.
-- local_date is the Asia/Ho_Chi_Minh calendar date so caps reset at local midnight.
CREATE TABLE usage_daily (
  user_id TEXT NOT NULL,
  local_date TEXT NOT NULL,
  kind TEXT NOT NULL CHECK(kind IN ('chat_turn', 'translation', 'live_session')),
  used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
  updated_at TEXT NOT NULL,
  PRIMARY KEY (user_id, local_date, kind)
);
