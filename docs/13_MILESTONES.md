# 13 — Milestones, dependency, acceptance criteria

> **Task IDs phải đồng bộ với `PROGRESS.md`.** Milestone chỉ được DONE khi mọi task có evidence test và tiêu chí nghiệm thu. Các ước lượng bên dưới là effort kỹ thuật tương đối, không phải cam kết thời gian.

## M0 — Setup (S)

| Task  | Deliverable                                                                  | Definition of Done                                                                                                                |
| ----- | ---------------------------------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------- |
| M0-01 | Git repo, Node LTS, Git, npm, wrangler/clasp, VS Code/Rider                  | `node -v`, `npm -v`, `git --version`, `clasp --version`, `wrangler --version` được ghi vào log không có secret; `.gitignore` chạy |
| M0-02 | Accounts/project: AI Studio, Cloudflare, Telegram Bot, Google Sheet + Script | Các project đã tạo và quota/plan được xác minh; URL/id không bí mật được ghi vào config riêng, secret nằm secret manager          |
| M0-03 | Baseline rules/security                                                      | Agent đọc AGENTS; Git không chứa key; quyết định one-user auth, app entrypoint và environment được ADR                            |

## M1 — Voice local prototype (M)

| Task  | Deliverable                          | Definition of Done                                                                                                       |
| ----- | ------------------------------------ | ------------------------------------------------------------------------------------------------------------------------ |
| M1-01 | `apps/web` React/Vite, states/mic UX | `npm run typecheck/lint/test/build` pass; UI hiển thị trạng thái; mic permission error                                   |
| M1-02 | Realtime Gemini Live voice           | Nói/nghe hai chiều, có transcriptions; Stop đóng stream, iOS audio test; handling goAway, reconnect, context compression |
| M1-03 | `save_vocabulary` tool + detector    | 30 utterance fixtures; khi hỏi nghĩa tạo đúng 1 structured event; câu thường không lưu; `that` mơ hồ hỏi lại             |

## M2 — Cloudflare secure API (M)

| Task  | Deliverable                                        | Definition of Done                                                                                |
| ----- | -------------------------------------------------- | ------------------------------------------------------------------------------------------------- |
| M2-01 | Worker routes `/health` + `/api/v1/*`, Zod, errors | Tests 200/400/401/403/429, no secrets in response, observability request_id                       |
| M2-02 | Telegram initData auth + webhook secret            | Valid auth passes, tampered/expired/missing fails; verify allowlist; replay/update_id dedup       |
| M2-03 | Gemini `/live-token` endpoint                      | Real ephemeral single-use token minted only for verified user, no long-term key in web/assets/log |
| M2-04 | Cron + CI                                          | schedule UTC tested; unit/integration CI pass, deployment can be rolled back                      |

## M3 — Google Sheets + Apps Script (M)

| Task  | Deliverable                             | Definition of Done                                                                                       |
| ----- | --------------------------------------- | -------------------------------------------------------------------------------------------------------- |
| M3-01 | sheet tabs + Script Properties + clasp  | `clasp pull`/diff, `clasp push`, version/deployment sequence verified; Apps Script Web App authorized    |
| M3-02 | Worker HMAC ↔ GAS; `Words` and `Events` | Tampered/old payload rejected; parallel identical events create 1 word and 1 event; no formula injection |
| M3-03 | Word CRUD + API contract                | User can list/search/edit/delete; tests include 2 meanings of one word, owner isolation                  |
| M3-04 | E2E persist + backup                    | Live query stored once; retry tested; CSV export restore; fallback on GAS unavailable                    |

## M4 — FSRS Spaced Repetition + Telegram Review (L)

