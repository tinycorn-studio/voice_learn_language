# FSRS — Engine và hợp đồng thực thi

Engine: packages/shared/src/srs/fsrs-engine.ts, dùng ts-fsrs chính thức, lockfile khóa 5.4.2. Phiên bản package khác phiên bản thuật toán: export FSRSVersion bản này ghi FSRS-6.0. Không viết lại công thức. Nguồn đối chiếu 2026-10-12: [repository](https://github.com/open-spaced-repetition/ts-fsrs), [API](https://open-spaced-repetition.github.io/ts-fsrs/).

## Trách nhiệm

- Web/Mini App gửi Card ID, rating, event ID và expected Card version. Backend trả preview; client định dạng nhãn phút/giờ/ngày từ next_due_at.
- Worker đọc Card/Settings, Zod validate, gọi repeat để preview, next để chấm. Fuzz tắt nên cùng input/time/config có kết quả xác định.
- GAS kiểm HMAC/owner, giữ ScriptLock và kiểm lại Card version trước khi lưu. Lock không tạo transaction ACID xuyên tabs.
- Words giữ nghĩa/ví dụ; mỗi Card có lịch/version độc lập. vi_to_en đảo mặt; chưa có API quản lý/tạo loại Card hoặc audio listening riêng.

## Cấu hình

DEFAULT_FSRS_CONFIG là nguồn defaults: request_retention=0.9, maximum_interval=36500, enable_fuzz=false. Settings.desired_retention ánh xạ request_retention. Worker nhận retention 0.7–0.99, maximum interval nguyên 1–36500, timezone HCM/Bangkok (UTC+7), parameters_version và weights w qua validator chính thức. Unknown keys/config sai bị từ chối, không âm thầm dùng defaults.

Weights tùy chỉnh phải có revision parameters_version để audit; mặc định default-v1. Scheduler_version lấy trực tiếp FSRSVersion. Đổi dependency/weights cần chạy fixtures và review migration trước deploy.

## Trạng thái và ratings

Card lưu chuỗi New/Learning/Review/Relearning; chuyển enum số khi gọi thư viện. Reviews.review_log_json giữ **nguyên log thư viện**: rating/state là số, state là trạng thái trước review, due/review giữ ngữ nghĩa gốc. Snapshot Card trước/sau và versions ở cột riêng.

- Again là không nhớ. Card đang Review có thể vào Relearning/tăng lapses; New Again chưa phải lapse.
- Hard là nhớ khó, không tăng lapses. Card đang học có thể tiếp tục Learning.
- Good/Easy dùng thư viện, không gán cứng 1d/4d. scheduled_days=0 có thể 1 phút hoặc 10 phút; badges phải dựa timestamp.
- Dữ liệu UTC ISO8601; thống kê/nhắc UTC+7. due_today gồm overdue và Card đến hạn trước cuối ngày; completed_today đếm review events trong ngày.

## Retry và đồng thời

Worker review.lookup trước đọc Card để replay gốc, kể cả Word đã xóa/config đổi. Fingerprint giữ client Card/Word/rating/expected_version/version, không chứa thời gian Worker hoặc snapshot suy ra.

Cùng event/payload trả snapshot đã ghi. Đổi payload trả 409. Expected version chỉ so Card.row_version, không Words.version. GAS kiểm lại dưới lock. Client giữ request/event/version khi thử lại sau mất ACK.

## Migration và giới hạn

Xem [runbook](FSRS_MIGRATION.md): dry-run read-only, cold start memory có lưu nguồn, append header v1/v2/v3. Reviews immutable qua application path; chỉnh Sheet trực tiếp vẫn phá audit. Crash xuyên tabs cần đối chiếu; chưa có transaction storage hoặc optimizer. Cần staging/live QA trước release.
