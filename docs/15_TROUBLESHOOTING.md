# 15 — Troubleshooting / tình huống hay gặp

| Triệu chứng | Nguyên nhân khả dĩ | Kiểm tra / xử lý |
|---|---|---|
| `clasp push` không thấy Web App đổi | pushed HEAD, deployment chạy version cũ | `clasp deployments` → `clasp version` → `clasp redeploy` đúng ID |
| Apps Script 401/permission | Chưa authorize, dùng sai Google account/Script ID | bật Apps Script API, login, kiểm scopes, check Script Properties |
| GAS returns HTTP 200 nhưng app báo lỗi | GAS `ContentService` trả JSON nghiệp vụ | Worker parse `{ok:false}` + mapping lỗi, không chỉ check HTTP |
| Duplicate rows | retry cùng event không dedupe / Sheet concurrent | `event_id` + `ScriptLock`, read+append trong lock |
| Telegram webhook không nhận | URL sai, bot token, header secret, Telegram not started | `getWebhookInfo`, test webhook, check Worker logs đã redact |
| Telegram callback không đáp ứng | chưa gọi `answerCallbackQuery`, timeout GAS | ack callback phù hợp + queue xử lý, idempotency |
| Telegram Mini App login 401 | không mở trong Telegram, `initData` hết hạn/verify sai | log error code sanitized, so HMAC checkstring với official spec, relaunch app |
| Gemini model 404/429 | model deprecated/tier/quota | pricing/models/deprecations, rate limit, đổi model sau ADR |
| Gemini voice chỉ nghe 15 phút | session limit | compression, session resume, re-connect đúng docs |
| Mic không hoạt động trên iOS | webview permission / thiếu HTTPS / user gesture | test Safari và Telegram riêng, xin permission sau click, on-gesture playback |
| Chữ tiếng Việt lỗi | encoding terminal/Sheets | lưu UTF-8, Apps Script/GAS, proper font |
| Cron gửi sai giờ | Cron UTC | 08:00 VN = 01:00 UTC, test local_date +07 |
| Cron gửi trùng | send retries/ambiguous response | dispatch ID, statuses, dedupe theo ngày; thủ công điều tra last message |
| PowerShell script blocked | execution policy | `powershell -ExecutionPolicy Bypass -File .\scripts\Start-Session.ps1` |
| Vite init existing dir | folder đã có file | tránh overwrite, move/backup, init ở empty folder |

## Checklist debug trước khi hỏi AI
- Đọc `PROGRESS.md`, task, commit; đính kèm **message lỗi đã xóa secret**, platform/browsers, versions, steps reproduce, expected vs actual.
- Không gửi nguyên `.clasprc.json`, Telegram Bot Token, Gemini API Key, HMAC secret, private links chứa access token.
- Viết regression test cho lỗi sau khi sửa và cập nhật CHANGELOG/PROGRESS.
