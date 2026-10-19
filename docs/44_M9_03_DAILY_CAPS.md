# M9-03 — Daily usage caps per user (free-tier guardrail)

**Trạng thái:** DEPLOYED — Worker `2a0bf5a7-f590-4c1d-b370-6ada348f77df` (uncapped live; rollback `8bc40470`), migration 0004 đã apply
**Task ID:** M9-03
**Branch:** `feat/M9-02-multi-user` (làm liền với M9-02 vì cùng mở multi-user; commit `c99e01e`, bổ sung sau)
**Ngày mở:** 2026-10-19 (UTC+7)

## Mục tiêu

Chặn lạm dụng và bảo vệ quota free tier khi mở nhiều user: mỗi user có hạn mức ngày cố định cho từng tính năng tốn Gemini (live session, dịch câu, chat-turn lite); vượt hạn mức trả 429 với thông báo tiếng Việt rõ ràng, reset 0:00 giờ Việt Nam.

## Phạm vi

1. Migration `apps/worker/migrations/0004_usage_daily.sql`: bảng `usage_daily(user_id, local_date, kind, used, updated_at)`, `PRIMARY KEY (user_id, local_date, kind)`, `kind IN ('chat_turn','translation','live_session')`; `local_date` theo `Asia/Ho_Chi_Minh`.
2. `domain/quota.ts` (mới, Single Source of Truth cho caps):
   - `resolveDailyCaps(env)`: default `chat_turn=30`, `translation=30`, `live_session=5`/user/ngày; override qua env `DAILY_CHAT_TURNS_CAP`, `DAILY_TRANSLATIONS_CAP`, `DAILY_LIVE_SESSIONS_CAP`; giá trị không hợp lệ → default; `0` = tắt tính năng trong ngày.
   - `dailyCapMessage(kind, cap)`: thông báo tiếng Việt kèm mốc reset.
3. Miễn hạn mức theo id: `UNCAPPED_TELEGRAM_IDS` (secret, danh sách id phân tách dấu phẩy/khoảng trắng/chấm phẩy) — owner (`OWNER_TELEGRAM_ID`) **luôn** nằm trong danh sách mặc định để không tự khóa mình. Id miễn hạn mức bỏ qua cả check lẫn ghi counter (không phát sinh row `usage_daily`), áp cho cả 3 kind.
4. `repositories.ts`: `DailyUsageKind`, `DailyUsageOutcome`; method optional `checkAndConsumeUsage` trên `ReviewRepository` (adapter không có counter — GAS mode/test doubles — tự bỏ qua enforcement).
5. `d1-repository.ts`: `checkAndConsumeUsage` nguyên tử bằng 1 câu UPSERT có điều kiện:
   `INSERT ... ON CONFLICT(user_id,local_date,kind) DO UPDATE SET used=used+1 ... WHERE usage_daily.used < ? RETURNING used`
   — nhiều isolate chạy song song không thể vượt cap; bị chặn thì đọc `used` hiện tại để trả thông tin.
6. `entry.ts`: helper `enforceDailyCap` chạy sau rate-limit in-memory, trước khi gọi Gemini tại 3 route: `POST /api/v1/live-token` (live_session), `POST /api/v1/translate` (translation), `POST /api/v1/chat-turn` (chat_turn). Vượt cap → `AppError RATE_LIMITED` 429 (không retryable), log `daily_cap_exhausted` chỉ gồm kind/used/cap.

## Tiêu chí nghiệm thu

- Counter tăng đúng theo `(user, local_date, kind)`; chặn khi chạm cap; sang ngày mới tự reset; user/kind khác độc lập; 8 request song song với cap 3 → đúng 3 allowed.
- `cap = 0` → chặn và không ghi counter.
- Route chat-turn khi bị cap: 429, message chứa số cap + "giờ Việt Nam", KHÔNG gọi Gemini (fetch 0 lần).
- Id miễn hạn mức (owner mặc định qua `OWNER_TELEGRAM_ID`, hoặc trong `UNCAPPED_TELEGRAM_IDS`): không gọi `checkAndConsumeUsage`, không ghi counter, luôn qua cap dù `DAILY_*_CAP` thấp.
- Single-user regression (không có `checkAndConsumeUsage`) giữ nguyên hành vi cũ.

## Ràng buộc và quyết định

- Counter chỉ tồn tại ở D1 (đúng authority); GAS mode bỏ qua enforcement (chưa phải đường production).
- Cap mặc định chọn theo use thực tế một người: 5 phiên live (~đủ học 1 ngày), 30 câu dịch, 30 lượt chat lite — nằm sâu dưới hạn free tier kể cả hàng chục user.
- Không thêm bảng audit/cleanup ở MVP: bảng chỉ tăng ~3 row/user/ngày, nhỏ so với domain; có thể prune sau.
- Không log nội dung cá nhân: log chỉ có `kind/used/cap` với `request_id`.

## Thông báo người dùng thấy khi hết hạn mức

Message do server sinh (`quota.ts:37`), frontend hiển thị **nguyên văn** (không map lại):

> `Bạn đã dùng hết {cap} {tên} hôm nay. Giới hạn sẽ đặt lại vào 0:00 (giờ Việt Nam).`

