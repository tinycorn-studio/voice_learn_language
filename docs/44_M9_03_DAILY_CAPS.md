# M9-03 — Daily usage caps per user (free-tier guardrail)

**Trạng thái:** IN_PROGRESS — code + tests pass local, chờ xác nhận deploy
**Task ID:** M9-03
**Branch:** `feat/M9-02-multi-user` (làm liền với M9-02 vì cùng mở multi-user)
**Ngày mở:** 2026-10-19 (UTC+7)

## Mục tiêu

Chặn lạm dụng và bảo vệ quota free tier khi mở nhiều user: mỗi user có hạn mức ngày cố định cho từng tính năng tốn Gemini (live session, dịch câu, chat-turn lite); vượt hạn mức trả 429 với thông báo tiếng Việt rõ ràng, reset 0:00 giờ Việt Nam.

## Phạm vi

1. Migration `apps/worker/migrations/0004_usage_daily.sql`: bảng `usage_daily(user_id, local_date, kind, used, updated_at)`, `PRIMARY KEY (user_id, local_date, kind)`, `kind IN ('chat_turn','translation','live_session')`; `local_date` theo `Asia/Ho_Chi_Minh`.
2. `domain/quota.ts` (mới, Single Source of Truth cho caps):
   - `resolveDailyCaps(env)`: default `chat_turn=30`, `translation=30`, `live_session=5`/user/ngày; override qua env `DAILY_CHAT_TURNS_CAP`, `DAILY_TRANSLATIONS_CAP`, `DAILY_LIVE_SESSIONS_CAP`; giá trị không hợp lệ → default; `0` = tắt tính năng trong ngày.
   - `dailyCapMessage(kind, cap)`: thông báo tiếng Việt kèm mốc reset.
3. `repositories.ts`: `DailyUsageKind`, `DailyUsageOutcome`; method optional `checkAndConsumeUsage` trên `ReviewRepository` (adapter không có counter — GAS mode/test doubles — tự bỏ qua enforcement).
4. `d1-repository.ts`: `checkAndConsumeUsage` nguyên tử bằng 1 câu UPSERT có điều kiện:
   `INSERT ... ON CONFLICT(user_id,local_date,kind) DO UPDATE SET used=used+1 ... WHERE usage_daily.used < ? RETURNING used`
   — nhiều isolate chạy song song không thể vượt cap; bị chặn thì đọc `used` hiện tại để trả thông tin.
5. `entry.ts`: helper `enforceDailyCap` chạy sau rate-limit in-memory, trước khi gọi Gemini tại 3 route: `POST /api/v1/live-token` (live_session), `POST /api/v1/translate` (translation), `POST /api/v1/chat-turn` (chat_turn). Vượt cap → `AppError RATE_LIMITED` 429 (không retryable), log `daily_cap_exhausted` chỉ gồm kind/used/cap.

## Tiêu chí nghiệm thu

- Counter tăng đúng theo `(user, local_date, kind)`; chặn khi chạm cap; sang ngày mới tự reset; user/kind khác độc lập; 8 request song song với cap 3 → đúng 3 allowed.
- `cap = 0` → chặn và không ghi counter.
- Route chat-turn khi bị cap: 429, message chứa số cap + "giờ Việt Nam", KHÔNG gọi Gemini (fetch 0 lần).
- Single-user regression (không có `checkAndConsumeUsage`) giữ nguyên hành vi cũ.

## Ràng buộc và quyết định

- Counter chỉ tồn tại ở D1 (đúng authority); GAS mode bỏ qua enforcement (chưa phải đường production).
- Cap mặc định chọn theo use thực tế một người: 5 phiên live (~đủ học 1 ngày), 30 câu dịch, 30 lượt chat lite — nằm sâu dưới hạn free tier kể cả hàng chục user.
- Không thêm bảng audit/cleanup ở MVP: bảng chỉ tăng ~3 row/user/ngày, nhỏ so với domain; có thể prune sau.
- Không log nội dung cá nhân: log chỉ có `kind/used/cap` với `request_id`.

## Kết quả local

- `tests/d1-usage-daily.test.ts` (mới): 3/3 PASS — tăng/chặn/reset theo ngày; song song không overshoot; cap 0 không ghi.
- `apps/worker/src/entry.test.ts`: test M9-03 mới PASS — allowed lần 1 gọi Gemini 1 lần với `localDate` đúng (+07), lần 2 bị 429 `RATE_LIMITED` kèm message, fetch không tăng.
- Full suite: 267/267 tests, 44 files PASS.

## Chưa làm / rủi ro

- Chưa đo quota free tier thật của flash-lite (RPD/RPM) để chốt cap production — sẽ tinh chỉnh bằng env không cần deploy code.
- Chưa có cảnh báo chủ động khi user chạm 80% cap (chỉ hiện tại mức chặn); cân nhắc M9-04 khi có telemetry.
- Rate-limit in-memory vẫn per-isolate — cap D1 là lớp bảo vệ thật.
