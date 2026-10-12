# CHANGELOG

Theo dõi thay đổi theo giai đoạn; không ghi secrets, raw transcript hoặc thông tin định danh cá nhân.

## [Unreleased]

### Added

- 2026-10-12 M0-02 (IN_PROGRESS): Chuẩn bị Worker staging tách tên/secrets khỏi production, tắt Cron lúc khởi tạo; thêm runbook đăng nhập, phê duyệt OAuth/secrets/deploy, Sheet FSRS v3 và CI/CD. Chưa tạo tài nguyên hoặc triển khai online.

- 2026-10-12 M4-FSRS: Nâng cấp toàn diện FSRS Spaced Repetition với thư viện chính thức `ts-fsrs@^5.4.2`; kiến trúc Authoritative Backend Scheduling trên Cloudflare Worker; Schema v3 tách bạch bảng `Cards`, `Reviews` (snapshot + `review_log_json`), và `Settings`; API xem trước `/api/v1/reviews/:cardId/preview`, chấm điểm `/api/v1/reviews/submit`, thống kê `/api/v1/reviews/stats`; dynamic interval badges trên giao diện FlashcardReviewPanel; script di trú `migrateSchemaV3_` (dry-run & apply) và fallback tương thích ngược.
- 2026-10-12: Bộ tài liệu dự án, AGENTS.md, PROGRESS.md, script ghi tiến độ, Apps Script starter và hướng dẫn cấu hình/triển khai. **Chưa triển khai ứng dụng chạy thật.**

### Fixed

- 2026-10-12 M5-06: Flashcards và Telegram chấm từng Card độc lập bằng Card version; retry giữ payload/event, replay sau xóa và conflict khi payload đổi. Sửa Relearning/legacy mapping, Settings validate/apply, badges 1m/10m, thống kê UTC+7 và loại Word deleted/suspended khỏi active totals.
- 2026-10-12 M5-06: Migration v3 dry-run không ghi dữ liệu, nâng header v1/v2, giữ due/counts/suspended và archive source trước cold start memory; GET không tạo Card. Reviews lưu native log/full snapshots/versions, partial commit trả 409 để đối chiếu. Runbook gọi public migrateSchemaV3 và rollback giữ lịch sử; chưa deploy/migrate Sheet thật.
- 2026-10-12 M5-05: Voice Tutor nối micro PCM/Gemini/playback; Stop hủy tài nguyên và reconnect có budget. Mini App đăng nhập Telegram, dùng API lưu/sửa/xóa/ôn thật; bỏ dữ liệu mẫu và badge saved giả, hiển thị pending/error cùng retry event ổn định.
- 2026-10-12 M5-05: Webhook retry sau lỗi không mất review; CRUD replay và chặn key collision; digest chỉ sent sau Telegram ack, bounded retry khi failed và giữ unknown để đối chiếu. Cron bổ sung tick 08:00–08:05; keyboard mới có version chặn thẻ cũ.
- 2026-10-12 M5-05: CSV multiline/quote/CRLF và validation; guard đối chiếu transcript/target. Sheet schema v2 thêm result snapshot/claim token, migration chỉ append headers. Cần backup/migration và staging/live QA trước production; chưa deploy.

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
- 2026-10-12 12:30 +07:00 — M4-FSRS: Nâng cấp FSRS hoàn tất với ts-fsrs@^5.4.2; Schema v3 (Cards/Reviews/Settings); Authoritative backend calculation; dynamic interval badges; 70/70 tests pass (14 files); typecheck, lint, build, secret scan pass 100%. Next: M0-02/M3-01: cấu hình staging, backup Sheet và migrateSchemaV3 theo docs/FSRS_MIGRATION.md.
- 2026-10-12 14:02 +07:00 — M5-06: Review/sua FSRS moi: 85 tests/15 files PASS; typecheck workspace+tests, lint, build, Worker dry-run, secret scan va git diff --cached --check PASS. Card OCC/replay, migration v3 read-only, native audit/Settings/UTC+7, Cards UI/Telegram; docs/23_FSRS_REVIEW_FIXES.md. Chua deploy/migrate Sheet that.. Next: M0-02/M3-01: cau hinh staging; xin xac nhan deploy/migration, clasp pull vao backup rieng/diff, backup Sheet va migrateSchemaV3(true/false) theo docs/FSRS_MIGRATION.md; live QA M4-04/M4-FSRS/M5-02 tren PC/Android/iOS.
