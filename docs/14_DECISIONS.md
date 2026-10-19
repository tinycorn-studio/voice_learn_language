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

## ADR-008 — Nâng cấp Spaced Repetition lên FSRS qua thư viện chính thức `ts-fsrs`

- Date: 2026-10-12
- Status: Accepted (M4-FSRS)
- Decision:
  1. Sử dụng thư viện TypeScript chính thức `ts-fsrs` (`open-spaced-repetition/ts-fsrs`, phiên bản `^5.4.2`) làm engine Spaced Repetition duy nhất cho toàn bộ hệ thống.
  2. Nghiêm cấm tự sao chép hoặc viết lại công thức FSRS thủ công trong mã nguồn dự án.
  3. Cấu hình mặc định tập trung: `desired_retention = 0.90`, `maximum_interval = 36500`, nội bộ toàn bộ ngày giờ là `UTC ISO8601`, múi giờ hiển thị và thông báo là `Asia/Ho_Chi_Minh`.
  4. Tách bạch thực thể từ vựng (`Words`) và trạng thái thẻ ôn FSRS (`Cards`), bổ sung bảng `Settings` cấu hình tham số người dùng, và nâng cấp bảng `Reviews` thành append-only lịch sử bất biến với snapshot FSRS (`stability`, `difficulty`, `review_log_json`).
  5. Tính toán lịch ôn có thẩm quyền (authoritative scheduling) đặt tại backend tin cậy (`@voice-chat/shared` / Cloudflare Worker / Apps Script). Frontend chỉ gọi preview và submit đánh giá.
  6. Ngữ nghĩa 4 mức đánh giá tuân thủ FSRS: `Again` (quên), `Hard` (nhớ khó khăn — tuyệt đối không coi là fail), `Good` (nhớ bình thường), `Easy` (nhớ dễ dàng).
- Rationale: FSRS (Free Spaced Repetition Scheduler) là mô hình hiện đại dựa trên DSR (Difficulty - Stability - Retrievability), được Anki tích hợp chính thức từ v23.10, cho độ chính xác và khả năng kiểm soát retention vượt trội so với các scheduler heuristics cũ kiểu SM-2.
- Tradeoff: Cần schema v3 (`Cards`, `Settings`) và script migration từ Words cũ sang Cards; chưa kích hoạt WASM/native optimizer cho trọng số `w` do Cloudflare Workers hạn chế và chưa có đủ dataset ban đầu.

### Bổ sung M5-06 — 2026-10-12

- Worker là nơi thực thi `repeat`/`next`; GAS chỉ validate/lưu dưới lock. Package 5.4.2 hiện báo FSRS-6.0 qua `FSRSVersion`; metadata lấy export thực tế, không hardcode tên thuật toán từ số package.
- Card.row_version là OCC duy nhất; Word edit/version không thay lịch thẻ. Replay dùng canonical client IDs/rating/versions trước khi đọc Card/config, không bỏ expected_version khỏi fingerprint.
- Migration giữ due/counts/suspended và archive Word gốc; memory cũ cold start ở state New để thư viện khởi tạo khi có rating thật. Không suy stability/difficulty từ SM-2 interval. GET không materialize Card, dry-run không ghi tabs/header/properties.
- Reviews giữ native log và full snapshot/version trước/sau, không sửa ngữ nghĩa log thành next state/due. Settings được validate/apply; defaults tập trung trong TypeScript.
- ScriptLock không cung cấp ACID xuyên tabs. Review thiếu Events snapshot trả conflict để đối chiếu; không suy replay từ Word hiện tại. Rollback không xóa Cards/Reviews có dữ liệu mới. Hạn chế crash còn lại được nghiệm thu riêng hoặc giải quyết bằng repository transaction tương lai.

## ADR-009 — Capture từ có budget trên Live session hiện hữu