| Task    | Deliverable                | Definition of Done                                                                                                     |
| ------- | -------------------------- | ---------------------------------------------------------------------------------------------------------------------- |
| M4-01   | deterministic FSRS domain  | Tích hợp `ts-fsrs@^5.4.2`; Again/Hard/Good/Easy unit fixtures pass 100%, UTC safe; Hard không fail recall              |
| M4-02   | Telegram Bot / callback    | Callback `r:wordId:rating` ghi nhận FSRS, duplicate update không nhân đôi progress, malformed callback fails safely    |
| M4-03   | scheduled daily reminder   | One digest/day/user tại ~08:00 +07; zero reminders on opt-out; Cron retry không spam                                   |
| M4-04   | Mini App & Web FSRS review | Giao diện flashcards hiển thị interval badges (1m, 10m, 1d, 4d), gọi FSRS preview API, offline/error UX, thống kê FSRS |
| M4-FSRS | Schema V3 & backend engine | Tách bảng `Cards`, `Reviews` append-only kèm `review_log_json`, `Settings`; migration V3 an toàn không sinh trùng lặp  |

## M5 — Release/production quality (M)

| Task  | Deliverable                   | Definition of Done                                                                                                                                                                                                                                |
| ----- | ----------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5-01 | prod deploy                   | Worker/Web/GAS versions recorded, key/permissions reviewed, secrets only in managers                                                                                                                                                              |
| M5-02 | full QA matrix                | PC Chrome, Android Chrome/Telegram, iOS Telegram/Safari: audio focus, mic, lifecycle, 3 key flows pass                                                                                                                                            |
| M5-03 | observability/runbook         | Recovery test for bot token, GAS rollback, worker rollback, Sheets backup/restore, quota exhaustion                                                                                                                                               |
| M5-04 | Review triển khai Antigravity | Đối chiếu source/spec, chạy typecheck/lint/test/build và secret scan; báo cáo lỗi có vị trí và bằng chứng tái hiện; cập nhật task cần mở lại                                                                                                      |
| M5-05 | Sửa R01–R09                   | API/auth/UI/PCM/playback nối thật; regression tests cho retry, digest, CRUD, reconnect, detector và CSV; gates local pass; ghi rõ live QA chưa thực hiện                                                                                          |
| M5-06 | Review FSRS & Kết nối Mini App | Card version độc lập, replay payload gốc, migration dry-run read-only, Settings/native audit/UTC+7; URL cấu hình sai được phát hiện, timeout tương thích WebView, thử đăng nhập lại sau lỗi; regression tests và các gate local pass |
| M5-07 | Log chẩn đoán kết nối         | Mỗi API attempt có request ID/code/status/phase/duration và context whitelist; health probe không auth, UI sao chép log trên iOS, bounded memory; regression privacy/timeout/network/schema và local gates pass; kiểm bundle public, giữ giới hạn DNS/TLS/CORS |
| M5-08 | Native fetch receiver         | Tái hiện lỗi receiver trước sửa trong browser, regression trước/sau; gọi native fetch với global receiver, giữ DI/tests và privacy; local gates pass, frontend production được kiểm chứng; live Telegram auth vẫn cần user QA |
| M5-09 | Worker → GAS 503              | Tái hiện runtime Workers native với adapter thật, fix/regression/log whitelist, local gates và dry-run pass; chuẩn bị package Worker reviewable, chỉ deploy/cấp quyền sau xác nhận riêng; config/schema/live QA không suy ra từ mock |
| M5-10 | Gemini token HTTP 400 → 502   | Đối chiếu REST AuthToken/Discovery và probe không credentials; sửa payload/ràng buộc model/audio với regression fail trước/pass sau; typecheck/lint/test/build/dry-run/secret scan pass. Chuẩn bị diff/artifact trước deploy; mint/voice project thật là nghiệm thu riêng, không suy ra từ key giả/mock |
| M5-11 | Review capture từ → FSRS | Báo cáo source + production parity, tái hiện luồng bị bỏ sót bằng synthetic probes, kiểm tests liên quan, phân biệt code có/chưa deploy/chưa QA. Review read-only production; không tự coi tính năng hoặc milestone đã hoàn thiện |
| M5-12 | Sửa capture và frontend FSRS | Regression cho named question/punctuation/tool-ASR ordering/missing tool, chống duplicate, audio không chờ write và Stop/budget; full gates pass, deploy frontend đúng API/build tag/Card/preview/stats và verify hash; live Sheet/Card/review nghiệm thu riêng |
| M5-13 | Kế hoạch D1 và latency | PLAN ONLY: đối chiếu source/API/quota, lựa chọn Sheet một chiều, chia tasks M7 có acceptance/data preservation/migration/rollback/targets; kiểm links/task consistency, không suy implementation hoặc deploy từ tài liệu |

