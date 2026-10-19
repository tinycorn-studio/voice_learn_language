# 07 — Telegram Bot + Telegram Mini App

## 1. Tạo bot

1. Vào Telegram tìm `@BotFather` (tài khoản đã xác minh), `/newbot`, nhập tên/username, nhận bot token.
2. Giữ token trong secret manager, không commit/đưa vào chat. Token cho phép điều khiển bot.
3. Chat `/start` với bot để cho phép bot nhắn tin; lấy `chat.id` và `from.id` từ webhook test tạm thời/log **đã che token**, hoặc một script local riêng an toàn. Cấu hình `OWNER_TELEGRAM_ID` ở Worker. Không tin user ID do client gửi.
4. **M9-02 multi-user:** thêm người dùng qua secret `ALLOWED_TELEGRAM_IDS` (danh sách số id cách nhau dấu phẩy/khoảng trắng/chấm phẩy, ví dụ `111222333,444555666`). Owner trong `OWNER_TELEGRAM_ID` luôn được gộp vào danh sách. Auth Mini App, session token, webhook Bot đều check membership; dữ liệu cô lập theo `telegram:<id>`; mirror Google Sheet chỉ chạy cho owner. `wrangler secret put` tự publish version mới (không cần deploy lại code):

```powershell
npx wrangler secret put ALLOWED_TELEGRAM_IDS
```

User mới cần `/start` với bot trước để nhận được digest (bot không nhắn được cho người chưa mở chat). Chỉ mở thêm user khi các cap ngày M9-03 đã hoạt động. 5. **M9-03 miễn hạn mức:** owner mặc định được miễn cap ngày; muốn miễn thêm id khác thì set secret `UNCAPPED_TELEGRAM_IDS` (cùng định dạng danh sách). Id miễn không ghi counter `usage_daily` và không bao giờ bị 429 vì cap. 6. Thiết kế commands: `/start`, `/review`, `/words`, `/stats`, `/pause`, `/help`; bot có thể dùng inline keyboard để đánh giá Again/Hard/Good/Easy.

## 2. Set webhook khi Worker HTTPS đã sẵn sàng

Gọi `setWebhook` qua script local/PowerShell sử dụng secret environment/session prompt (không copy token literal vào terminal history):

```powershell
$token = Read-Host 'Paste TELEGRAM_BOT_TOKEN'
$webhookSecret = Read-Host 'Paste TELEGRAM_WEBHOOK_SECRET'
$endpoint = 'https://YOUR-WORKER.workers.dev/telegram/webhook'
$body = @{ url = $endpoint; secret_token = $webhookSecret; allowed_updates = @('message','callback_query') } | ConvertTo-Json -Depth 4
Invoke-RestMethod -Method Post -Uri "https://api.telegram.org/bot$token/setWebhook" -ContentType 'application/json' -Body $body
Remove-Variable token,webhookSecret,body
```

**Lưu ý:** `Read-Host` token hiển thị trong terminal; dùng `Read-Host -AsSecureString` và secret manager/script riêng cho production. Trong PowerShell transcript/history/session cũng có rủi ro; đóng session sau khi setup. Không paste output token vào tickets.

- `secret_token` chỉ cho phép A-Z, a-z, 0-9, `_`, `-` (theo Telegram). Worker kiểm tra `X-Telegram-Bot-Api-Secret-Token` trên mọi update.
- Kiểm tra `getWebhookInfo` (không log URL bot token). Long polling `getUpdates` không dùng đồng thời với webhook.

## 3. Cấu hình Mini App

- Frontend deploy HTTPS có URL `https://...` từ Cloudflare, sau đó `/setmenubutton` ở BotFather (hoặc Bot API) trỏ đến URL Mini App.
- `window.Telegram.WebApp` cần Telegram SDK script theo docs; `ready()` và `expand()` sau init; có fallback local dev browser.
- Telegram `initData` là chuỗi raw signed, gửi tới Worker để xác thực; **không tin `initDataUnsafe`**.
- Worker xác thực bằng HMAC-SHA256 chuẩn Telegram: secret_key = HMAC_SHA256(key="WebAppData", message=BOT_TOKEN) (chú ý đúng thứ tự trong code theo docs), data-check-string là các `key=value` sorted trừ `hash`, nối `\n`; so sánh constant-time hash (hex), kiểm `auth_date` tuổi thọ <= 3600 giây, allowlist `user.id`. Viết integration test dựa trên vectors chuẩn.
- Token login/API session short-lived; mọi route private recheck verified session. CORS chỉ cho URL app production; HTTPS.

## 4. Quiz review

- Bot gửi `sendMessage` inline buttons chứa callback data dạng `r:<short_review_id>:<rating>`. Telegram có giới hạn bytes callback_data: không nhét từ, nghĩa hoặc auth token.
- Worker verify webhook secret, dedupe `update_id` và callback, query context từ GAS, xác nhận user, score SRS, gọi `answerCallbackQuery` trong thời gian hợp lý và cập nhật bản ghi.
- Có thể làm `Open Mini App` button + điều hướng trang review, không cần backend long polling.
- Bot chỉ gửi tin cho user đã bắt đầu chat; `/pause` đặt `notifications_enabled=false`.

## 5. Troubleshooting

- Mini App báo lỗi kết nối: xem [runbook kiểm tra API/CORS và timeout WebView](23_TELEGRAM_CONNECTION.md); kiểm tra bundle đang public, không kết luận lỗi mạng chỉ từ thông báo UI.
- Webhook im lặng: URL HTTPS, `getWebhookInfo` last_error_message, secret header, allowlist user, Worker 2xx.
- 401 Mini App: WebApp initData thiếu/expired (chạy từ browser thường) hoặc HMAC sai; test trong Telegram.
- Bot không tự gửi được: user chưa `/start` hoặc block bot, `chat_id` không hợp lệ.
- Callback lặp: Telegram có thể retry; idempotency bắt buộc.

## Official refs

https://core.telegram.org/bots/api
https://core.telegram.org/bots/webapps
