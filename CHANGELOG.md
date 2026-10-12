# CHANGELOG

Theo dõi thay đổi theo giai đoạn; không ghi secrets, raw transcript hoặc thông tin định danh cá nhân.

## [Unreleased]

### Added

- 2026-10-12 M5-07: Mini App tự ghi tối đa 30 API attempts trong memory, hiện mã lỗi/request ID, thêm kiểm tra kết nối không cần đăng nhập và sao chép log (có fallback chọn văn bản trên iOS). Không ghi token, initData, body, query, nội dung học hay raw exception; không gửi telemetry ra ngoài.

- 2026-10-12: Bộ tài liệu dự án, AGENTS.md, PROGRESS.md, script ghi tiến độ, Apps Script starter và hướng dẫn cấu hình/triển khai. **Chưa triển khai ứng dụng chạy thật.**

### Fixed

- 2026-10-12 M5-09 (LOCAL, chưa deploy): Worker GAS adapter và Telegram client giữ global receiver khi gọi native fetch. Runtime Workers thật tái hiện vocabulary 503 trước sửa/200 sau sửa với GAS mock không đổi cấu hình. Thêm regression và `gas_fetch_failed` chỉ ghi request ID/action/phase/reason/exception name whitelist/duration, không ghi endpoint, HMAC/body hoặc raw exception. Cần quyền Worker và đối chiếu source production trước hotfix.

- 2026-10-12 M5-08: Sửa cách gọi native Window.fetch bằng global receiver, tránh TypeError “Illegal invocation” trước khi gửi request. Browser comparison tái hiện lỗi tức thì và thành công khi sửa receiver; thêm regression cho cả default và injected fetch (fail trước sửa/pass sau sửa). Log Telegram Desktop M5-07 có pattern phù hợp; vẫn cần xác nhận đăng nhập trên thiết bị thật.

- 2026-10-12 M5-06: Mini App dùng timeout tương thích WebView, phân biệt lỗi chậm/mạng/cấu hình và cho phép thử đăng nhập lại. Sửa lockfile thiếu workspace Worker; thêm regression và runbook API/CORS tại docs/23_TELEGRAM_CONNECTION.md. Frontend đã deploy trong M5-01 sau xác nhận người dùng.

- 2026-10-12 M5-05: Voice Tutor nối micro PCM/Gemini/playback; Stop hủy tài nguyên và reconnect có budget. Mini App đăng nhập Telegram, dùng API lưu/sửa/xóa/ôn thật; bỏ dữ liệu mẫu và badge saved giả, hiển thị pending/error cùng retry event ổn định.
- 2026-10-12 M5-05: Webhook retry sau lỗi không mất review; CRUD replay và chặn key collision; digest chỉ sent sau Telegram ack, bounded retry khi failed và giữ unknown để đối chiếu. Cron bổ sung tick 08:00–08:05; keyboard mới có version chặn thẻ cũ.
- 2026-10-12 M5-05: CSV multiline/quote/CRLF và validation; guard đối chiếu transcript/target. Sheet schema v2 thêm result snapshot/claim token, migration chỉ append headers. Cần backup/migration và staging/live QA trước production; chưa deploy.

### Deployed

- 2026-10-12 22:48 +07:00 M5-08: Pages Production `1a4f0e48-f02e-4bbe-9ec6-e8e03852a739`, bundle M5-08 public khớp SHA256 local. Browser native trên production đã chuyển health probe từ TypeError tức thì sang HTTP 200/OK trong 283 ms. 84 tests và toàn bộ local gates pass; đăng nhập Telegram thật còn cần user xác nhận.

- 2026-10-12 22:38 +07:00 M5-07: Frontend chẩn đoán đã deploy Production `2883e8b3-e60e-4498-8a29-d0f033bf1051`; URL menu tải bundle log mới, SHA256 khớp local. 82 tests/14 files và toàn bộ local gates pass. Chưa xác định nguyên nhân mạng trên iPhone; cần báo cáo log từ thiết bị. Worker không thay đổi; giữ chưa commit theo yêu cầu.

- 2026-10-12 22:23 +07:00 M5-01 (frontend): Pages `voice-chat-learn-language`, branch `production`, deployment `e3229c61-7573-49a1-a05a-c957e6bfa16f`. Bundle public SHA256 khớp artifact đã kiểm thử; menu URL hiện tại nhận bản sửa M5-06, Worker health/CORS pass. Rollback `21f513cc-5946-4e45-96f0-75cdbbe0dce1`. Chưa nghiệm thu trên thiết bị Telegram; toàn M5-01/M5-02 còn pending. Người dùng yêu cầu chưa commit; code/docs/tests được giữ staged cùng nhau.

