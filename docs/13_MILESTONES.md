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

## M4 — SRS + Telegram review (L)

| Task  | Deliverable              | Definition of Done                                                                          |
| ----- | ------------------------ | ------------------------------------------------------------------------------------------- |
| M4-01 | deterministic SRS domain | Again/Hard/Good/Easy unit fixtures pass, UTC safe; overdue/day rollover tested              |
| M4-02 | Telegram Bot / callback  | Valid callback marked, duplicate update no double progress, malformed callback fails safely |
| M4-03 | scheduled daily reminder | One digest/day/user at ~08:00 +07; zero reminders on opt-out; Cron retry does not spam      |
| M4-04 | Mini App flashcards      | Mobile/desktop review, loading/error/offline UX, accessibility labels, progress statistics  |

## M5 — Release/production quality (M)

| Task  | Deliverable                   | Definition of Done                                                                                                                                       |
| ----- | ----------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------- |
| M5-01 | prod deploy                   | Worker/Web/GAS versions recorded, key/permissions reviewed, secrets only in managers                                                                     |
| M5-02 | full QA matrix                | PC Chrome, Android Chrome/Telegram, iOS Telegram/Safari: audio focus, mic, lifecycle, 3 key flows pass                                                   |
| M5-03 | observability/runbook         | Recovery test for bot token, GAS rollback, worker rollback, Sheets backup/restore, quota exhaustion                                                      |
| M5-04 | Review triển khai Antigravity | Đối chiếu source/spec, chạy typecheck/lint/test/build và secret scan; báo cáo lỗi có vị trí và bằng chứng tái hiện; cập nhật task cần mở lại             |
| M5-05 | Sửa R01–R09                   | API/auth/UI/PCM/playback nối thật; regression tests cho retry, digest, CRUD, reconnect, detector và CSV; gates local pass; ghi rõ live QA chưa thực hiện |
| M5-06 | Chẩn đoán kết nối Mini App | URL cấu hình sai được phát hiện, timeout tương thích WebView, có thể thử đăng nhập lại sau lỗi; regression và local gates pass; runbook API/CORS ghi rõ giới hạn kiểm chứng live |
| M5-07 | Log chẩn đoán kết nối | Mỗi API attempt có request ID/code/status/phase/duration và context whitelist; health probe không auth, UI sao chép log trên iOS, bounded memory; regression privacy/timeout/network/schema và local gates pass; kiểm bundle public, giữ giới hạn DNS/TLS/CORS |
| M5-08 | Native fetch receiver | Tái hiện lỗi receiver trước sửa trong browser, regression trước/sau; gọi native fetch với global receiver, giữ DI/tests và privacy; local gates pass, frontend production được kiểm chứng; live Telegram auth vẫn cần user QA |
| M5-09 | Worker → GAS 503 | Tái hiện runtime Workers native với adapter thật, fix/regression/log whitelist, local gates và dry-run pass; chuẩn bị package Worker reviewable, chỉ deploy/cấp quyền sau xác nhận riêng; config/schema/live QA không suy ra từ mock |

## M6 — Optional (không chặn release)

- M6-01 Anki optional exporter/local sync — nếu cần SRS native Anki.
- M6-02 Phát âm, memory-based conversation review, spaced insertion.
- M6-03 D1 migration khi Sheets chậm hoặc multi-user.

## Dependency path

`M0 → M1` (Voice local) và `M0 → M2` (Worker) có thể song song; `M2 + M3` trước lưu từ production; `M3 + M2 → M4`; `M1 + M2 + M3 + M4 → M5`.

## Release gates

- Không merge code lỗi lint/test/build. Không deploy free-tier keys trước auth. Không public Web App Apps Script khi chưa validate HMAC. Không gắn Telegram webhook khi chưa check header secret.
- Biên bản acceptance lưu trong `PROGRESS.md` kèm task IDs và các lệnh đã chạy; thông số/nhược điểm chưa đạt phải ghi blocker.
