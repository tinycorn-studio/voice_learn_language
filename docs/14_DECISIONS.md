# 14 — Architecture Decision Records (ADRs)

Mọi thay đổi lớn tạo ADR mới bằng `docs/templates/ADR_TEMPLATE.md`, ghi context, alternatives, consequence, owner, date, status và link PR/task.

## ADR-001 — Telegram Mini App là auth/entrypoint production (One-User Allowlist)

- Date: 2026-10-12
- Status: Accepted (chốt tại M0-03)
- Owner: Project Owner
- Decision:
  1. **Production Entrypoint:** Ứng dụng web (`apps/web`) chạy bên trong **Telegram Mini App** (trên Telegram Mobile/Desktop).
  2. **One-User Auth:** Frontend gửi chuỗi raw `window.Telegram.WebApp.initData` tới `POST /api/v1/auth/telegram`. Worker xác minh chữ ký HMAC-SHA256 (`WebAppData`), kiểm tra `auth_date` (TTL <= 3600s), đối chiếu `user.id` với `OWNER_TELEGRAM_ID` allowlist, và cấp `session_token` ngắn hạn (HMAC-signed Bearer token) gắn với `user_id = telegram:<id>`.
  3. **Local Dev Fallback:** Trình duyệt standalone chỉ được phép hoạt động khi `ENVIRONMENT=development` trên `localhost` thông qua dev bypass tường minh, tuyệt đối tắt trên `staging`/`production`.
- Rationale: Tránh tự xây hệ thống mật khẩu/OAuth riêng hoặc mở anonymous endpoint làm lộ quota Gemini Live API.
- Tradeoff: Phụ thuộc môi trường Telegram WebView ở production; cần xử lý kỹ quyền micro và user gesture trên iOS/Android WebView.

## ADR-002 — Google Sheets làm database v1 qua Repository Adapter

- Date: 2026-10-12
- Status: Accepted (chốt tại M0-03)
- Owner: Project Owner
- Decision: Dùng Google Apps Script Web App (`doPost`) + Google Sheets 5 tabs (`Words`, `Events`, `Reviews`, `Users`, `DailyDispatchLog`), giao tiếp với Worker qua envelope ký HMAC-SHA256. Trong `apps/worker`, toàn bộ truy cập dữ liệu đi qua interface `VocabularyRepository` và `ReviewRepository`.
- Rationale: Miễn phí trong quota cá nhân, dễ quan sát và chỉnh sửa trực tiếp trên bảng tính, không tốn chi phí duy trì DB server.
- Tradeoff: Không có ACID transaction chuẩn và độ trễ cao hơn DB native; bắt buộc dùng `LockService.getScriptLock()` + bảng `Events` để đảm bảo idempotency, và sẵn sàng thay bằng Cloudflare D1 khi vượt quy mô cá nhân.

## ADR-003 — Bỏ n8n và Anki khỏi MVP

- Date: 2026-10-12
- Status: Accepted (chốt tại M0-03)
- Owner: Project Owner
- Decision: Cloudflare Worker (Webhook + Cron UTC `0 1 * * *`) và Telegram Bot/Mini App tự xử lý lịch nhắc ôn cùng thuật toán SRS deterministic (`packages/shared/src/srs`).
- Rationale: Không cần bật PC hay tự host VPS 24/7 cho n8n/AnkiConnect; giảm phụ thuộc hệ thống ngoài.
- Tradeoff: Tự hiện thực và kiểm thử bộ lập lịch SRS cơ bản (Again/Hard/Good/Easy).

## ADR-004 — Quản lý Google Apps Script bằng Git + clasp