## M6 — Optional (không chặn release)

- M6-01 Anki optional exporter/local sync — nếu cần SRS native Anki.
- M6-02 Phát âm, memory-based conversation review, spaced insertion.
- M6-03 D1 migration được ưu tiên thành M7 do latency thực tế; không triển khai Supabase cùng lúc.

## M7 — D1 primary và hiệu năng (IN_PROGRESS, chưa cutover)

Plan: [27_D1_PERFORMANCE_MIGRATION_PLAN.md](27_D1_PERFORMANCE_MIGRATION_PLAN.md). Sheet chỉ xem/xuất, sửa qua app. Mỗi dòng là task implementation riêng, chưa được thực thi trong M5-13.

| Task | Đầu ra | Definition of Done |
| --- | --- | --- |
| M7-01 | Baseline/diagnostics | p50/p95 từng chặng, capture direct/recovery, copy khi HTTP đều 200, metadata privacy tests |
| M7-02 | ACK/refresh UX | Saved chỉ sau commit; refresh nền lỗi không phủ định save, audio không block; Telegram ACK sớm, kết quả thật sau commit |
| M7-03 | D1 schema/factory | D1 local/staging thật, constraints/transaction guards, môi trường tách biệt và cấu hình fail closed |
| M7-04 | D1 repositories/FSRS | CRUD/preview/stats/replay/alias parity, authoritative ts-fsrs/native logs, OCC/crash rollback, atomic outbox |
| M7-05 | Telegram/Cron D1 | Commands, update dedup/delivery recovery, old keyboard, digest sent/failed/unknown không spam |
| M7-06 | Sheet mirror/outbox | One-way HMAC batch, lease/retry/dead-letter/version/duplicate ACK; GAS hỏng không chặn app/ôn tập |
| M7-07 | Migration/verify tools | Full 7-tab export, ID/due/memory/audit/HMAC replay preservation, resumable import, quarantine và rollback runbook |
| M7-08 | Staging rehearsal | Runtime thật, verify 100%/restore rehearsal, security/fault/concurrency/FSRS, latency và Free CPU/quota gates |
| M7-09 | Production cutover | Được phép sau artifact review; freeze/drain/final snapshot, verify, mọi writer D1, live smoke và rollback code giữ D1 |
| M7-10 | Operational QA | Rating/due audit thật, mirror outage/recovery, growth/quota/backup restore; ghi đúng các device/criteria chưa kiểm chứng |
| M7-11 | Sửa rollout sau audit | Backup/Sheet-D1 parity, giữ dữ liệu hiện có, Cron mỗi phút/mirror ACK, frontend production hash, backend FSRS/replay, gates/CI/Git; không thay nghiệm thu thiết bị M7-10 |
| M7-12 | Sửa API origin trong production bundle | Build từ Git không cần env private; bundle thật auth tới Worker; chặn build origin sai; CI/Pages/hash/route verify |

## M8 — Trải nghiệm hội thoại

