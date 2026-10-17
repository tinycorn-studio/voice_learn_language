-- M9-02: fixed-window rate limits shared by every Worker isolate.
-- Rows are pruned by the scheduled handler; keys never contain tokens or message content.
CREATE TABLE rate_limit_windows (
  scope TEXT NOT NULL,
  user_id TEXT NOT NULL,
  window_start INTEGER NOT NULL,
  count INTEGER NOT NULL CHECK(count >= 0),
  PRIMARY KEY (scope, user_id, window_start)
);
CREATE INDEX rate_limit_windows_cleanup ON rate_limit_windows(window_start);
