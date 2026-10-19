# 09 — Google Sheets schema v3

Dữ liệu thời gian UTC ISO8601, IDs bền vững. Các writers ký HMAC/giữ ScriptLock; Sheets không có transaction xuyên tabs. Source header chuẩn ở apps-script/Code.gs.

## Cards

```csv
card_id,user_id,word_id,card_type,state,due_at_utc,stability,difficulty,elapsed_days,scheduled_days,learning_steps,reps,lapses,last_review_at_utc,created_at_utc,updated_at_utc,row_version,scheduler_version,parameters_version,is_suspended,legacy_snapshot_json
```

- Word có nhiều Cards; default ID c_<word_id>, các Card khác cần ID độc lập. card_type hỗ trợ default/en_to_vi/vi_to_en/listening; chưa có API tạo/quản lý loại Card.
- State chuỗi New/Learning/Review/Relearning; S>=0, D=0 khi chưa học hoặc 1–10 sau rating. learning_steps là bước intra-day.
- Reps đếm lượt ôn, lapses do thư viện tính; không tăng cho Hard.
- row_version tăng mỗi review, độc lập Words.version.
- scheduler_version từ export FSRSVersion thực tế, parameters_version mặc định default-v1 hoặc revision weights được khai báo. Card chưa lập lịch có not-yet-scheduled.
- legacy_snapshot_json giữ Word gốc trước migration; due/counts/suspended được bảo toàn, memory khởi tạo qua FSRS ở lần rating thật tiếp theo.

## Words

```csv
word_id,user_id,word_key,word,lemma,part_of_speech,sense_key,meaning_vi,ipa,example,source_excerpt,created_at,last_asked_at,times_asked,review_state,repetitions,interval_days,ease_factor,due_at,last_reviewed_at,version,deleted_at
```

Ngữ nghĩa/ngữ cảnh; unique user+lemma+POS+sense. Cột SRS cũ là mirror của lần Card review gần nhất, không làm nguồn lịch của các Cards. Review_state dùng new/learning/review/suspended; Relearning mirror thành learning. Version là Word CRUD, không thay Card.row_version.

## Reviews (append-only)

```csv
review_id,event_id,user_id,card_id,word_id,rating,reviewed_at,old_due_at,new_due_at,old_interval_days,new_interval_days,previous_state,next_state,stability,difficulty,review_log_json,previous_version,next_version,scheduler_version,parameters_version,previous_card_json,next_card_json
```

Native review_log_json giữ nguyên đối tượng thư viện (rating/state số, state trước review, due/review và learning_steps gốc). Cột previous/next_state là state string, previous/next versions và JSON là snapshots Card đầy đủ. Không thay native log bằng dữ liệu Card mới. Application không sửa/xóa lịch sử; quyền editor Sheet vẫn cần bảo vệ.

## Settings

```csv
user_id,desired_retention,maximum_interval,scheduler_version,parameters_version,scheduler_parameters_json,daily_new_card_limit,daily_review_limit,timezone,updated_at_utc
```

desired_retention → request_retention (0.7–0.99); maximum_interval nguyên 1–36500. Blank/missing dùng DEFAULT_FSRS_CONFIG 0.9/36500/fuzz=false. scheduler_parameters_json chỉ nhận các keys schema hỗ trợ (request_retention, maximum_interval, enable_fuzz=false, timezone, parameters_version, weights w); cột riêng có giá trị sẽ override JSON. Timezone HCM/Bangkok UTC+7. Config sai bị từ chối.

Revision weights tùy chỉnh cần parameters_version riêng. scheduler_version trong Settings chỉ metadata, Worker quyết định revision thực tế. Daily limit fields ở Settings chưa được áp dụng vào study queue; Users.daily_review_limit vẫn dùng cho digest. Không tự seed Settings defaults trong migration.

## Events

```csv
event_id,event_type,user_id,entity_id,occurred_at,created_at,request_id,payload_hash,result_code,result_json
```

Fingerprint + snapshot để replay mutation gốc. Review fingerprint giữ canonical client IDs/rating/versions, loại computed schedule/time. Payload đổi trả conflict. Event thiếu snapshot không được đoán thành công từ dữ liệu mutable.

## Users / DailyDispatchLog

```csv
user_id,telegram_chat_id,timezone,notifications_enabled,daily_review_limit,reminder_local_hour,created_at,updated_at
dispatch_id,user_id,local_date,status,claimed_at,sent_at,message_id,last_error,attempt_count,claim_token
```

Digest claim theo ngày UTC+7/user; sent/failed/unknown và claim_token bảo vệ retry. Unknown cần đối chiếu, không tự gửi lại.

## Migration

