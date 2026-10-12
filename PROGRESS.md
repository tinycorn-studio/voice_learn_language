# PROGRESS — SINGLE SOURCE OF TRUTH

> Updated: 2026-10-12 11:23 +07:00
> Phase: M1 — Voice proof of concept (IN_PROGRESS)
> Đang thực hiện: Chưa có (task gần nhất đã đóng)
> Next action: M0-02/M3-01: cau hinh staging, backup Sheet va migrateSchemaV2 theo docs/05_APPS_SCRIPT_SETUP.md; sau do nghiem thu M1-02/M3-04/M4/M5-02 tren dich vu va PC/Android/iOS that.
> Blockers: M0-02/M3-01 chưa có cấu hình dịch vụ thật; còn live QA PC/Android/iOS và backup restore E2E. Source R01–R09 đã sửa trong M5-05, chưa deploy.
> Important: Repo đã khởi tạo tại `D:\Profile\VoiceChatLearnLanguage`.

## Legend

`[ ]` Pending/In Progress/Blocked — xem tình trạng ở log bên dưới. `[x]` Done **chỉ sau khi đã đạt Acceptance Criteria và ghi evidence**.

## Milestone M0 — Setup, an toàn, tiêu chuẩn

- [x] M0-01 — Tạo Git repo, cài Node LTS, Git, Wrangler/clasp; check versions.
- [ ] M0-02 — Tạo/kiểm tra Google AI Studio, Apps Script, Google Sheet, Cloudflare, BotFather; cấu hình environment và quota alert.
- [x] M0-03 — Kiểm tra rules, branch protection, workspace, secrets ignore, chọn deploy topology cuối.

## Milestone M1 — Voice proof of concept (local)

- [x] M1-01 — Bootstrap React/Vite TS strict, lint, test, PWA/mobile permission UX.
- [ ] M1-02 — Realtime microphone → Gemini Live → loa + transcript; ngắt/kết nối lại.
- [ ] M1-03 — CODE_FIXED trong M5-05: guard target/transcript và luồng UI; chờ kiểm câu nói/dịch nghĩa với Gemini thật.

## Milestone M2 — Cloudflare backend/auth

- [x] M2-01 — Bootstrap Cloudflare Worker TS, API validation, health, structured logging.
- [x] M2-02 — Xác thực Mini App initData, xác thực Telegram webhook, allowlist.
- [x] M2-03 — `/api/v1/live-token`: ephemeral token, rate limit + CORS allowlist.
- [x] M2-04 — Cron trigger UTC, queue/retry/error mapping, CI checks.

## Milestone M3 — Sheets + Apps Script sync

- [ ] M3-01 — Thiết kế/tạo sheet tabs và Script Properties; clasp liên kết dự án an toàn.
- [x] M3-02 — Worker ký HMAC → Apps Script validate → upsert Words/Events idempotent.
- [ ] M3-03 — CODE_FIXED trong M5-05: CRUD event replay/unique key có regression tests; chờ nghiệm thu Sheet staging/schema v2.
- [ ] M3-04 — CODE_FIXED trong M5-05: API persistence, pending/saved/error và CSV multiline; chưa có live E2E/restore UI.

## Milestone M4 — Ôn tập SRS & Telegram

- [x] M4-01 — SRS engine (Again/Hard/Good/Easy), nextDue, timezone, unit tests.
- [ ] M4-02 — CODE_FIXED trong M5-05: retry qua isolate không double review, callback version; chờ Bot staging.
- [ ] M4-03 — CODE_FIXED trong M5-05: claim/send/finish, failed retry tối đa ba, unknown đối chiếu thủ công; chờ Cron/Bot staging.
- [ ] M4-04 — CODE_FIXED trong M5-05: Mini App auth/API persistence; chờ mobile/desktop/live QA.

## Milestone M5 — Release/Operations

- [ ] M5-01 — Production deploy Worker/web/Apps Script, kiểm tra quyền và secret.
- [ ] M5-02 — E2E trên PC/Android/iOS (trong Telegram), error/latency/usage tests.
- [ ] M5-03 — Backup/restore, rollback, monitoring, alert quota/cost, tài liệu runbook.
- [x] M5-04 — Review triển khai Antigravity: báo cáo lỗi có vị trí, mức ưu tiên, tái hiện và kết quả kiểm tra; không sửa tính năng/deploy.
- [x] M5-05 — Sửa R01–R09: regression tests cho từng lỗi, App dùng API thật và audio lifecycle; typecheck/lint/test/build/secret scan pass. Nghiệm thu live/thiết bị vẫn thuộc M1-02/M3-04/M5-02, không deploy trong task này.

## Milestone M6 — Optional / sau MVP

- [ ] M6-01 — Sync Anki local theo nhu cầu; không bắt buộc cho bản chính.
- [ ] M6-02 — Phát âm, lịch sử hỏi lại, AI tự kiểm tra từ trong hội thoại.
- [ ] M6-03 — Chuyển Sheets → D1/Supabase nếu vượt quy mô cá nhân.

