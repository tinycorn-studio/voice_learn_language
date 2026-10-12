# 06 — Cloudflare Workers / host / Cron / secrets

## I. Tài khoản và khởi tạo

- Đăng ký miễn phí tại https://dash.cloudflare.com. Dùng Node LTS + Wrangler.
- Trong project root:

```powershell
npm create cloudflare@latest -- apps/worker
# Chọn Worker TypeScript; nếu CLI hỏi deploy thì chọn No đến khi auth chạy.
Set-Location .\apps\worker
npx wrangler login
npx wrangler whoami
npx wrangler dev
```

- `wrangler.toml` hoặc `wrangler.jsonc` giữ version-controlled, không chứa secrets. `compatibility_date` dùng ngày thực tế thử nghiệm + xác minh docs.
- Static frontend host trên Cloudflare Pages hoặc Workers Static Assets; HTTPS để mic + Telegram.

## II. Secret bindings

Từ `apps/worker` chạy lần lượt:

```powershell
npx wrangler secret put GEMINI_API_KEY
npx wrangler secret put TELEGRAM_BOT_TOKEN
npx wrangler secret put TELEGRAM_WEBHOOK_SECRET
npx wrangler secret put GAS_SHARED_SECRET
npx wrangler secret put GAS_EXEC_URL
npx wrangler secret put OWNER_TELEGRAM_ID
```

Commands nhập giá trị qua prompt; đừng dùng `echo token` để tránh history/log. Với local `wrangler dev`, có thể dùng `.dev.vars` **gitignored** chứa giá trị dev riêng; không reuse production tokens.

## III. Route contract

- `GET /health`: không lộ secrets, có build/version, timestamp.
- `POST /api/v1/live-token`: verify `initData`; allowlist Telegram user; quota; cấp Gemini ephemeral token restricted, `Cache-Control: no-store`.
- `POST /api/v1/vocabulary`: verify auth + Zod; idempotency; call GAS signed; return `word_id`, status.
- `GET /api/v1/vocabulary`: sử dụng POST authenticated qua GAS `vocabulary.list` (sẽ tạo M3-03) để đọc từ đúng user; hoặc schema riêng nếu không thể dùng GAS do constraints.
- `POST /api/v1/reviews`: review score, next due (M4).
- `POST /telegram/webhook`: check secret header, parse/update validate, `update_id` idempotency.
- `scheduled(controller, env, ctx)`: daily digest (M4); không có endpoint public gọi Cron production.

## IV. Cấp token Gemini (lệnh REST server side)

Cloudflare Worker dùng `fetch('https://generativelanguage.googleapis.com/v1beta/auth_tokens', { method:'POST', headers: { 'x-goog-api-key': env.GEMINI_API_KEY, 'content-type':'application/json' }, body: JSON.stringify({ uses:1, expireTime:..., newSessionExpireTime:..., liveConnectConstraints: { model:'models/gemini-3.8-live', config: { responseModalities:['AUDIO'] }}})})`.

- Chỉ gọi sau khi Telegram `initData` hợp lệ, `auth_date` fresh, `user.id === OWNER_TELEGRAM_ID`.
- Trả token tạm, không API key; thử ở staging. Token service đang preview; API version `v1beta`.
- Worker Free CPU budget thấp: không thực hiện streaming audio/long LLM inference ở Worker.

## V. Telegram webhook auth

`X-Telegram-Bot-Api-Secret-Token` phải bằng secret đã setWebhook; kết hợp validation nội dung và allowlist Telegram user ID cho mọi command/callback.

## VI. HMAC Apps Script

Tạo `payload = JSON.stringify({...})` **một lần**, UTF8; dùng Web Crypto `crypto.subtle.importKey` HMAC/SHA-256, `crypto.subtle.sign`; encode base64url; POST `{payload,signature}` đến `GAS_EXEC_URL`.

- GAS Script Properties có cùng `GAS_SHARED_SECRET`.
- Parse GAS JSON body `{ok:false,...}`; Apps Script ContentService có thể redirect URL, HTTP status 200 không đồng nghĩa nghiệp vụ thành công.
- Timeout, retry only for transient; same event_id for retries. Do not relay untrusted arbitrary JSON directly to Sheets.

## VII. Cron timezone

Cloudflare Cron Trigger chạy theo **UTC**. Lịch gửi 08:00 Việt Nam = `01:00 UTC`:

```toml
[triggers]
crons = ["0-5 1 * * *"]
```

Tick đầu lúc 08:00 +07; tick mỗi phút đến 08:05 để retry lỗi xác định và phát hiện claim treo. Một digest mỗi ngày, tối đa 3 send attempts; sent/unknown không tự gửi lại. Trong Worker `scheduled()` claim `dispatch_id`, gửi Telegram rồi `review.finishDigest`. Cron **không đảm bảo chạy đúng phút tuyệt đối**; dispatch phải dedupe. Claim/finish lỗi không được nuốt; theo dõi scheduled invocation failures.

## VIII. Deploy / rollback

```powershell
npx wrangler dev
npx wrangler deploy
# Ghi deployment id + commit hash vào PROGRESS
```

Trước production: `typecheck/lint/test/build`, check secrets/policy/CORS origin, test Telegram auth and signature tampering. Rollback bằng deployment version trước trong dashboard hoặc CLI theo phiên bản Wrangler đang cài. Không tự rollback dữ liệu Sheets nếu schema đã đổi; sử dụng backup/migration.

## Official refs

- https://developers.cloudflare.com/workers/get-started/guide/
- https://developers.cloudflare.com/workers/configuration/cron-triggers/
- https://developers.cloudflare.com/workers/platform/limits/
- https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
