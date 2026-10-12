# 14 — Architecture Decision Records (ADRs)

Mọi thay đổi lớn tạo ADR mới bằng `docs/templates/ADR_TEMPLATE.md`, ghi context, alternatives, consequence, owner, date, status và link PR/task.

## ADR-001 — Telegram Mini App là auth/entrypoint production
- Date: 2026-10-12; Status: Proposed (cần chốt ở M0-03).
- Decision: Mini App là entrypoint chính để có raw Telegram initData và user identity, desktop có thể mở Telegram Desktop. Standalone browser chỉ local dev cho đến khi có đăng nhập riêng.
- Rationale: Tránh tạo mật khẩu riêng/sessions anonymous mở Gemini API gây lộ quota.
- Tradeoff: Phụ thuộc Telegram webview; UI standalone sẽ có giới hạn.

## ADR-002 — Google Sheets làm database v1
- Date: 2026-10-12; Status: Proposed.
- Decision: Apps Script facade + Google Sheets 5 tabs, Worker↔GAS HMAC.
- Rationale: Dễ setup, miễn phí trong quota cá nhân, dễ xem bằng mắt.
- Tradeoff: Không có transactions chuẩn, concurrent writes khó, cần ScriptLock/Events. Migrate D1 khi scale.

## ADR-003 — Bỏ n8n và Anki khỏi MVP
- Date: 2026-10-12; Status: Proposed.
- Decision: Worker/webhook/Cron và Telegram Mini App tự làm quiz + SRS.
- Rationale: Không cần local PC chạy, source dễ quản lý, ít dependency.
- Tradeoff: Tự implement SRS/test schedule.

## ADR-004 — Apps Script quản lý bằng Git + clasp
- Date: 2026-10-12; Status: Accepted for planning.
- Decision: `apps-script/*.gs` + `appsscript.json` trong Git là source chính. `clasp push` cập nhật code; `clasp version/redeploy` publish sau test/approval. Repo có scripts vận hành và progress tracking.
- Risk: OAuth refresh token secret, accidental overwrite/push to wrong script. Mitigation: ignored `.clasp.json`, manual `clasp status`/diff, separate staging/prod mappings, no `--force` default.

## ADR-005 — Direct Live API + ephemeral tokens
- Date: 2026-10-12; Status: Proposed.
- Decision: Worker xác thực user và cấp short-lived token, browser nối Gemini trực tiếp; không proxy audio qua Worker.
- Rationale: low latency + tiết kiệm CPU/quota Worker; long-term API key giữ kín.
- Tradeoff: preview API ephemeral tokens và session lifecycle phải được theo dõi.