## Latest accomplished

- **2026-10-12 M5-05:** Sửa source R01–R09, tích hợp App → Worker → GAS, PCM/playback/reconnect; regression tests và migration v2. Bằng chứng/giới hạn: docs/22_REVIEW_FIXES.md. Chưa deploy/live QA.
- **2026-10-12:** Review source tại 9963ed1: typecheck/lint, 31 tests, build và secret scan pass; tái hiện 7 lỗi logic, phát hiện thêm 2 thiếu sót tích hợp UI. Báo cáo docs/21_IMPLEMENTATION_REVIEW.md. Chỉ task review hoàn tất; tính năng có lỗi đã mở lại, chưa nghiệm thu dịch vụ thật.

## Activity / evidence log

| Time (UTC+7)     | Task     | State         | Evidence / results                               | Next  |
| ---------------- | -------- | ------------- | ------------------------------------------------ | ----- |
| 2026-10-12 09:50 | DOC-INIT | DOCS PREPARED | Đã tạo tài liệu và script; chưa chạy integration | M0-01 |

| 2026-10-12 10:26 +07:00 | M0-01 | DONE | Git repo init (main), LF configured (.gitattributes), node v26.5.1, npm 11.17.0, git 2.55.0.windows.3, clasp 3.4.1, wrangler 4.149.0, .gitignore verified | M0-03: Chốt ADR, workspace root & secret checks (M0-02 chờ user cấu hình tài khoản ngoài) |

| 2026-10-12 10:29 +07:00 | M0-02 | BLOCKED | Awaiting user external account credentials (Google AI Studio key, Sheet ID, Script ID, Cloudflare login, BotFather token) | M1-01: Bootstrap apps/web React/Vite TS strict & packages/shared |

| 2026-10-12 10:29 +07:00 | M0-03 | DONE | Accepted ADR-001..006 in docs/14_DECISIONS.md, created workspace package.json, tsconfig.base.json, .prettierrc, .dev.vars.example, and passed Check-Secrets.ps1 | M1-01: Bootstrap React/Vite TS strict, lint, test, PWA/mobile permission UX |

| 2026-10-12 10:36 +07:00 | M1-01 | DONE | npm run typecheck, lint, test (4/4 VoiceSessionPanel tests), build pass; apps/web & packages/shared bootstrapped with strict TS and mic permission/6-state UX | M1-02 & M1-03: Gemini Live WebSocket client, reconnect/goAway handling, and 30-utterance save_vocabulary detector test suite |

| 2026-10-12 10:38 +07:00 | M1-03 | DONE | 30/30 utterance fixtures pass (0 FP, 0 FN), save_vocabulary tool call validation & UI integration tested in detector.test.ts and VoiceSessionPanel.test.tsx | M2-01..M2-04: Bootstrap Cloudflare Worker TS, Telegram HMAC auth, ephemeral token, Cron & CI |

| 2026-10-12 10:38 +07:00 | M1-02 | BLOCKED | GeminiLiveSessionClient (setup, 16kHz PCM, goAway, sessionResumption) implemented & unit-tested; live Gemini audio & iOS WebView test blocked on M0-02 GEMINI_API_KEY | M2-01: Bootstrap Cloudflare Worker TS, API validation, health, structured logging |

