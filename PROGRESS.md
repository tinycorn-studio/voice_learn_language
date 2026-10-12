# PROGRESS — SINGLE SOURCE OF TRUTH

> Updated: 2026-10-12 23:06 +07:00
> Phase: M1 — Voice proof of concept (IN_PROGRESS)
> Đang thực hiện: M5-09 (P1, IN_PROGRESS) — log thật M5-08 xác nhận Telegram auth HTTP 200, vocabulary HTTP 503 UNAVAILABLE; chẩn đoán Worker → GAS.
> Next action: Người dùng đã cho phép OAuth Workers/triển khai M5-09. Mở device OAuth, đọc source/version/binding names production, giữ rollback và diff trước deploy giới hạn receiver/log; không đè toàn bộ bundle M5-05 chưa nghiệm thu. Tiếp tục real vocabulary QA; giữ chưa commit.
> Blockers: OAuth hiện có thiếu Workers, cần hoàn tất cấp quyền qua Cloudflare; chưa biết GAS_EXEC_URL/secret/deployment/schema thật. Đăng nhập Telegram Desktop đã OK; tải từ vựng còn 503. Người dùng đã xác nhận triển khai Worker trong phiên tiếp theo.
> Important: Workspace hiện tại là `D:\Profile\VoiceLearnLanguage`; đường dẫn VoiceChatLearnLanguage trong log cũ là lịch sử.

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

- [ ] M5-01 — FRONTEND_DEPLOYED: Pages production 1a4f0e48 (M5-08, 2026-10-12 22:48 +07), bundle hash và browser native health 200 verified; Worker/GAS/secrets/schema và nghiệm thu toàn bộ production còn pending.
- [ ] M5-02 — E2E trên PC/Android/iOS (trong Telegram), error/latency/usage tests.
- [ ] M5-03 — Backup/restore, rollback, monitoring, alert quota/cost, tài liệu runbook.
- [x] M5-04 — Review triển khai Antigravity: báo cáo lỗi có vị trí, mức ưu tiên, tái hiện và kết quả kiểm tra; không sửa tính năng/deploy.
- [x] M5-05 — Sửa R01–R09: regression tests cho từng lỗi, App dùng API thật và audio lifecycle; typecheck/lint/test/build/secret scan pass. Nghiệm thu live/thiết bị vẫn thuộc M1-02/M3-04/M5-02, không deploy trong task này.
- [x] M5-06 — P1: chẩn đoán kết nối Telegram Mini App; kiểm tra URL, timeout tương thích WebView và thử đăng nhập lại. Acceptance local: regression tests, typecheck/lint/test/build và runbook API/CORS. Deploy/thiết bị thật thuộc M5-01/M5-02.
- [x] M5-07 — Log từng API attempt và health probe, mã đối chiếu Worker, UI sao chép log/fallback iOS; phân biệt timeout/network/HTTP/JSON/schema/local auth, whitelist metadata và bounded 30 attempts. 82 tests/14 files và gates PASS; frontend Production 2883e8b3-e60e-4498-8a29-d0f033bf1051, bundle public khớp local. docs/23_TELEGRAM_CONNECTION.md. Lỗi iPhone còn cần log thực tế; chưa kết luận nguyên nhân.
- [x] M5-08 — Sửa native fetch receiver (Illegal invocation): 2 regression fail trước sửa/pass sau sửa, browser native comparison và production health trước TypeError 1 ms/sau HTTP 200 283 ms. 84 tests/14 files, gates PASS; Pages 1a4f0e48-f02e-4bbe-9ec6-e8e03852a739, hash public khớp local. docs/23_TELEGRAM_CONNECTION.md; chưa nghiệm thu real Telegram auth/Sheets/Gemini.
- [ ] M5-09 — P1, IN_PROGRESS (LOCAL_FIX_READY, chờ quyền Worker/hotfix): workerd native + GAS mock không đổi config, adapter/route thật 503 trước sửa/200 sau sửa; sửa 3 fetch receivers ở GAS/Telegram, 8 regression/privacy tests mới. 92 tests/15 files + typecheck/lint/build/dry-run/secret scan/diff check PASS; docs/23_TELEGRAM_CONNECTION.md. Cloudflare từ chối secret list do OAuth chỉ Pages; chưa đọc source/config production, chưa deploy Worker hoặc nghiệm thu Sheets thật.

## Milestone M6 — Optional / sau MVP

- [ ] M6-01 — Sync Anki local theo nhu cầu; không bắt buộc cho bản chính.
- [ ] M6-02 — Phát âm, lịch sử hỏi lại, AI tự kiểm tra từ trong hội thoại.
- [ ] M6-03 — Chuyển Sheets → D1/Supabase nếu vượt quy mô cá nhân.

## Latest accomplished

