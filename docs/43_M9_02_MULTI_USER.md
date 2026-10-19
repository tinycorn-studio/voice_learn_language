# M9-02 — Multi-user Telegram allowlist

**Trạng thái:** IN_PROGRESS — code + tests pass local, chờ xác nhận deploy (Worker secret `ALLOWED_TELEGRAM_IDS`)
**Task ID:** M9-02
**Branch:** `feat/M9-02-multi-user` (tạo từ `55f1674`)
**Ngày mở:** 2026-10-19 (UTC+7)

## Mục tiêu

Thay thế mô hình một-owner bằng allowlist nhiều user để mở dần cho người dùng thật (1k user/day) mà vẫn giữ cô lập dữ liệu per-user: auth Telegram, webhook Bot và cron digest đều hoạt động theo danh sách user, mirror Google Sheet chỉ chạy cho owner.

## Bối cảnh

- M2-02 chỉ cho `OWNER_TELEGRAM_ID`; mọi user khác bị 403 ở `POST /api/v1/auth/telegram` và webhook Telegram.
- Dữ liệu D1 đã cô lập theo `telegram:<id>` từ trước; cron digest chỉ chạy 1 user; mirror GAS có policy owner-only ("Forbidden by Apps Script owner policy").
- Không được mở thêm user trước khi M9-03 (daily caps) hoạt động.

## Phạm vi

1. `telegram-auth.ts`: `parseAllowedTelegramIds({ raw, ownerTelegramId })` — tách id từ `ALLOWED_TELEGRAM_IDS` theo dấu phẩy/khoảng trắng/chấm phẩy, dedupe, bỏ token không hợp lệ; owner luôn nằm trong danh sách nên cấu hình sai không khóa được operator. `verifyTelegramInitData` và `verifySessionToken` nhận `allowedTelegramIds: readonly number[]` và check membership (403 khi ngoài danh sách).
2. `env.ts`: thêm `ALLOWED_TELEGRAM_IDS?: string` (secret).
3. `entry.ts`:
   - Helper `allowedIds(env)` dùng chung cho auth route, session verify và webhook.
   - Webhook Telegram: callback/message chấp nhận mọi sender trong allowlist; mọi thao tác ghi theo `telegram:<sender_id>` (trước đây luôn là owner). Sender ngoài danh sách → 403.
   - Cron digest: lặp per-user trong allowlist, mỗi tick xử lý cửa sổ xoay vòng `DIGEST_USERS_PER_TICK = 5` user để giới hạn subrequest Free tier; return shape giữ nguyên (`{dispatched, reason, localDate, dueCount}`) cho single-user; user đã nghỉ vẫn skip idempotent qua `already_dispatched`.
4. Mirror gating: `D1RepositoryAdapter` nhận `mirrorOwnerUserId` (optional, tham số thứ 4); `commit()` chỉ enqueue `sync_outbox` cho owner, 3 call site `dispatchMirrorStatement` (digest claim/finish/unknown) gate theo cùng điều kiện; `repository-factory.ts` truyền `telegram:${OWNER_TELEGRAM_ID}`. Dữ liệu non-owner vẫn được ghi D1 đầy đủ (local-only, không mirror).

## Tiêu chí nghiệm thu

- User thứ hai trong `ALLOWED_TELEGRAM_IDS` auth được, nhận session token và thao tác trên dữ liệu của chính mình (`telegram:<id>`).
- Session token hợp lệ nhưng subject ngoài allowlist → 403; initData chữ ký hợp lệ nhưng user ngoài allowlist → 403.
- Webhook: sender trong allowlist ghi prefs theo account của họ; sender ngoài allowlist → 403, không ghi.
- Cron: một tick gửi digest cho từng user đến hạn (test 2 user cùng tick); hành vi single-user không đổi (TC-12 cũ vẫn pass).
- Non-owner không tạo job mirror; owner vẫn mirror bình thường. Single-user regression giữ nguyên.

## Ràng buộc và quyết định

- Allowlist qua env (secret), không thêm bảng D1: mở/đóng user chỉ cần đổi secret + redeploy Worker, rollback nhanh.
- Mirror chỉ owner vì GAS policy chỉ nhận owner; ghi non-owner vào outbox chỉ tạo job chết.
- Cron giới hạn 5 user/tick + xoay vòng trong cửa sổ 08:00–08:05 +07 (6 tick); allowlist đông hơn cần redesign theo deliveries (đã ghi blocker).
- `parseAllowedTelegramIds` luôn gộp owner: an toàn vận hành trong mọi cấu hình.

## Kết quả local

- `apps/worker/src/auth/telegram-auth.test.ts` (mới): 4/4 PASS — parse comma/space/semicolon + owner fallback; initData/session membership cả 2 chiều.
- `apps/worker/src/entry.test.ts`: 16/16 PASS — thêm test M9-02 (auth user thứ hai + session scoped + outsider 403 cả initData/session), webhook multi-user (ghi đúng account, outsider 403), cron fan-out 2 user/tick.
- `tests/d1-mirror.test.ts`: 10/10 PASS — thêm test mirror owner-only (non-owner không tạo outbox, dữ liệu D1 vẫn đủ; owner vẫn tạo job).
- Full suite: 267/267 tests, 44 files PASS (trước M9-02/M9-03: 255/42).

## Chưa làm / rủi ro

- Chưa deploy: cần `wrangler secret put ALLOWED_TELEGRAM_IDS` (danh sách owner + user thật) trước khi mở.
- Allowlist lớn (>~30 user/ngày) vượt budget digest window — cần redesign deliveries.
- Webhook per-user dùng chung bot token; rate limit Telegram phía Telegram Bot API cần theo dõi khi đông người dùng.
