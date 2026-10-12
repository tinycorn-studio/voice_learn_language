# 24 — Triển khai online staging, M0-02

## Phạm vi và tiêu chí hoàn thành

Repo nguồn: https://github.com/tinycorn-studio/voice_learn_language.
M0-02 chỉ hoàn tất khi tài khoản/project staging, tier/quota và nơi giữ secrets
được xác minh. Chuẩn bị local hoặc mở trang đăng nhập chưa phải triển khai online.
M3-01 phụ trách Sheet/schema/clasp; M5-01 deploy, M5-02 nghiệm thu thực tế.

Người dùng đã đồng ý đăng nhập và tạo tài nguyên staging mới ngày 12/10/2026.
Mỗi bước OAuth/cấp quyền, lưu secrets, đổi webhook và deploy cần xác nhận riêng.
Không bật billing, không dùng VPS, không sửa tài nguyên production.

## Cấu hình đề xuất để xác nhận

| Thành phần | Staging mới | Trạng thái |
| --- | --- | --- |
| AI Studio | Project riêng, Gemini Live `gemini-3.8-live`, Free Tier | Chờ đăng nhập và kiểm quota project |
| Cloudflare Worker | `voice-chat-learn-language-worker-staging` | Cấu hình local, chưa tạo remote |
| Cloudflare Pages | `voice-chat-learn-language-staging` (tên dự kiến) | Chưa tạo remote; xác nhận URL thực trước CORS |
| Google Sheet | `VoiceChatLearnLanguage Staging`, private | Chưa tạo |
| Apps Script | `VoiceChatLearnLanguage Staging`, riêng biệt | Chưa tạo/push/authorize/deploy |
| Telegram | Bot staging riêng qua BotFather, Mini App HTTPS | Chưa tạo; username cần unique |

Worker dùng `apps/worker/wrangler.staging.toml`, ENVIRONMENT=staging để giữ auth
thật; không dùng development cho môi trường online. Cron ban đầu tắt.
Không gọi deploy với `apps/worker/wrangler.toml` production trong đợt staging.

## Thứ tự thao tác

1. Chủ tài khoản tự đăng nhập Google và Cloudflare; tự nhập mật khẩu/OTP.
2. Xác minh Free Tier/quota model trong AI Studio; không thêm phương thức thanh toán.
   Trước thử audio, xác nhận chính sách dữ liệu Free Tier với chủ tài khoản.
3. Tạo Sheet/Script staging private mới. Kiểm Script ID/Sheet ID rồi tạo mapping
   `apps-script/.clasp.json` gitignored. Không ghi giá trị vào evidence công khai.
4. Trước `clasp login`, trình bày màn hình OAuth và xin xác nhận quyền thực tế.
   Bật Apps Script API cũng là bước bảo mật cần xác nhận. Không đọc/in refresh token.
5. Pull source cloud vào thư mục backup riêng gitignored, diff với Git; push chỉ
   sau khi xác nhận đích và diff. Tuyệt đối không `pull` đè `apps-script/`.
6. Xác nhận Script Properties: SHEET_ID, GAS_SHARED_SECRET, OWNER_USER_ID dạng
   `telegram:<numeric_id>`, MAX_EVENT_AGE_SECONDS=300. Lấy ID owner từ Telegram
   đã xác thực, không dùng dịch vụ bot bên thứ ba để đọc thông tin cá nhân.
7. M3-01: Sheet mới chạy `setupSheets()`, inspect `migrateSchemaV3(true)`, apply
   `migrateSchemaV3(false)` sau xác nhận, inspect lần hai N=0. Sheet có dữ liệu
   phải backup toàn bộ trước; xem `FSRS_MIGRATION.md`.
8. Sau local gates và kiểm HMAC, xin xác nhận Web App: Execute as Me, Anyone.
   Đây là endpoint public bảo vệ bằng HMAC; Sheet vẫn private. Ghi version để rollback.
9. Tạo bot staging qua BotFather bằng thao tác của chủ tài khoản; gửi `/start`.
   Không gửi token trong chat. Kiểm getMe trước lưu token và cấu hình webhook.
10. Xin xác nhận Cloudflare OAuth hoặc API token giới hạn account/project. Nạp
    GEMINI_API_KEY, TELEGRAM_BOT_TOKEN, TELEGRAM_WEBHOOK_SECRET, OWNER_TELEGRAM_ID,
    SESSION_SIGNING_SECRET, GAS_SHARED_SECRET, GAS_EXEC_URL qua secret prompt
    vào đúng Worker staging. SESSION_SIGNING_SECRET riêng, không dùng fallback HMAC.
11. M5-01: xác nhận deploy Worker staging sau gates. Pages build từ repo root:
    `npm ci`, `npm run build`, output `apps/web/dist`, public variable
    VITE_API_BASE_URL bằng URL Worker thực (không có dấu slash cuối).
    Xác nhận URL Pages thực, cập nhật ALLOWED_ORIGIN chính xác trước mở app.
