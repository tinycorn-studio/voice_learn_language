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
