# CHANGELOG

Theo dõi thay đổi theo giai đoạn; không ghi secrets, raw transcript hoặc thông tin định danh cá nhân.

## [Unreleased]
### Added
- 2026-10-12: Bộ tài liệu dự án, AGENTS.md, PROGRESS.md, script ghi tiến độ, Apps Script starter và hướng dẫn cấu hình/triển khai. **Chưa triển khai ứng dụng chạy thật.**

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
