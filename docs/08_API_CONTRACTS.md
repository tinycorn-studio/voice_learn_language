# 08 — API Contract v1

> Contracts thiết kế, chưa có implementation Worker. Mọi endpoint trừ `/health` và Telegram webhook yêu cầu Telegram Mini App verified session. **Không** tin `user_id` từ request body là auth. Khi code M2/M3 tạo Zod schemas trong `packages/shared` và OpenAPI nếu cần.

## Global conventions

- Base: `https://<worker>/api/v1`. JSON UTF-8; header `Content-Type: application/json`; optional `X-Request-Id` (server generate nếu thiếu).
- Success: `{ "ok": true, "data": ..., "request_id": "..." }`.
- Error: `{ "ok": false, "error": { "code": "INVALID_ARGUMENT", "message": "...", "retryable": false }, "request_id": "..." }`.
- HTTP errors: 400 INVALID_ARGUMENT, 401 UNAUTHENTICATED, 403 FORBIDDEN, 409 CONFLICT, 429 RATE_LIMITED, 502 UPSTREAM_ERROR, 503 UNAVAILABLE, 504 TIMEOUT.
- Client auth: `Authorization: Bearer <short-lived-server-issued-session>` sau `POST /api/v1/auth/telegram` với raw `initData`. Không dùng client-supplied user_id.
- `event_id`: UUIDv4; one event retry reuse same value. Durations seconds, times RFC3339 UTC ISO. All data validated with strict limits.

## POST /api/v1/auth/telegram

Request: `{ "init_data": "query_id=...&user=...&auth_date=...&hash=..." }`.
Worker verifies Telegram signature, max auth age, allowlist. Response: `{ "ok":true,"data": {"session_token":"short-lived","expires_at":"...","user_id":"telegram:123"}}`.
Implementation option: same raw `init_data` verified on every request; if session approach used, token signed/expiring and never put in URL. Protect against replay/CSRF according to chosen auth architecture.

## POST /api/v1/live-token

No body or `{ "session_purpose":"voice_chat" }`. Response data: `{ "token":"ephemeral-...", "model":"gemini-3.8-live", "expires_at":"..." }`. `Cache-Control: no-store`. Limit issue rate/user; never long-term API key. Do not expose token in logs.

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

`?limit=10` → next due items (randomized with fairness cap). Response cards `{review_id, word_id, front, back?, due_at}`; don't leak answers in quiz frontend until appropriate reveal.

## POST /api/v1/reviews (M4)

Request `{ "event_id":"uuid", "word_id":"w_...", "rating":"again|hard|good|easy", "version":1 }`; `reviewed_at` optional, thời gian server là nguồn chuẩn. Response `{review_id,word_id,next_due_at,interval_days,repetitions,ease_factor,review_state,duplicate_event}`. Cùng event/body trả snapshot cũ và `duplicate_event:true`, không tính lại SRS. Version optional cho tương thích callback cũ; UI và keyboard mới luôn gửi version để chặn thẻ cũ.

## POST /telegram/webhook (private, external Bot API)

Verify secret header, request size and update_id before any side-effect. HTTP 200 only after update recorded or successfully dispatched; design retry budget/idempotency.

## GAS HMAC internal envelope

```json
{ "payload": "<EXACT_JSON_STRING>", "signature": "BASE64URL_HMAC_SHA256(payload)" }
```

`payload` schema: `{action, event_id, issued_at, user_id, data, request_id}`. Actions: `vocabulary.upsert`, `vocabulary.list`, `vocabulary.update`, `vocabulary.delete`, `review.listDue`, `review.record`, `review.claimDigest`, `review.finishDigest`, `user.preferences`. Response GAS `{ok:boolean,data?:{},error?:{code,message}}`; Worker validate schema từng action và translates status.

`review.claimDigest.data`: `{local_date,limit,now_iso}` → `{dispatch_id,already_dispatched,notifications_enabled,telegram_chat_id,due_cards,claim_token?}`. `review.finishDigest.data`: `{dispatch_id,claim_token,status:"sent|failed|unknown",message_id?}` → `{updated:true}`. Chỉ Worker được ký hai action này. Xem schema v2 và runbook migration.

Telegram callback mới: `r:<word_id>:<rating>:<version>`, tối đa 64 bytes, không cắt ngắn ID. Callback cũ thiếu version vẫn được hỗ trợ; retry cùng update_id có event_id ổn định trong GAS. In-memory dedup chỉ cache update đã xử lý thành công.

## Contract testing

Maintain JSON fixtures under `tests/contracts/` (tạo M2); valid/invalid/tamper/duplicate. Never use raw user voice content/secret trong fixtures.
