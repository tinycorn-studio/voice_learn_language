# PROGRESS — SINGLE SOURCE OF TRUTH

> Updated: 2026-10-12 10:29 +07:00
> Phase: M0 — Khởi tạo (IN_PROGRESS)
> Đang thực hiện: Chưa có (task gần nhất đã đóng)
> Next action: M1-01: Bootstrap React/Vite TS strict, lint, test, PWA/mobile permission UX
> Blockers: Chưa xác thực credentials thật (Google/Cloudflare/Telegram) cho M0-02; các task local/code/test có thể thực hiện trước.
> Important: Repo đã khởi tạo tại `D:\Profile\VoiceChatLearnLanguage`.

## Legend
`[ ]` Pending/In Progress/Blocked — xem tình trạng ở log bên dưới. `[x]` Done **chỉ sau khi đã đạt Acceptance Criteria và ghi evidence**.

## Milestone M0 — Setup, an toàn, tiêu chuẩn
- [x] M0-01 — Tạo Git repo, cài Node LTS, Git, Wrangler/clasp; check versions.
- [ ] M0-02 — Tạo/kiểm tra Google AI Studio, Apps Script, Google Sheet, Cloudflare, BotFather; cấu hình environment và quota alert.
- [x] M0-03 — Kiểm tra rules, branch protection, workspace, secrets ignore, chọn deploy topology cuối.

## Milestone M1 — Voice proof of concept (local)
- [ ] M1-01 — Bootstrap React/Vite TS strict, lint, test, PWA/mobile permission UX.
- [ ] M1-02 — Realtime microphone → Gemini Live → loa + transcript; ngắt/kết nối lại.
- [ ] M1-03 — Function calling `save_vocabulary` với detector rule; unit tests và manual test 10 câu.

## Milestone M2 — Cloudflare backend/auth
- [ ] M2-01 — Bootstrap Cloudflare Worker TS, API validation, health, structured logging.
- [ ] M2-02 — Xác thực Mini App initData, xác thực Telegram webhook, allowlist.
- [ ] M2-03 — `/api/v1/live-token`: ephemeral token, rate limit + CORS allowlist.
- [ ] M2-04 — Cron trigger UTC, queue/retry/error mapping, CI checks.

## Milestone M3 — Sheets + Apps Script sync
- [ ] M3-01 — Thiết kế/tạo sheet tabs và Script Properties; clasp liên kết dự án an toàn.
- [ ] M3-02 — Worker ký HMAC → Apps Script validate → upsert Words/Events idempotent.
- [ ] M3-03 — API list/search/edit/delete vocab, xử lý trùng nghĩa và công thức Sheet.
- [ ] M3-04 — Integration/E2E: hỏi → lưu; retry; mất mạng; import/export CSV.

## Milestone M4 — Ôn tập SRS & Telegram
- [ ] M4-01 — SRS engine (Again/Hard/Good/Easy), nextDue, timezone, unit tests.
- [ ] M4-02 — Telegram Bot webhook inline quiz + answer callback; update Reviews/Words.
- [ ] M4-03 — Cron nhắc ôn lúc 08:00 UTC+7 với idempotency/opt-out.
- [ ] M4-04 — Telegram Mini App flashcards, stats, onboarding; accessible UX.

## Milestone M5 — Release/Operations
- [ ] M5-01 — Production deploy Worker/web/Apps Script, kiểm tra quyền và secret.
- [ ] M5-02 — E2E trên PC/Android/iOS (trong Telegram), error/latency/usage tests.
- [ ] M5-03 — Backup/restore, rollback, monitoring, alert quota/cost, tài liệu runbook.

## Milestone M6 — Optional / sau MVP
- [ ] M6-01 — Sync Anki local theo nhu cầu; không bắt buộc cho bản chính.
- [ ] M6-02 — Phát âm, lịch sử hỏi lại, AI tự kiểm tra từ trong hội thoại.
- [ ] M6-03 — Chuyển Sheets → D1/Supabase nếu vượt quy mô cá nhân.

## Latest accomplished
- **2026-10-12:** Tạo bộ **plan/documentation starter** và script quản lý tiến độ trong gói. Chưa hoàn thành các task kỹ thuật M0–M6.

## Activity / evidence log
| Time (UTC+7) | Task | State | Evidence / results | Next |
|---|---|---|---|---|
| 2026-10-12 09:50 | DOC-INIT | DOCS PREPARED | Đã tạo tài liệu và script; chưa chạy integration | M0-01 |

| 2026-10-12 10:26 +07:00 | M0-01 | DONE | Git repo init (main), LF configured (.gitattributes), node v26.5.1, npm 11.17.0, git 2.55.0.windows.3, clasp 3.4.1, wrangler 4.149.0, .gitignore verified | M0-03: Chốt ADR, workspace root & secret checks (M0-02 chờ user cấu hình tài khoản ngoài) |

| 2026-10-12 10:29 +07:00 | M0-02 | BLOCKED | Awaiting user external account credentials (Google AI Studio key, Sheet ID, Script ID, Cloudflare login, BotFather token) | M1-01: Bootstrap apps/web React/Vite TS strict & packages/shared |

| 2026-10-12 10:29 +07:00 | M0-03 | DONE | Accepted ADR-001..006 in docs/14_DECISIONS.md, created workspace package.json, tsconfig.base.json, .prettierrc, .dev.vars.example, and passed Check-Secrets.ps1 | M1-01: Bootstrap React/Vite TS strict, lint, test, PWA/mobile permission UX |

## Current blockers / risks
- Free tier Gemini: cần kiểm tra model/quota của project thực trước triển khai; không đảm bảo free không giới hạn.
- Apps Script deploy yêu cầu OAuth ủy quyền và quyền chia sẻ phù hợp; Script Properties chưa có.
- Không có các account IDs/tokens. Tuyệt đối không để chúng trong PROGRESS/CHANGELOG.

## Next session checklist
- [ ] Đọc `AGENTS.md`, `PROGRESS.md`, `docs/13_MILESTONES.md`.
- [ ] `git status --short` và đọc diff chưa commit.
- [ ] Chọn task tiếp theo (M0-01); xác nhận task không bị blocked.
- [ ] Chạy setup/check cần thiết, ghi evidence và command.
- [ ] Khi thực sự hoàn thành, chạy `scripts/Complete-Task.ps1` và commit cả PROGRESS/CHANGELOG.