- Date: 2026-10-12
- Status: Accepted (chốt tại M0-03)
- Owner: Project Owner
- Decision: `apps-script/Code.gs` và `apps-script/appsscript.json` trong Git là nguồn chuẩn duy nhất. Mọi cập nhật thực hiện tại repo, kiểm thử tự động bằng mock GAS runtime trước khi `clasp push`, `clasp version` và `clasp redeploy`.
- Risk & Mitigation: `.clasp.json` và `.clasprc.json` bị chặn hoàn toàn trong `.gitignore` và kiểm tra tự động qua `scripts/Check-Secrets.ps1`; cấm `clasp push --force` mặc định.

## ADR-005 — Kết nối trực tiếp Gemini Live API bằng Ephemeral Token

- Date: 2026-10-12
- Status: Accepted (chốt tại M0-03)
- Owner: Project Owner
- Decision: Worker xác thực người dùng và gọi Google `v1beta/auth_tokens` để cấp ephemeral token (`uses: 1`, TTL ngắn, khóa model `models/gemini-3.8-live`). Trình duyệt kết nối WebSocket trực tiếp tới Gemini Live API, không proxy luồng âm thanh qua Worker.
- Rationale: Giảm độ trễ hội thoại thời gian thực, tránh vượt giới hạn CPU/bandwidth của Cloudflare Worker Free Tier, đồng thời bảo vệ tuyệt đối `GEMINI_API_KEY` ở tầng backend.
- Tradeoff: Cần quản lý vòng đời phiên (reconnect, session resumption, goAway) ở phía client.

## ADR-006 — Deploy Topology & Phân tách Môi trường (Local / Staging / Production)

- Date: 2026-10-12
- Status: Accepted (chốt tại M0-03)
- Owner: Project Owner
- Decision:
  1. **Monorepo Workspaces:** Quản lý bằng npm workspaces tại root gồm `packages/shared`, `apps/web`, `apps/worker`, và thư mục `apps-script`.
  2. **Deploy Topology cuối:**
     - `apps/web`: Build tĩnh (Vite) triển khai trên Cloudflare Pages / Workers Static Assets (HTTPS mặc định phục vụ `getUserMedia` và Telegram Mini App).
     - `apps/worker`: Triển khai trên Cloudflare Workers kèm Cron Trigger `0-5 1 * * *` (08:00–08:05 Asia/Ho_Chi_Minh, xem ADR-007).
     - `apps-script`: Triển khai thành Google Apps Script Web App (`Execute as: Me`, bảo vệ tầng ứng dụng bằng HMAC-SHA256 + timestamp window + `event_id` idempotency).
  3. **Environment Isolation:**
     - `local`: `.env` (chỉ biến `VITE_*`) và `apps/worker/.dev.vars` (gitignored, tạo từ `.dev.vars.example`).
     - `staging` / `production`: Tách biệt Worker environment, Google Sheet ID, Script deployment và Telegram Bot; toàn bộ khoá bí mật chỉ nạp qua `wrangler secret put` và Apps Script `Script Properties`.

## ADR-007 — Durable mutation replay và kết quả gửi không chắc chắn

- Date: 2026-10-12
- Status: Accepted (M5-05)
- Decision: giữ repository Sheets, thêm Events fingerprint/result snapshot và DailyDispatchLog claim_token. Mutation retry dùng cùng event/body; schema v2 nâng cấp chỉ append header. Digest chuyển claimed → sent/failed/unknown sau response Telegram; tối đa 3 lần cho failed qua tick Cron 08:00–08:05. Unknown và claim treo không tự gửi lại.
- Rationale: isolate memory không bảo vệ retry qua Worker mới; Telegram sendMessage không hỗ trợ idempotency key nên timeout không chứng minh chưa gửi.
- Tradeoff: unknown cần đối chiếu thủ công, không đảm bảo exactly-once tin nhắn. ScriptLock tuần tự hóa writers, không tạo transaction ACID qua nhiều tabs; lỗi giữa ghi business row và Events vẫn cần đối chiếu từ backup/log, tương lai có thể chuyển D1 nếu cần transaction. Queue chưa đồng bộ trên frontend chỉ ở memory và UI nói rõ giới hạn.
