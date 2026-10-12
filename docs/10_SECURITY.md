# 10 — Security Model & Threats

## Threat model
Assets: Gemini API key/billing/quota, Telegram bot token/user identity, vocabulary history, Sheet, OAuth refresh tokens/clasp, HMAC secret, session/ephemeral tokens.
Adversaries: người xem JS bundle, người gửi forged requests đến Worker hoặc GAS Web App, bot spam, Telegram initData replay, leaked CI logs, AI prompt injection trong lời nói/response.

## Controls required before public deploy
1. Long-lived secrets chỉ ở Worker Secrets / Apps Script Script Properties / secret manager; không ở frontend code/localStorage/Git. `.clasp.json` có script mapping, `.clasprc.json` có OAuth token; cả hai phải gitignored.
2. Auth: Telegram Mini App raw `initData` HMAC validated, `auth_date` TTL, user allowlist; không tin query params, `initDataUnsafe`, `user_id` do client gửi.
3. Bot webhook check Telegram secret header and `update_id` idempotency; không triển khai webhook không secret.
4. Worker→GAS HMAC-SHA256 trên raw payload string, UTC timestamp 300s, single event ID, rate limits; không tin public GAS URL là secret.
5. Gemini token `uses:1`, TTL ngắn, model constraint, authenticated issuance and per-user throttle.
6. CORS explicit allowlist domain app và local dev; CORS không phải auth.
7. Sheets formula injection guard; sanitize HTML rendering; do not expose raw spreadsheet URL to clients. Limit request/body fields & message sizes.
8. Privacy: chỉ lưu đoạn source 500 chars nếu thật sự cần; tắt log body và audio, data retention có thể opt out; thông báo rõ về Gemini Free Tier policies.
9. Least privilege: Script chỉ scope Google Sheets cần thiết; Google account tạo riêng hoặc project riêng cho app; CI deploy approval + secrets restricted.
10. Monitoring 401/403/429, failed signature, quota; tránh log IP + user identifiers unnecessarily; sanitize support logs.

## Auth of GAS Web App
Google Apps Script public Web App `doPost` không phải server HTTP linh hoạt: không dựa vào đọc custom request headers. HMAC bên trong JSON body + Script Properties là bắt buộc nếu deploy access Anyone. Nếu không thể bảo vệ endpoint đúng cách, thay Sheets write bằng Google Sheets REST API/OAuth từ Worker hoặc D1.

## Non goals / residual risks
- Apps Script + Sheets không transactional/strongly consistent như DB; ScriptLock chỉ bảo vệ trong một script project, không bảo vệ các sửa từ editor/manual side.
- Ephemeral token vẫn hiển thị trên client trong thời gian ngắn. Auth service cần rate-limit/quota.
- Telegram update delivery at-least-once; exactly-once reminder là best-effort (có thể duplicate khi timeout không rõ sendMessage đã thành công).
- Worker free CPU limit; phải benchmark HMAC/Spreadsheet latency.

## Secret rotation runbook
1. Detect leak, revoke token/API key ở provider ngay; rotate GAS shared secret **cả Worker và Apps Script** theo cơ chế downtime/dual-key thích hợp.
2. Update Worker secrets, Google Script Properties, Telegram setWebhook nếu đổi webhook secret, restart test, examine access logs.
3. Trước khi commit/hỗ trợ, xóa key khỏi logs/artifacts; chỉ `git rm` không loại bỏ lịch sử, cần purge history + revoke.
4. Ghi incident vào `PROGRESS.md` dưới dạng đã redact.

## Security test set
- Fake/old/tampered initData; wrong webhook header; invalid body/HMAC/replay; inject `=IMPORTXML(...)`; long strings; duplicate event; session bound to wrong user; unauthorized token issuance; CORS; secret scanning bundles.
