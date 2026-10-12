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
