# 08 — API Contract v1

> Implementation Worker tại `apps/worker/src/entry.ts`, Zod schemas trong `packages/shared`. `/health` không yêu cầu auth; auth Telegram nhận initData để xác minh, webhook dùng secret header, các route dữ liệu dùng verified session. **Không** tin `user_id` từ request body là auth. Trạng thái nghiệm thu production xem `PROGRESS.md`.

## Global conventions

- Base: `https://<worker>/api/v1`. JSON UTF-8; header `Content-Type: application/json`; optional `X-Request-Id` (server generate nếu thiếu).
- Success: `{ "ok": true, "data": ..., "request_id": "..." }`.
- Error: `{ "ok": false, "error": { "code": "INVALID_ARGUMENT", "message": "...", "retryable": false }, "request_id": "..." }`.
- HTTP errors: 400 INVALID_ARGUMENT, 401 UNAUTHENTICATED, 403 FORBIDDEN, 409 CONFLICT, 429 RATE_LIMITED, 502 UPSTREAM_ERROR, 503 UNAVAILABLE, 504 TIMEOUT.
- Client auth: `Authorization: Bearer <short-lived-server-issued-session>` sau `POST /api/v1/auth/telegram` với raw `initData`. Không dùng client-supplied user_id.
- `event_id`: UUIDv4; one event retry reuse same value. Durations seconds, times RFC3339 UTC ISO. All data validated with strict limits.
- M5-07: frontend tạo `X-Request-Id: web-<24 hex>` mới cho mỗi lần gọi API, kể cả retry; đây là mã chẩn đoán, không thay `event_id` idempotency. Worker hiện có echo mã này trong envelope và response header, `api_error` ghi cùng mã. CORS đã cho phép `x-request-id`; frontend đọc envelope vì response header chưa được expose qua CORS.
- Probe `GET /health` không gửi authorization, initData, body hoặc custom header để không tạo preflight. Response data hiện có `{status:"healthy",service:"voice-chat-worker",version,timestamp}`; chỉ xác nhận Worker reachable, không xác nhận Gemini/Sheets/auth. Probe có client ID nội bộ và server UUID riêng trong log.
- M5-09 (đã deploy 13/10): `gas_fetch_failed` là log nội bộ cho exception khi Worker fetch GAS, giữ cùng request_id với API response. Metadata action/phase/reason (`ILLEGAL_INVOCATION`, `TIMEOUT`, `FETCH_FAILED`)/exception name whitelist/duration/http_status null; không ghi endpoint/body/signature/secret/user ID/raw error. Public API giữ 503 `UNAVAILABLE` và thông báo cố định, không mở endpoint debug.

## POST /api/v1/auth/telegram

Request: `{ "init_data": "query_id=...&user=...&auth_date=...&hash=..." }`.
Worker verifies Telegram signature, max auth age, allowlist. Response: `{ "ok":true,"data": {"session_token":"short-lived","expires_at":"...","user_id":"telegram:123"}}`.
Implementation option: same raw `init_data` verified on every request; if session approach used, token signed/expiring and never put in URL. Protect against replay/CSRF according to chosen auth architecture.

## POST /api/v1/live-token

No body or `{ "session_purpose":"voice_chat" }`. Response data: `{ "token":"ephemeral-...", "model":"gemini-3.8-live", "expires_at":"..." }`. `Cache-Control: no-store`. Limit issue rate/user; never long-term API key. Do not expose token in logs.

M5-10: Public contract không đổi. Worker gửi REST `AuthToken` gồm `uses:1`, TTL 20 phút, new-session TTL 1 phút, `bidiGenerateContentSetup` và `fieldMask: "model,generationConfig.responseModalities"`; khóa model/audio, giữ các field khác từ setup client. Không gửi SDK wrapper `liveConnectConstraints` trực tiếp. Google HTTP 400 map public 502 `UPSTREAM_ERROR`, retryable false; đây chưa phải bằng chứng quota (429 có mapping riêng) hoặc key sai. Xem docs/04_GEMINI_SETUP.md và evidence M5-10.

## POST /api/v1/vocabulary

```json
{
  "event_id": "1c11d5a4-92a8-4bcc-b3fa-f03c9ce2c4b1",
  "word": "overwhelmed",
  "part_of_speech": "adjective",
  "sense_key": "feeling_unable_to_cope",
  "meaning_vi": "quá tải, choáng ngợp",
  "example": "I feel overwhelmed by work.",
  "source_excerpt": "What does overwhelmed mean?"
}
```