Gọi migrateSchemaV3(true) để inspect, false để apply. Dry-run trả migrated_cards/status=DRY_RUN, không ghi kể cả tabs/properties. Apply tạo Cards/Settings, append headers thiếu của Reviews/Events/Dispatch/Cards/Settings và đặt SCHEMA_VERSION=3. Không ghi đè Card hiện có; cold start memory legacy có archive. Đọc fallback cho Word chưa có Card không tạo dòng. Ghi bắt buộc layout v3: migrate trước khi mở writers.

Chi tiết backup, nghiệm thu và rollback giữ lịch sử: [FSRS_MIGRATION.md](FSRS_MIGRATION.md).

## Cloudflare D1 Primary SQL Schema — M7-09 Production Cutover (Authoritative)

`apps/worker/migrations/0001_d1_primary.sql` giữ domain v3 trong `record_json`, thêm cột owner/ID/version/due indexed với CHECK parity, FK owner và Reviews append-only trigger. Events có fingerprint_scheme/result snapshot; outbox/delivery/migration/system_state là bảng vận hành. SQL guard `mutation_guards` trong DB.batch rollback nếu OCC/maintenance sai. Database chính thức tại Production là `voice-learn-prod-db` (`95af3a2e-7f67-4b7a-b075-44fa2c0c1da4`, Region: APAC).

M7-05: migration `0002_telegram_message_lease.sql` thêm index chat/message/status/lease để serialize edits xuyên isolates. Users và DailyDispatchLog JSON thêm `version` (legacy mặc định 0); mọi preference/dispatch transition tăng version và enqueue mirror cùng transaction. Telegram deliveries `pending/leased/delivered/dead`, `last_error=unknown_outcome` cần xử lý thủ công; update dedup/result tồn tại sau restart. Claimed digest quá hai phút thành unknown, không gửi lại tự động.

M7-06: migration `0003_sync_processor_lease.sql` thêm singleton lease để serialize mirror processors. Sheet mirror tự append `_mirror_version,_mirror_json,_mirror_epoch` vào tabs nhận snapshot; giá trị legacy version 0 hợp lệ, Word/Card vẫn positive. Row metadata và giá trị cùng một setValues range; không có ACID xuyên tabs, replay canonical snapshot sửa partial writes. Immutable Reviews/Events không nhận payload khác.

M7-07 / M7-08 / M7-09: snapshot voice-d1-snapshot-v1 giữ raw headers/cells bảy tabs, SHA-256 từng tab/toàn manifest, owner/freeze/timestamps/schema metadata. Reverse export thêm `_snapshot_json` để preserve null/optional fields; verify trước reopen GAS và clear transient metadata khi unfreeze, backup file không đổi. migration_runs có immutable source checksum, trạng thái importing/verified và chunk checkpoint. `writes_enabled = 'true'`, `source_epoch = 'prod_cutover_01'` đã được kích hoạt trên production D1.

M7-11 bổ sung tùy chọn thư viện operator `exportD1Snapshot(..., {onlyOwner:true})`, `importSnapshot/verifyImport(..., {preserveOtherOwners:true})` để phục hồi một owner vào DB đã có owner khác. Mặc định vẫn kiểm toàn DB và từ chối foreign owner. Opt-in chỉ giới hạn so sánh ID/hash theo owner bound SQL, không overwrite ID xung đột; quick_check/FK vẫn toàn DB. Full SQL backup và checksum dữ liệu owner khác trước/sau bắt buộc trong runbook phục hồi. Không thay auth/runtime repository hoặc mở đường import công khai.

M9-03: migration `0004_usage_daily.sql` thêm bảng vận hành `usage_daily`:

```sql
CREATE TABLE usage_daily (
  user_id TEXT NOT NULL,
  local_date TEXT NOT NULL,          -- ngày theo Asia/Ho_Chi_Minh, reset 0:00 giờ VN
  kind TEXT NOT NULL CHECK(kind IN ('chat_turn', 'translation', 'live_session')),
  used INTEGER NOT NULL DEFAULT 0 CHECK(used >= 0),
  updated_at TEXT NOT NULL,          -- ISO8601 UTC
  PRIMARY KEY (user_id, local_date, kind)
);
```

Check-and-consume nguyên tử bằng một câu UPSERT điều kiện: `INSERT ... ON CONFLICT(user_id,local_date,kind) DO UPDATE SET used=used+1 ... WHERE usage_daily.used < :cap RETURNING used` — không cần lock ngoài, nhiều isolate song song không vượt cap. Đây là bảng operational (không mirror sang Sheet, không nằm trong snapshot phục hồi); counter giữ lại theo ngày để audit, có thể prune định kỳ bằng SQL vận hành khi lớn.