## Automated task completions

<!-- scripts/Complete-Task.ps1 tự chèn dưới đây -->

- 2026-10-12 10:26 +07:00 — M0-01: Git repo init (main), LF configured (.gitattributes), node v26.5.1, npm 11.17.0, git 2.55.0.windows.3, clasp 3.4.1, wrangler 4.149.0, .gitignore verified. Next: M0-03: Chốt ADR, workspace root & secret checks (M0-02 chờ user cấu hình tài khoản ngoài)
- 2026-10-12 10:29 +07:00 — M0-03: Accepted ADR-001..006 in docs/14_DECISIONS.md, created workspace package.json, tsconfig.base.json, .prettierrc, .dev.vars.example, and passed Check-Secrets.ps1. Next: M1-01: Bootstrap React/Vite TS strict, lint, test, PWA/mobile permission UX
- 2026-10-12 10:36 +07:00 — M1-01: npm run typecheck, lint, test (4/4 VoiceSessionPanel tests), build pass; apps/web & packages/shared bootstrapped with strict TS and mic permission/6-state UX. Next: M1-02 & M1-03: Gemini Live WebSocket client, reconnect/goAway handling, and 30-utterance save_vocabulary detector test suite
- 2026-10-12 10:38 +07:00 — M1-03: 30/30 utterance fixtures pass (0 FP, 0 FN), save_vocabulary tool call validation & UI integration tested in detector.test.ts and VoiceSessionPanel.test.tsx. Next: M2-01..M2-04: Bootstrap Cloudflare Worker TS, Telegram HMAC auth, ephemeral token, Cron & CI
- 2026-10-12 10:43 +07:00 — M2-01: apps/worker bootstrapped, /health + /api/v1/* Zod validation, structured logs with request_id, 200/400/401/403/429 tested in entry.test.ts. Next: M2-02
- 2026-10-12 10:43 +07:00 — M2-02: Telegram Mini App initData HMAC-SHA256 WebAppData + auth_date TTL + OWNER_TELEGRAM_ID allowlist + webhook secret & update_id dedupe verified in entry.test.ts (TC-08, TC-09). Next: M2-03
- 2026-10-12 10:43 +07:00 — M2-03: POST /api/v1/live-token single-use ephemeral token issuer, per-user rate limit (429), Cache-Control no-store, CORS allowlist verified in entry.test.ts. Next: M2-04
- 2026-10-12 10:43 +07:00 — M2-04: Cron trigger 0 1 * * * (08:00 +07) scheduled handler tested in entry.test.ts (TC-12) and .github/workflows/ci.yml added. Next: M3-02..M3-04: Apps Script full CRUD, HMAC integration tests & CSV export/import
- 2026-10-12 10:50 +07:00 — M3-02: Worker HMAC-SHA256 <-> apps-script/Code.gs doPost verified in tests/worker-gas-integration.test.ts (TC-05 3x retry idempotency, TC-07 signature check, TC-10 formula guard). Next: M3-03
- 2026-10-12 10:50 +07:00 — M3-03: Vocabulary list/search/update/soft-delete & multi-sense separation (TC-06) + version conflict (409) verified in worker-gas-integration.test.ts. Next: M3-04
- 2026-10-12 10:50 +07:00 — M3-04: E2E ask -> save -> retry queue (TC-14) & CSV export/import roundtrip verified in worker-gas-integration.test.ts, engine.test.ts, and FlashcardReviewPanel.test.tsx. Next: M4-01
- 2026-10-12 10:50 +07:00 — M4-01: Deterministic SRS engine (Again/Hard/Good/Easy) verified against all 8 test vectors from docs/16_SRS.md including UTC/+07 midnight rollover (TC-13) in engine.test.ts. Next: M4-02
- 2026-10-12 10:50 +07:00 — M4-02: Telegram webhook inline quiz callback (r:<word_id>:<rating>) & update_id/event_id deduplication verified in entry.test.ts and worker-gas-integration.test.ts. Next: M4-03
- 2026-10-12 10:50 +07:00 — M4-03: Cron 08:00 +07 daily digest claim (DailyDispatchLog idempotency & /pause opt-out) verified in entry.test.ts and worker-gas-integration.test.ts (TC-12). Next: M4-04
- 2026-10-12 10:50 +07:00 — M4-04: Mini App FlashcardReviewPanel & VocabularyManagerPanel with stats, offline notice, answer reveal & SRS grading verified in FlashcardReviewPanel.test.tsx. Next: M0-02 & M3-01: User cung cấp/cấu hình tài khoản Google/Cloudflare/Telegram để chạy M1-02 live audio & M5 deploy
- 2026-10-12 10:57 +07:00 — M5-04: Review 9963ed1: typecheck/lint pass, 31 tests pass, build/secret scan pass; 7 regression probes reproduce R03-R09; source findings R01-R02; report docs/21_IMPLEMENTATION_REVIEW.md. Reopened affected feature tasks; no feature fixes or deployment.. Next: M3-04: noi auth/API persistence va pending/saved/error (R02); M1-02: noi PCM/Gemini/playback (R01); M4-02/M4-03: sua webhook/digest retry (R03/R04). Xem docs/21_IMPLEMENTATION_REVIEW.md.
- 2026-10-12 11:23 +07:00 — M5-05: Sua R01-R09; App-Worker-GAS integration va audio/reconnect/CSV/CRUD/digest regression; 55 tests/12 files, typecheck workspace+tests, lint workspace+tests, production build, Wrangler dry-run va secret scan PASS. Schema v2 migration tested; docs/22_REVIEW_FIXES.md. Chua deploy/live QA.. Next: M0-02/M3-01: cau hinh staging, backup Sheet va migrateSchemaV2 theo docs/05_APPS_SCRIPT_SETUP.md; sau do nghiem thu M1-02/M3-04/M4/M5-02 tren dich vu va PC/Android/iOS that.
- 2026-10-12 22:17 +07:00 — M5-06: Kiem tra live Pages/health 200, CORS 204 va auth invalid 400; tai hien WebView thieu AbortSignal.timeout; sua timeout/retry/URL, lockfile Worker; 68 tests/13 files, typecheck/lint/build PASS. Artifact apps/web/dist va .artifacts/M5-06-frontend.zip; docs/23_TELEGRAM_CONNECTION.md. Chua deploy/kiem chung thiet bi.. Next: M5-01: xin xac nhan deploy frontend M5-06 len Pages voice-chat-learn-language; sau deploy kiem bundle moi va nguoi dung mo lai Mini App. M5-02 live QA va M0-02/M3-01 secrets/quota/schema van pending.
- 2026-10-12 22:39 +07:00 — M5-07: API diagnostics whitelist/30 attempts, x-request-id, health probe va clipboard fallback; 82 tests/14 files, typecheck/lint/build/secret scan PASS. Pages Production 2883e8b3-e60e-4498-8a29-d0f033bf1051; menu bundle index-CiqVpn3F.js SHA256 khop local. docs/23_TELEGRAM_CONNECTION.md. Chua xac dinh nguyen nhan fetch tren iPhone; khong deploy Worker; giu chua commit.. Next: Nguoi dung mo lai Mini App tu menu bot; neu loi bam Log chan doan -> Kiem tra ket noi -> Sao chep log truoc khi dong. Doi chieu request ID/phase/status de dieu tra M5-02. M0-02/M3-01 live secrets/quota/schema pending; giu staged changes, khong can Git email/commit luc nay.
- 2026-10-12 22:50 +07:00 — M5-08: Native Window.fetch sai receiver tai hien Illegal invocation 0 ms; 2 regression fail truoc/pass sau. Sua call(globalThis); 84 tests/14 files, typecheck/lint/build/secret scan PASS. Pages Production 1a4f0e48-f02e-4bbe-9ec6-e8e03852a739, public hash khop local; browser production health truoc TypeError 1 ms/sau OK HTTP 200 283 ms. docs/23_TELEGRAM_CONNECTION.md; chua real Telegram auth/Gemini/Sheets; giu chua commit.. Next: Nguoi dung mo lai/tai lai Mini App, xac nhan build M5-08-20261012 va thu dang nhap. Neu loi, gui log moi co health probe de xu ly code/status/phase tiep theo trong M5-02. M0-02/M3-01 secrets/quota/schema pending; giu staged changes, khong can Git email/commit luc nay.