- Date: 2026-10-13
- Status: Accepted (M5-12)
- Decision: frontend điều phối transcript/tool theo snapshot câu hỏi, một event ID/operation cho mỗi inquiry, persistence tách khỏi audio message queue. Nếu model bỏ tool, recovery một lần sau turnComplete qua clientContent trên cùng Live session; không thêm backend text-model service hoặc gọi AI mỗi audio chunk. Validation deterministic vẫn chặn câu thường/target bịa; source lưu là transcript thật.
- Rationale: M5-11 tái hiện tool/ASR không theo thứ tự, khác dấu câu và việc model trả lời nhưng bỏ tool. [Google Live reference](https://ai.google.dev/api/live) không bảo đảm thứ tự input transcription; [client content](https://ai.google.dev/gemini-api/docs/live-api/capabilities#incremental-content-updates) được hỗ trợ trong phiên.
- Tradeoff: AI vẫn phải sinh nghĩa/tool hợp lệ; recovery có cap 10/Start và timeout, không hứa lưu khi chưa có ACK. Model có thể phát thêm lời, cần live QA. State capture/queue chỉ giữ trong phiên; quyền lưu và FSRS vẫn nằm tại Worker/GAS.

## ADR-010 — D1 primary, Sheet mirror một chiều và outbox bền vững

- Date: 2026-10-13 (Cập nhật hoàn tất: 2026-10-14)
- Status: Accepted (D1 là authority production; M7-11 phục hồi rollout, M7-10 nghiệm thu thiết bị/vận hành còn pending)
- Decision: Worker repository dùng Cloudflare D1 làm nguồn dữ liệu chính thức có thẩm quyền (Authoritative Single Source of Truth) cho toàn bộ Words, Cards, Reviews, Events, Settings, Users, và Daily Dispatches. Giữ nguyên API contract và domain schema; ts-fsrs chạy có thẩm quyền tại Worker; Card OCC bảo vệ tính toàn vẹn trạng thái thẻ; mutations commit nguyên tử (atomic batch transaction) cùng outbox event. Google Sheet chuyển thành một chiều (read-only/export backup) nhận dữ liệu qua batch mirror có ký HMAC từ Cron/outbox, tách biệt hoàn toàn khỏi đường tương tác trực tiếp của Mini App và Telegram Bot.
- Rationale: Google Apps Script Web App có độ trễ cao (p50 ~2.000–4.000 ms, cold start >5.000 ms) và thiếu hỗ trợ giao dịch ACID đa bảng, gây nghẽn trải nghiệm người dùng khi hội thoại và chấm thẻ. Chuyển sang Cloudflare D1 (khu vực APAC) giúp giảm độ trễ ghi xuống ~500–600 ms, độ trễ đọc xuống ~150–200 ms, hỗ trợ transaction rollback nguyên tử và loại bỏ sự phụ thuộc thời gian thực vào Google Sheets.
- Execution: Triển khai 3 SQL migrations (`0001_d1_primary.sql`, `0002_telegram_message_lease.sql`, `0003_sync_processor_lease.sql`). D1 batch kết hợp SQL guard `mutation_guards` cho rollback nguyên tử; `sync_outbox` và `telegram_deliveries` được ghi nhận trong cùng transaction với dữ liệu nghiệp vụ; Cron định kỳ xử lý mirror sang Sheet.
- Tradeoff: Google Sheet có độ trễ cập nhật (vài chục giây đến vài phút tùy chu kỳ Cron), việc chỉnh sửa thủ công trên Sheet không đồng bộ ngược về D1; cần duy trì outbox lease/retry/dead-letter. Tuy nhiên, sự cố kết nối hoặc downtime của Google không còn làm gián đoạn việc học và lưu từ của người dùng.

### Bổ sung M7-03 — 13/10/2026

- Người dùng đã yêu cầu triển khai plan; ADR-010 được chấp nhận cho implementation, chưa coi production cutover đã thực hiện.
- D1 lưu domain record JSON v3 đầy đủ để preserve dữ liệu/audit; cột owner/IDs/version/due phục vụ indexes, CHECK giữ JSON và cột đồng nhất. Worker validate bằng schema runtime. SQL guards trong batch abort khi maintenance/OCC sai; Reviews append-only có trigger.
- Factory chung cho HTTP/Bot/Cron; auth/token/health không phụ thuộc database readiness. DATA_BACKEND vẫn gas đến khi staging/migration pass, D1 lỗi không tự ghi kho cũ. Runtime harness dùng workerd D1 local, staging thật là gate riêng.

### Bổ sung M7-04 — legacy Events

- D1 Events dùng HMAC builder tương thích GAS field order, metadata fingerprint_scheme phân biệt imported/verified/legacy-unverified. Cùng key hiện hữu của Worker, không đưa key vào export. Imported Event được replay trước đọc Word/Card; đổi payload hoặc thiếu snapshot trả conflict.
- Transaction ghi Word/Card/Review/Event/outbox cùng batch; SQL guards kiểm active owner và Card version. Word version chỉ bảo vệ compatibility mirror khỏi overwrite; khi hai Card độc lập cùng sửa mirror, retry bounded với Card version riêng còn đúng.

### Bổ sung M7-06 — mirror row metadata

- Không dựa vào appendRow hoặc event ACK memory: GAS viết canonical snapshot/version/epoch cùng row dưới ScriptLock. Preflight toàn batch, writes theo table ranges; partial cross-tab failure replay được. Reviews/Events immutable, version cũ bỏ qua và same-version mismatch conflict.
- Một mirror event/tick (nhiều entity rows), global lease 60 giây, Google HTTP timeout 15 giây, bounded attempts/dead-letter và explicit rebuild. Throughput/CPU/lag được đo staging trước khi tăng batch budget; không gắn synchronous mirror vào API persistence.

### Bổ sung M7-07 — migration manifest bất biến

- Full raw snapshot bảy tabs có tab/global checksums, freeze/drain dưới ScriptLock, giữ cột ngoài schema và quarantine thay vì tự sửa/lược lịch sử. Import INSERT-only, atomic bounded chunks/checkpoints + verify canonical ID/hash toàn bảng; không dùng business mutations để nhập lịch sử, không tự mở writers.
- Reverse migration dùng target GAS riêng/frozen và JSON metadata để bảo toàn null/optional values; verify trước reopen, xóa transient metadata khi GAS authority mở ghi lại. Full SQL backup vẫn cần cho operational tables. CLI private artifacts/process env, không đưa dữ liệu/credentials lên Git hoặc terminal.
- Remote REST batch transaction/real service parity phải được kiểm chứng ở staging M7-08; local task không thay quyền hoặc tạo DB/deploy.

## ADR-011 — Multi-user allowlist qua env và daily caps nguyên tử trong D1

- Date: 2026-10-19
- Status: Accepted (M9-02/M9-03; chờ deploy secret cấu hình)
- Decision: Mở nhiều user bằng allowlist tĩnh `ALLOWED_TELEGRAM_IDS` (secret Worker), owner luôn được gộp vào danh sách; auth/initData/session/webhook check membership, dữ liệu vẫn cô lập theo `telegram:<id>`. Cron digest lặp per-user trong cửa sổ xoay vòng ≤5 user/tick (cửa sổ 08:00–08:05 +07). Mirror Google Sheet tiếp tục chỉ dành cho owner (GAS policy owner-only) — adapter D1 gate outbox theo `mirrorOwnerUserId`. Hạn mức ngày mỗi user cho từng tính năng tốn AI (live/dịch/chat-turn) enforce bằng UPSERT điều kiện nguyên tử trong bảng `usage_daily` (D1), cấu hình centralized trong `domain/quota.ts`, vượt cap trả 429 tiếng Việt.
- Rationale: chưa có ngân sách cho hệ auth/DB người dùng thật; allowlist env rollback được trong vài giây, không thêm bảng/luồng dữ liệu. Counter nguyên tử 1 câu SQL không cần lock ngoài, đúng semantics Free-tier guardrail. Mirror owner-only tránh job chết và không đổi quyền GAS.
- Tradeoff: thêm user phải sửa secret + redeploy Worker (không self-serve); digest window giới hạn allowlist nhỏ (~≤30 user/ngày) trước khi cần redesign deliveries; caps D1 thêm 1 statement/request AI; GAS-mode bỏ qua caps (chấp nhận vì production là D1).