| Ngữ cảnh                                | Tên trong message            | Nơi hiển thị                                                                                                                                   |
| --------------------------------------- | ---------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------- |
| `POST /api/v1/chat-turn` (chế độ nhẹ)   | "lượt trò chuyện chế độ nhẹ" | Hộp lỗi inline dưới hội thoại (`role="alert"`, `data-testid="lite-error"`) + nút "Gửi lại" — `LiteConversationPanel.tsx:45-48,133-137,230-243` |
| `POST /api/v1/translate`                | "lượt dịch câu"              | Dòng lỗi ngay dưới câu thoại trong transcript + nút "Thử lại" — `VoiceSessionPanel.tsx:447-456,133-137`                                        |
| `POST /api/v1/live-token` lúc bấm Start | "phiên luyện nói"            | Banner lỗi trên panel (`mic-error-banner`) — `voice-session.ts:61-69`, `VoiceSessionPanel.tsx:407-410,573-577`                                 |

- Envelope lỗi được parse tại `learning-api-client.ts:154-182` (`ApiClientError` giữ `code`/`retryable`/`status`); fallback câu chung chỉ dùng khi lỗi mạng/envelope hỏng ("Không thể kết nối máy chủ..." / "Không thể gửi lượt này...").
- Phân biệt với 429 theo phút (retryable): "Bạn đã dịch nhiều câu trong thời gian ngắn..." (dịch) và "Too many live token requests..." (live) — hai loại này hiển thị cùng chỗ nhưng hết 1 phút là dùng lại được.
- Hành vi đã biết chưa đẹp: (1) cap ngày là 429 không retryable nhưng UI vẫn hiện nút "Gửi lại"/"Thử lại"/bấm Start lại → bấm lại sẽ nhận đúng message cũ, chưa ẩn nút theo `retryable`; (2) nếu cap live cạn _giữa phiên_ lúc tự reconnect xin token mới, `gemini-live-client.ts:314-349` nuốt message token và chỉ hiện câu chung "Không thể kết nối lại Gemini. Hãy nhấn Start để thử lại." sau 4 lần retry — muốn thấy message cap phải bấm Start lại.

## Kết quả local

- `tests/d1-usage-daily.test.ts` (mới): 3/3 PASS — tăng/chặn/reset theo ngày; song song không overshoot; cap 0 không ghi.
- `apps/worker/src/entry.test.ts`: 2 test M9-03 PASS — (1) user thường (không miễn): allowed lần 1 gọi Gemini 1 lần với `localDate` đúng (+07), lần 2 bị 429 `RATE_LIMITED` kèm message, fetch không tăng; (2) owner + id trong `UNCAPPED_TELEGRAM_IDS` bypass: checker (luôn deny) không được gọi, 200 và Gemini được gọi.
- Full suite: 268/268 tests, 44 files PASS (sau thay đổi miễn hạn mức).

## Chưa làm / rủi ro

- Chưa đo quota free tier thật của flash-lite (RPD/RPM) để chốt cap production — sẽ tinh chỉnh bằng env không cần deploy code.
- Chưa có cảnh báo chủ động khi user chạm 80% cap (chỉ hiện tại mức chặn); cân nhắc M9-04 khi có telemetry.
- Rate-limit in-memory vẫn per-isolate — cap D1 là lớp bảo vệ thật.
- UX cap (xem mục "Thông báo người dùng thấy khi hết hạn mức"): nút retry vẫn hiện cho 429 không retryable; message cap live cạn giữa phiên bị nuốt trong luồng reconnect — chưa sửa, chờ đánh giá khi có QA thật.

## Deploy

- Local gates: full suite 267/267 tests/44 files (serial), typecheck/lint/build/secret scan/Prettier/diff check PASS; commit `c99e01e` push `origin/feat/M9-02-multi-user`.
- Migration: `npx wrangler d1 migrations apply voice-learn-prod-db --remote` → `0004_usage_daily.sql ✅` (0001–0003 đã applied từ trước; lần gọi đầu bị lỗi API 7403 transient, retry thành công). Verify `sqlite_master` thấy bảng `usage_daily`.
- Worker: `npx wrangler deploy` → version `8bc40470-aa6d-40fb-852a-912b72cbe3a4` (rollback `a56d81fb-7a9c-4009-ab40-5dce9dc9e165`). Smoke: `/health` 200; chat-turn không auth 401.
- Caps mặc định đang áp cho mọi user trong allowlist: 5 phiên live, 30 dịch, 30 chat-turn/ngày; muốn đổi: `npx wrangler secret put DAILY_LIVE_SESSIONS_CAP` (chỉ cần khi khác default).
- Bổ sung miễn hạn mức (`UNCAPPED_TELEGRAM_IDS`, owner mặc định miễn): commit `06121c0`, deploy version `2a0bf5a7-f590-4c1d-b370-6ada348f77df` (2026-10-19 ~11:05 +07; rollback `8bc40470`). Smoke sau deploy: `/health` 200, chat-turn không auth 401. Owner đã miễn sẵn — chỉ cần `npx wrangler secret put UNCAPPED_TELEGRAM_IDS` khi muốn miễn thêm id khác (secret put tự publish, không cần deploy code).