| Task | Đầu ra | Definition of Done |
| --- | --- | --- |
| M8-01 | Theo dõi transcript và dịch theo yêu cầu | Transcript tự cuộn khi người dùng đang ở cuối; giữ nguyên vị trí khi người dùng đang đọc lịch sử và có nút về lượt mới. Mỗi lượt hoàn tất có nút dịch sang tiếng Việt, bản dịch hiển thị cạnh câu gốc, chỉ gọi Worker khi bấm, không chen vào Gemini Live. API yêu cầu auth, giới hạn input/rate/timeout, validate output và không log/lưu nội dung; regression UI/API cùng typecheck/lint/test/build pass. |
| M8-02 | Giảm độ trễ tương tác | Lưu từ/chấm ôn gom preflight reads D1 mà giữ idempotency/OCC/atomic writes; delivery Telegram xử lý revision mới nhất trước và có timing ACK/commit/delivery không chứa nội dung; transcript interim cập nhật/cuộn theo animation frame. Regression batching/concurrency/order/privacy/UI pass và benchmark local p50/p95 được ghi so với baseline; không suy ra production latency hoặc quota từ local. |
| M8-03 | Màn hình sẵn sàng nhanh, tải dữ liệu theo nhu cầu | Sau auth, Voice không chờ vocabulary; Vocabulary fetch khi mở tab và có trạng thái loading/error riêng; Telegram SDK không chặn parse và khởi tạo trước module app; Review/Vocabulary code split khỏi entry chunk; startup diagnostics allowlist/bounded/memory-only; hướng dẫn đo D1 storage bằng dashboard/aggregate query không lộ rows. Tests chứng minh không có request vocabulary trước khi mở tab, voice-ready độc lập, script order, diagnostics privacy, lazy chunks; full gates pass. Không purge audit/replay/outbox và chưa deploy. |
| M8-04 | Hệ visual thống nhất cho Mini App | Kết hợp Navy tối giản + khoảng thở Calm Light, bỏ trang trí game; semantic color/spacing/type tokens có light/dark theo Telegram theme và OS fallback. Icon ở tab, trạng thái và hành động chính rõ hơn; button có viền/màu theo ý nghĩa (primary/danger/success/neutral), focus-visible và vùng chạm tối thiểu thực dụng 44px. Không đổi luồng/API. Kiểm tra contrast theo WCAG 2.2 AA, responsive ở viewport hẹp, component tests + typecheck/lint/build/secret scan/diff check PASS. Chi tiết docs/35_M8_04_VISUAL_SYSTEM.md. |
| M8-05 | Theme, duy trì voice và tiện ích giao diện | Người dùng có nút theme sáng/tối; mặc định theo Telegram/OS, lựa chọn thủ công được lưu và có thể reset về tự động. Đổi tab không unmount/dừng voice; có trạng thái để quay lại Voice. Lưu từ thành công hiển thị toast tự ẩn; pending/failed vẫn nhìn thấy và retry được. Hướng dẫn/quyền riêng tư chỉ mở từ nút Info bằng dialog accessible. Regression UI, typecheck/lint/test/build/secret scan/diff check pass. Frontend local; production chỉ sau yêu cầu deploy riêng. Chi tiết docs/36_M8_05_MINIAPP_CONTROLS.md. |
| M8-06 | Feedback và lỗi theo ngữ cảnh | Thông báo không nhận diện từ dùng toast lịch sự trong khi mục chưa lưu còn trong hàng chờ; lỗi auth/tải dữ liệu/lưu được đặt đúng phạm vi và có retry; trạng thái capture không trùng; copy log dùng toast; review preview có nút retry; lỗi sửa/xóa nằm cạnh form/hàng. Regression tests/full suite, typecheck/lint/build/secret scan pass; không đổi API/quota/backend. Pages Production `M8-06-20261016` deployed, public HTML/JS/CSS/lazy chunks HTTP 200 và SHA256 khớp local; chờ QA Mini App trên thiết bị Telegram thật. Chi tiết docs/37_M8_06_UX_FEEDBACK.md. |

Dependencies: M7-01 → M7-03 → M7-04 → M7-05/M7-06/M7-07 → M7-08 → M7-09 → M7-10. M7-02 thực hiện sớm sau baseline; không chờ chuyển kho để cải thiện UX.

## Dependency path

`M0 → M1` (Voice local) và `M0 → M2` (Worker) có thể song song; `M2 + M3` trước lưu từ production; `M3 + M2 → M4`; `M1 + M2 + M3 + M4 → M5`.

## Release gates

- Không merge code lỗi lint/test/build. Không deploy free-tier keys trước auth. Không public Web App Apps Script khi chưa validate HMAC. Không gắn Telegram webhook khi chưa check header secret.
- Biên bản acceptance lưu trong `PROGRESS.md` kèm task IDs và các lệnh đã chạy; thông số/nhược điểm chưa đạt phải ghi blocker.