- **2026-10-12 M5-09 (local):** Người dùng xác nhận bằng log real Telegram Desktop auth 200; vocabulary 503 UNAVAILABLE. Workerd native tái hiện adapter/route trước 503/sau 200 cùng GAS mock; sửa receiver GAS/Telegram, thêm log whitelist. 92 tests/gates/dry-run pass; chờ xác nhận Worker access/hotfix, cần diff version/source production trước deploy. docs/23_TELEGRAM_CONNECTION.md.
- **2026-10-12 M5-08:** Log Telegram Desktop TypeError/fetch/HTTP null 0–1 ms dẫn tới tái hiện native Window.fetch sai receiver. Sửa `.call(globalThis, ...)`, hai regression fail trước/pass sau; 84 tests và gates pass. Production 1a4f0e48, bundle hash khớp local; browser native health chuyển từ lỗi 1 ms sang HTTP 200/OK trong 283 ms. Cần người dùng xác nhận auth trên build M5-08. docs/23_TELEGRAM_CONNECTION.md.
- **2026-10-12 M5-01 (frontend):** Người dùng xác nhận deploy. Wrangler 4.149.0 deploy Pages branch production thành công: e3229c61-7573-49a1-a05a-c957e6bfa16f; domain/menu URL trả bundle index-Ct3bC747.js, SHA256 khớp local, không còn AbortSignal.timeout, có retry và đúng API. Rollback: 21f513cc-5946-4e45-96f0-75cdbbe0dce1. Worker health 200/CORS 204; chưa live QA thiết bị. Evidence: docs/23_TELEGRAM_CONNECTION.md.
- **2026-10-12 M5-06:** Kiểm tra production: Pages/Worker health 200, CORS đúng, auth thiếu initData trả 400 hợp lệ. Tái hiện lỗi WebView thiếu AbortSignal.timeout trước khi gửi request; sửa client/retry, 68 tests và các local gates pass. Frontend đã deploy trong M5-01; chưa kiểm chứng thiết bị. Evidence: docs/23_TELEGRAM_CONNECTION.md.
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

| 2026-10-12 22:17 +07:00 | M5-06 | DONE | Kiem tra live Pages/health 200, CORS 204 va auth invalid 400; tai hien WebView thieu AbortSignal.timeout; sua timeout/retry/URL, lockfile Worker; 68 tests/13 files, typecheck/lint/build PASS. Artifact apps/web/dist va .artifacts/M5-06-frontend.zip; docs/23_TELEGRAM_CONNECTION.md. Chua deploy/kiem chung thiet bi. | M5-01: xin xac nhan deploy frontend M5-06 len Pages voice-chat-learn-language; sau deploy kiem bundle moi va nguoi dung mo lai Mini App. M5-02 live QA va M0-02/M3-01 secrets/quota/schema van pending. |

| 2026-10-12 22:23 +07:00 | M5-01 | FRONTEND_DEPLOYED | User cho phép deploy; Wrangler 4.149.0, Pages production e3229c61-7573-49a1-a05a-c957e6bfa16f, menu URL 200/bundle SHA256 khớp local, timeout cũ không còn, Worker health 200/CORS 204. Rollback 21f513cc-5946-4e45-96f0-75cdbbe0dce1. Source d1b712f + staged M5-06, commit-dirty=true; user yêu cầu chưa cần commit. docs/23_TELEGRAM_CONNECTION.md. | Người dùng mở lại Mini App; M5-02 live QA, M0-02/M3-01 secrets/quota/schema pending. |

| 2026-10-12 22:39 +07:00 | M5-07 | DONE | API diagnostics whitelist/30 attempts, x-request-id, health probe va clipboard fallback; 82 tests/14 files, typecheck/lint/build/secret scan PASS. Pages Production 2883e8b3-e60e-4498-8a29-d0f033bf1051; menu bundle index-CiqVpn3F.js SHA256 khop local. docs/23_TELEGRAM_CONNECTION.md. Chua xac dinh nguyen nhan fetch tren iPhone; khong deploy Worker; giu chua commit. | Nguoi dung mo lai Mini App tu menu bot; neu loi bam Log chan doan -> Kiem tra ket noi -> Sao chep log truoc khi dong. Doi chieu request ID/phase/status de dieu tra M5-02. M0-02/M3-01 live secrets/quota/schema pending; giu staged changes, khong can Git email/commit luc nay. |

| 2026-10-12 22:50 +07:00 | M5-08 | DONE | Native Window.fetch sai receiver tai hien Illegal invocation 0 ms; 2 regression fail truoc/pass sau. Sua call(globalThis); 84 tests/14 files, typecheck/lint/build/secret scan PASS. Pages Production 1a4f0e48-f02e-4bbe-9ec6-e8e03852a739, public hash khop local; browser production health truoc TypeError 1 ms/sau OK HTTP 200 283 ms. docs/23_TELEGRAM_CONNECTION.md; chua real Telegram auth/Gemini/Sheets; giu chua commit. | Nguoi dung mo lai/tai lai Mini App, xac nhan build M5-08-20261012 va thu dang nhap. Neu loi, gui log moi co health probe de xu ly code/status/phase tiep theo trong M5-02. M0-02/M3-01 secrets/quota/schema pending; giu staged changes, khong can Git email/commit luc nay. |

