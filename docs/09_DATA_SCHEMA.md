# 09 — Google Sheets schema v1

> Source of truth for single user MVP. Dùng ID ổn định, không lấy sheet row index làm ID; timezone UTC ISO. Trong sheet, mỗi tab header hàng 1, không merge cell. Apps Script batch operations với ScriptLock.

## Tab `Words`
Header (copy nguyên dòng CSV, Google Sheets Import/dùng split theo dấu phẩy):
```csv
word_id,user_id,word_key,word,lemma,part_of_speech,sense_key,meaning_vi,ipa,example,source_excerpt,created_at,last_asked_at,times_asked,review_state,repetitions,interval_days,ease_factor,due_at,last_reviewed_at,version,deleted_at
```
- `word_id`: `w_<uuid>`; stable even when row moves.
- `user_id`: `telegram:<numeric>`; never trust client body.
- `word_key`: `user_id|normalized_lemma|POS|normalized_sense_key` deterministic; case-insensitive, NFKC, trim, collapse whitespace; identity of sense, not just raw word.
- `word` display form; `lemma` base form; `part_of_speech` canonical; `sense_key` stable identifier from sense classifier/approved user edit.
- `review_state` `new|learning|review|suspended`; `ease_factor` default 2.5; `interval_days` numeric; `due_at` UTC ISO; `version` increment on update.
- `deleted_at` soft delete timestamp.

## Tab `Events`
```csv
event_id,event_type,user_id,entity_id,occurred_at,created_at,request_id,payload_hash,result_code
```
Unique `event_id` per user/event source; guard check+append with ScriptLock. Do not store full transcript/audio; optional `payload_hash` for audit.

## Tab `Reviews`
```csv
review_id,event_id,user_id,word_id,rating,reviewed_at,old_due_at,new_due_at,old_interval_days,new_interval_days
```
Append-only review history. A review action must be idempotent by event_id; unique review_id. Scored by pure SRS engine.

## Tab `Users`
```csv
user_id,telegram_chat_id,timezone,notifications_enabled,daily_review_limit,reminder_local_hour,created_at,updated_at
```
MVP user row can be seeded manually; allowed `timezone` e.g. `Asia/Ho_Chi_Minh`. `telegram_chat_id` lấy từ verified webhook, không nhận từ request không xác thực.

## Tab `DailyDispatchLog`
```csv
dispatch_id,user_id,local_date,status,claimed_at,sent_at,message_id,last_error,attempt_count
```
Dùng one digest per local day; `status`: `claimed|sent|failed`; retries kiểm `dispatch_id` và idempotency của Telegram message flow (không có exactly-once gửi message guarantee). Mark state chặt, có giải pháp xử lý timeout/không rõ đã gửi chưa.

## Tạo sheet lần đầu
1. Create spreadsheet, add five tabs bằng tên exact case.
2. Paste header vào A1 bằng split text hoặc file CSV.
3. Freeze header row, protect columns chứa IDs/time; set format plain text cho ID/key to avoid mangling.
4. `SHEET_ID` đặt trong Script Properties.
5. Chạy dry-run with synthetic data trước production.

## Schema version / migration
- `schema_version` trong Sheet `Settings` optional hoặc Script Properties `SCHEMA_VERSION = 1`.
- Mọi đổi header phải có migration script/test + backup trước khi deploy. Không đổi tên column in-place mà không nâng contract.
- `GET`/`POST` nên locate columns by header names, không phụ thuộc vị trí hardcoded; fail fast nếu thiếu header.
- Backup Sheet định kỳ (Drive version history + export CSV copy riêng, restore test). 

## Bảo mật dữ liệu
- Spreadsheet private; Apps Script execute-as owner + HMAC; only allowlist user. Xóa từ xóa/ẩn từ ôn, privacy deletion policies sau MVP.
- Escape data bắt đầu ký tự `= + - @` trong các text fields để chống spreadsheet formula injection. Không ghi toàn bộ transcript, chỉ source_excerpt ngắn.