Response `{ "ok":true,"data":{"word_id":"w_...","created":true,"duplicate_event":false}}`.
Constraints: `word` 1–120 chars, `meaning_vi` <=300, `example` <=500, `source_excerpt` <=500, `part_of_speech` enum, normalized key server-side. Validate UTF8 and reject HTML/script injection in UI via escaping.

- Duplicate event_id: return original result; no increment.
- Existing lemma/POS/sense: update last_asked_at/increment times_asked once per **new** event; preserve correction unless explicit user edit.

## GET /api/v1/vocabulary?cursor=...&limit=20 (M3-03)

Only caller-owned words. Paginated response `{items:[{word_id,word,meaning_vi,created_at,...}],next_cursor:null}`. `limit<=50`, bounded Sheet reads, server validation.

## PATCH /api/v1/vocabulary/:id (M3-03)

Fields: `{ "event_id":"uuid", "version":1, "meaning_vi":"...", "example":"..." }`; có thể sửa `part_of_speech`/`sense_key`. Response là VocabularyItem. Version dùng optimistic conflict; kiểm unique word_key trước khi ghi. Retry cùng event/body trả snapshot ban đầu kể cả version đã tăng; đổi payload trên cùng event trả 409.

## DELETE /api/v1/vocabulary/:id (M3-03)

Query bắt buộc `?event_id=uuid`. Soft delete `deleted_at`, loại khỏi lịch ôn và xác minh owner. Retry cùng ID trả kết quả cũ, không tăng version hoặc xóa lại một từ đã restore. Response `{word_id,deleted:true}`.

## GET /api/v1/reviews/due (M4)

`?limit=10` (1–50) → `{items: DueReviewCard[]}`. Mỗi item có review_id, card_id, card_type, word_id, word/lemma/part_of_speech/meaning_vi/example/source_excerpt, due_at, review_state, repetitions, interval_days, ease_factor, version; trường FSRS state, due_at_utc, stability/difficulty, scheduled_days, reps/lapses, row_version. State là chuỗi New/Learning/Review/Relearning, không phải enum số. Version ở danh sách này là **Card version**; Words.version dùng riêng CRUD.

Một Word có nhiều Cards có thể xuất hiện nhiều lần với card_id khác nhau. Chỉ Cards thuộc Word active, không suspended và đã đến hạn. Response không có total_due; xem stats cho tổng. UI chỉ hiện đáp án sau reveal.

## GET /api/v1/reviews/:cardId/preview (M4)

Response data:

```json
{
  "card_id": "c_w_123",
  "word_id": "w_123",
  "row_version": 2,
  "preview": {
    "again": {
      "rating": "again",
      "state": "Learning",
      "next_due_at": "2026-10-12T01:01:00.000Z",
      "interval_days": 0,
      "stability": 1,
      "difficulty": 5
    },
    "hard": {
      "rating": "hard",
      "state": "Learning",
      "next_due_at": "2026-10-12T01:06:00.000Z",
      "interval_days": 0,
      "stability": 2,
      "difficulty": 5
    },
    "good": {
      "rating": "good",
      "state": "Learning",
      "next_due_at": "2026-10-12T01:10:00.000Z",
      "interval_days": 0,
      "stability": 3,
      "difficulty": 5
    },
    "easy": {
      "rating": "easy",
      "state": "Review",
      "next_due_at": "2026-10-16T01:00:00.000Z",
      "interval_days": 4,
      "stability": 4,
      "difficulty": 5
    }
  }
}
```

Ví dụ chỉ minh họa cấu trúc, không phải fixtures interval/weights cố định. Client định dạng next_due_at; không suy 1m/10m từ interval_days=0. Preview không ghi dữ liệu. Card đã xóa/suspended không preview được.

## POST /api/v1/reviews/submit (M4)

Alias legacy: POST /api/v1/reviews.

```json
{
  "event_id": "1c11d5a4-92a8-4bcc-b3fa-f03c9ce2c4b1",
  "card_id": "c_w_123",
  "rating": "good",
  "expected_version": 2
}
```