| 2026-10-12 23:04 +07:00 | M5-09 | LOCAL_FIX_READY / WAITING_WORKER_AUTH | Real Telegram Desktop auth 200, vocabulary 503. Workerd native + GAS mock: real adapter/route 503 trước sửa, 200 sau sửa, cùng config; sửa 3 fetch receivers và sanitized gas_fetch_failed. 92 tests/15 files, typecheck/lint/build/dry-run PASS. Local review package .artifacts/M5-09-worker-local.zip; docs/23_TELEGRAM_CONNECTION.md. Chưa deploy Worker; Cloudflare từ chối quyền đọc bindings với OAuth Pages hiện có. | Xin xác nhận OAuth Workers và hotfix; sau xác nhận đọc version/source/binding names production, giữ rollback, diff trước deploy receiver/log. Bundle toàn bộ có M5-05/schema v2/Cron chưa nghiệm thu, không dùng đè production khi chưa đối chiếu. Giữ staged code/docs/tests, chưa commit theo yêu cầu người dùng. |

## Current blockers / risks

- Các dòng DONE trước review là evidence lịch sử. Source đã sửa trong M5-05; các milestone dịch vụ/thiết bị thật tiếp tục pending theo tiêu chí ban đầu. Xem docs/22_REVIEW_FIXES.md.
- Sheet v1 cần backup và migrateSchemaV2 trước Worker mới; Events cũ thiếu snapshot không replay mutation chắc chắn. Digest unknown cần đối chiếu; pending UI chỉ giữ trong phiên. ScriptLock không cung cấp transaction ACID nhiều tabs.
- Free tier Gemini: cần kiểm tra model/quota của project thực trước triển khai; không đảm bảo free không giới hạn.
- Apps Script deploy yêu cầu OAuth ủy quyền và quyền chia sẻ phù hợp; chưa xác minh Script Properties trong phiên kiểm tra kết nối này.
- Có URL frontend/API production từ người dùng và đã kiểm tra public health/CORS trong M5-06. Chưa kiểm chứng account secrets/quota/schema qua các endpoint công khai. Tuyệt đối không ghi tokens vào PROGRESS/CHANGELOG.
- M5-06 đạt acceptance local và frontend đã deploy sau xác nhận. Lần `git commit` bị từ chối do thiếu author identity; người dùng sau đó yêu cầu chưa cần email/commit. Giữ code/docs/tests/lockfile trong cùng staged changes. Không yêu cầu lại xác nhận deploy M5-06 đã được cấp.
- M5-07 đã deploy log frontend trong cùng incident/quyền deploy; chưa có log từ iPhone để xác định lỗi fetch. Log chỉ giữ trong memory và cần sao chép trước khi reload/đóng cửa sổ, không tự gửi về server. Worker historical logging chưa xác minh/bật; không tìm thấy api_error không chứng minh request chưa tới Worker.
- M5-08 nhận log Telegram Desktop và đã chứng minh native fetch sai receiver; browser production health pass sau sửa. Phiên browser cũ vẫn tải bundle M5-07 sau reload, URL có query phiên bản mới nhận M5-08; chưa xác định tầng cache. Khi người dùng thử lại phải xác nhận build trong log là M5-08, không suy ra real auth/Gemini/Sheets từ health 200.
- M5-09: log mới đã xác nhận real Telegram Desktop auth 200 trên M5-08; vocabulary còn 503. Lỗi receiver Worker đã tái hiện và sửa local; chưa kiểm tra source/config/GAS production do thiếu quyền Worker. Quyền frontend đã cấp không bao gồm OAuth/deploy Worker. Phải diff source đang chạy và giữ rollback trước hotfix; không đưa migration/schema/Cron chưa nghiệm thu vào bản vá giới hạn receiver/log.

## Next session checklist

- [ ] Đọc `AGENTS.md`, `PROGRESS.md`, `docs/13_MILESTONES.md`.
- [ ] `git status --short` và đọc diff chưa commit.
- [ ] M5-09 local fix đã sẵn sàng; chờ xác nhận OAuth Workers (`workers:write`, `workers_tail:read`) và hotfix Worker hiện có. Sau xác nhận dùng Wrangler device OAuth, đọc version/source/binding names production và giữ rollback; diff trước khi deploy chỉ sửa receiver/log. Không deploy nguyên bundle local chưa đối chiếu vì M5-05/schema v2/Cron còn chưa nghiệm thu. Sau hotfix thử real vocabulary và đối chiếu request ID/log. Frontend M5-08 auth thật đã OK, không cần deploy lại. Giữ staged changes theo yêu cầu chưa commit của người dùng.
- [ ] Chạy setup/check cần thiết, ghi evidence và command.
- [ ] Khi thực sự hoàn thành, chạy `scripts/Complete-Task.ps1` và commit cả PROGRESS/CHANGELOG.