12. Xác nhận setWebhook với secret_token, allowed_updates message/callback_query;
    kiểm getWebhookInfo. Xác nhận menu button Mini App trỏ đúng Pages HTTPS.
13. M5-02: voice hỏi một từ → đúng một Word/Card; retry không nhân đôi;
    Again/Hard/Good/Easy preview/submit và Reviews snapshot; Telegram callback;
    kiểm PC/Android/iOS, Stop/reconnect. Sau đó mới xác nhận bật Cron staging.

## Kiểm chứng local trước publish

```powershell
npm run typecheck
npm run lint
npm test
npm run build
.\scripts\Check-Secrets.ps1
$env:WRANGLER_LOG_PATH = Join-Path $PWD '.artifacts/wrangler-staging.log'
$env:WRANGLER_SEND_METRICS = 'false'
wrangler deploy --dry-run --config apps/worker/wrangler.staging.toml --outdir .artifacts/worker-staging
git diff --check
```

Dry-run không publish. Trước publish kiểm tra không nhúng secret vào bundle web.
Mỗi remote task ghi UTC+7, commit, version, kết quả và next action vào PROGRESS;
chỉ chạy Complete-Task khi acceptance thực tế đạt. Không ghi tokens/owner PII.

## CI/CD và điểm phê duyệt

CI hiện chạy typecheck/lint/test/build trên PR/main và feat/fix branches.
CD chưa được triển khai. Sau M0-02 cần chuẩn bị workflow thủ công, trỏ rõ staging,
chạy gates trên đúng commit rồi publish với protected environment nếu gói GitHub
hỗ trợ. Kiểm repo visibility và tính khả dụng required reviewers trước khi lưu
credentials; nếu không hỗ trợ approval gate thì giữ deploy local có xác nhận.
Không tự bật Pages Git integration auto deploy trước khi thống nhất approval gate.

Apps Script giữ clasp local trước; không đưa OAuth refresh token vào Actions khi
chưa duyệt chính sách secret storage/branch protection. Không auto deploy production.
CI/CD chỉ được ghi hoàn tất khi một run thật có evidence, không chỉ có YAML.

## Nguồn chính thức đã đối chiếu ngày 12/10/2026

- Gemini Live/ephemeral v1beta: https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- Giá Gemini: https://ai.google.dev/gemini-api/docs/pricing — Live có Free Tier;
  dữ liệu Free Tier được dùng cải thiện sản phẩm. Quota project phải kiểm riêng.
- Workers: https://developers.cloudflare.com/workers/platform/limits/ — Free
  100.000 request/ngày, 10 ms CPU/request; cần đo FSRS thực tế, không bảo đảm bằng unit test.
- Pages React: https://developers.cloudflare.com/pages/framework-guides/deploy-a-react-site/
- clasp: https://developers.google.com/apps-script/guides/clasp
- Apps Script quota: https://developers.google.com/apps-script/guides/services/quotas
- Mini App: https://core.telegram.org/bots/webapps

## Evidence phiên hiện tại

Baseline Git sạch tại e2c447c; branch `feat/M0-02-online-staging`.
clasp 3.4.1, Wrangler 4.149.0 đã có. Typecheck/lint PASS, 85 tests/15 files PASS,
build PASS, Wrangler staging dry-run PASS (248,96 KiB, gzip 47,21 KiB), tracked
secret scan và git diff --check PASS. Test/build bị sandbox EPERM lần đầu; chạy
lại ngoài sandbox được hệ thống xét duyệt cho phép và PASS, không sửa source để né test.
Public bundle scan: không có credential patterns/backend secret names.

Người dùng đã đăng nhập Google. AI Studio hiển thị tài khoản nhưng API keys báo
permission denied, biểu mẫu Create project trống và reload trở lại trang lỗi 520
(Unable to check your Google AI Subscription). Chưa tạo project/key staging,
chưa xác minh quota. Không chọn project cũ để thay thế staging.

Cloudflare đang ở trang login, chờ chủ tài khoản tự đăng nhập/xử lý điều khoản.
Mở Google Sheets bị automatic approval review chặn: vượt retry limit, HTTP 429
của bộ xét duyệt; hành động không chạy. Không thử đường vòng. Chờ chủ tài khoản
tự tạo Sheet/Script staging private và gửi URL, hoặc khôi phục quyền công cụ.
Người dùng đã chọn tự tạo Sheet/Script và đăng nhập Cloudflare; chờ URL/xác nhận
đăng nhập thành công trước thao tác tiếp.

Chưa tạo tài nguyên remote, chưa cấp OAuth, chưa lưu secrets, chưa deploy hoặc
đổi dữ liệu Sheets. Không chạy Complete-Task vì M0-02 chưa đạt acceptance.