- Rating: again/hard/good/easy. Backend là nguồn lịch duy nhất.
- Có ít nhất card_id hoặc word_id. Word alias dùng Card mặc định/đầu tiên; client mới luôn gửi card_id. Nếu có cả hai phải cùng Word.
- expected_version là Card.row_version, version là alias legacy; không dùng Words.version. Client mới luôn gửi expected_version; nếu legacy không gửi, Worker đọc version hiện tại và GAS vẫn khóa/kiểm OCC.
- reviewed_at có trong schema tương thích nhưng Worker dùng thời gian server, không tin thời gian client.
- Response data có review_id, card_id, word_id, next_due_at, interval_days, repetitions, ease_factor, review_state, state, stability, difficulty, reps, lapses, row_version, idempotent_replay, duplicate_event. review_state legacy ánh xạ Relearning → learning; state FSRS vẫn Relearning.
- Cùng event và client payload trả snapshot cũ với replay/duplicate=true, không tính lại; đổi Card/Word/rating/expected_version/version trên cùng event trả 409. Thời gian server/config đổi không ảnh hưởng replay.
- Stale Card trả 409; Word edit không làm stale Card. Hai events chấm cùng version chỉ một được ghi. Review tồn tại thiếu Events snapshot trả 409 để đối chiếu, không báo thành công từ dữ liệu hiện tại.

## GET /api/v1/reviews/stats (M4)

Response data: `{due_today,completed_today,new_cards,learning_cards,review_cards,relearning_cards,total_active_cards,total_reviews_count}`, các số nguyên không âm. Ngày theo UTC+7; due_today gồm overdue và thẻ đến hạn trước cuối ngày. Completed_today/total_reviews_count đếm review events (có thể nhiều lần trên một Card); active totals loại Word đã xóa và thẻ suspended.

## POST /telegram/webhook (private, external Bot API)

Verify secret header, request size and update_id before any side-effect. HTTP 200 only after update recorded or successfully dispatched; design retry budget/idempotency.

M7-02 local: callback message nhận thêm `message_id` optional. Sau auth/validation bot ACK “Đang ghi nhận…” trước persistence; chỉ edit kết quả/next_due sau commit và gỡ keyboard. ACK không phải success review; mutation giữ event/version/retry hiện hành. Durable result delivery triển khai M7-05 trước release D1.

## GAS HMAC internal envelope

```json
{ "payload": "<EXACT_JSON_STRING>", "signature": "BASE64URL_HMAC_SHA256(payload)" }
```

`payload` schema: `{action, event_id, issued_at, user_id, data, request_id}`.
Actions hỗ trợ:

- Từ vựng: `vocabulary.upsert`, `vocabulary.list`, `vocabulary.update`, `vocabulary.delete`
- Thẻ FSRS: `card.get`
- Ôn tập FSRS: `review.listDue`, `review.record`, `review.lookup`, `review.stats`
- Thông báo: `review.claimDigest`, `review.finishDigest`
- Cài đặt: `user.preferences`

Response GAS `{ok:boolean,data?:{},error?:{code,message}}`; Worker validate schema từng action và translates status.

`review.claimDigest.data`: `{local_date,limit,now_iso}` → `{dispatch_id,already_dispatched,notifications_enabled,telegram_chat_id,due_cards,claim_token?}`. `review.finishDigest.data`: `{dispatch_id,claim_token,status:"sent|failed|unknown",message_id?}` → `{updated:true}`. Chỉ Worker được ký hai action này. Xem schema v2/v3 và runbook migration.

Telegram callback mới: `r:<card_id>:<rating>:<row_version>`, tối đa 64 bytes, không cắt ngắn ID. Callback cũ thiếu version vẫn được hỗ trợ; retry cùng update_id có event_id ổn định trong GAS. In-memory dedup chỉ cache update đã xử lý thành công.

## Contract testing

M7-01 (local, chưa deploy): bản chẩn đoán frontend `mini-app-api-diagnostics-v1` giữ `attempts` và thêm `capture` metadata bounded 100 (stage/reason/path/elapsed_ms/capture_id/timestamp). Không thêm route thu transcript; dữ liệu chỉ giữ memory và copy theo thao tác người dùng. Worker/GAS log timing chỉ route template/action/status/correlation, không body hoặc raw errors.

Maintain JSON fixtures under `tests/contracts/` (tạo M2); valid/invalid/tamper/duplicate. Never use raw user voice content/secret trong fixtures.