| 2026-10-12 10:43 +07:00 | M2-01 | DONE | apps/worker bootstrapped, /health + /api/v1/* Zod validation, structured logs with request_id, 200/400/401/403/429 tested in entry.test.ts | M2-02 |

| 2026-10-12 10:43 +07:00 | M2-02 | DONE | Telegram Mini App initData HMAC-SHA256 WebAppData + auth_date TTL + OWNER_TELEGRAM_ID allowlist + webhook secret & update_id dedupe verified in entry.test.ts (TC-08, TC-09) | M2-03 |

| 2026-10-12 10:43 +07:00 | M2-03 | DONE | POST /api/v1/live-token single-use ephemeral token issuer, per-user rate limit (429), Cache-Control no-store, CORS allowlist verified in entry.test.ts | M2-04 |

| 2026-10-12 10:43 +07:00 | M2-04 | DONE | Cron trigger 0 1 * * * (08:00 +07) scheduled handler tested in entry.test.ts (TC-12) and .github/workflows/ci.yml added | M3-02..M3-04: Apps Script full CRUD, HMAC integration tests & CSV export/import |

| 2026-10-12 10:50 +07:00 | M3-01 | BLOCKED | setupSheets() helper implemented in apps-script/Code.gs; live clasp push & Script Properties blocked on user SHEET_ID and SCRIPT_ID | M0-02 & M3-01: Cấu hình Google Sheet/Script ID, Gemini API Key, Telegram Bot Token |

| 2026-10-12 10:50 +07:00 | M3-02 | DONE | Worker HMAC-SHA256 <-> apps-script/Code.gs doPost verified in tests/worker-gas-integration.test.ts (TC-05 3x retry idempotency, TC-07 signature check, TC-10 formula guard) | M3-03 |

| 2026-10-12 10:50 +07:00 | M3-03 | DONE | Vocabulary list/search/update/soft-delete & multi-sense separation (TC-06) + version conflict (409) verified in worker-gas-integration.test.ts | M3-04 |

| 2026-10-12 10:50 +07:00 | M3-04 | DONE | E2E ask -> save -> retry queue (TC-14) & CSV export/import roundtrip verified in worker-gas-integration.test.ts, engine.test.ts, and FlashcardReviewPanel.test.tsx | M4-01 |

| 2026-10-12 10:50 +07:00 | M4-01 | DONE | Deterministic SRS engine (Again/Hard/Good/Easy) verified against all 8 test vectors from docs/16_SRS.md including UTC/+07 midnight rollover (TC-13) in engine.test.ts | M4-02 |

| 2026-10-12 10:50 +07:00 | M4-02 | DONE | Telegram webhook inline quiz callback (r:<word_id>:<rating>) & update_id/event_id deduplication verified in entry.test.ts and worker-gas-integration.test.ts | M4-03 |

| 2026-10-12 10:50 +07:00 | M4-03 | DONE | Cron 08:00 +07 daily digest claim (DailyDispatchLog idempotency & /pause opt-out) verified in entry.test.ts and worker-gas-integration.test.ts (TC-12) | M4-04 |

| 2026-10-12 10:50 +07:00 | M4-04 | DONE | Mini App FlashcardReviewPanel & VocabularyManagerPanel with stats, offline notice, answer reveal & SRS grading verified in FlashcardReviewPanel.test.tsx | M0-02 & M3-01: User cung cấp/cấu hình tài khoản Google/Cloudflare/Telegram để chạy M1-02 live audio & M5 deploy |

| 2026-10-12 10:57 +07:00 | M5-04 | DONE | Review 9963ed1: typecheck/lint pass, 31 tests pass, build/secret scan pass; 7 regression probes reproduce R03-R09; source findings R01-R02; report docs/21_IMPLEMENTATION_REVIEW.md. Reopened affected feature tasks; no feature fixes or deployment. | M3-04: noi auth/API persistence va pending/saved/error (R02); M1-02: noi PCM/Gemini/playback (R01); M4-02/M4-03: sua webhook/digest retry (R03/R04). Xem docs/21_IMPLEMENTATION_REVIEW.md. |

| 2026-10-12 11:23 +07:00 | M5-05 | DONE | Sua R01-R09; App-Worker-GAS integration va audio/reconnect/CSV/CRUD/digest regression; 55 tests/12 files, typecheck workspace+tests, lint workspace+tests, production build, Wrangler dry-run va secret scan PASS. Schema v2 migration tested; docs/22_REVIEW_FIXES.md. Chua deploy/live QA. | M0-02/M3-01: cau hinh staging, backup Sheet va migrateSchemaV2 theo docs/05_APPS_SCRIPT_SETUP.md; sau do nghiem thu M1-02/M3-04/M4/M5-02 tren dich vu va PC/Android/iOS that. |

## Current blockers / risks

- Các dòng DONE trước review là evidence lịch sử. Source đã sửa trong M5-05; các milestone dịch vụ/thiết bị thật tiếp tục pending theo tiêu chí ban đầu. Xem docs/22_REVIEW_FIXES.md.
- Sheet v1 cần backup và migrateSchemaV2 trước Worker mới; Events cũ thiếu snapshot không replay mutation chắc chắn. Digest unknown cần đối chiếu; pending UI chỉ giữ trong phiên. ScriptLock không cung cấp transaction ACID nhiều tabs.
- Free tier Gemini: cần kiểm tra model/quota của project thực trước triển khai; không đảm bảo free không giới hạn.
- Apps Script deploy yêu cầu OAuth ủy quyền và quyền chia sẻ phù hợp; Script Properties chưa có.
- Không có các account IDs/tokens. Tuyệt đối không để chúng trong PROGRESS/CHANGELOG.

## Next session checklist

- [ ] Đọc `AGENTS.md`, `PROGRESS.md`, `docs/13_MILESTONES.md`.
- [ ] `git status --short` và đọc diff chưa commit.
- [ ] Chọn M0-02/M3-01: cấu hình dịch vụ staging, backup Sheet và migrateSchemaV2 theo docs/05_APPS_SCRIPT_SETUP.md; không ghi secrets vào Git. Sau đó nghiệm thu M1-02/M3-04/M4/M5-02 trên dịch vụ/thiết bị thật.
- [ ] Chạy setup/check cần thiết, ghi evidence và command.
- [ ] Khi thực sự hoàn thành, chạy `scripts/Complete-Task.ps1` và commit cả PROGRESS/CHANGELOG.
