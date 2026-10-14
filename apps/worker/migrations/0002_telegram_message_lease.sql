-- Serialize pending edits of the same message without a process-local mutex.
CREATE INDEX telegram_message_leases ON telegram_deliveries(chat_id, message_id, status, lease_until);
