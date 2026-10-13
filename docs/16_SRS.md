# 16 — Ôn tập FSRS và chống chấm lặp

Backend dùng ts-fsrs chính thức; defaults tập trung retention 0.9, maximum interval 36500, fuzz tắt. Xem [engine](FSRS_ENGINE.md), [schema](09_DATA_SCHEMA.md), [migration](FSRS_MIGRATION.md), ADR-008.

Words chứa ngữ nghĩa. Cards có lịch độc lập: Card ID, state New/Learning/Review/Relearning, stability/difficulty, due, reps/lapses và row_version. Sửa Word không tăng Card version. Reviews giữ native log/snapshot trước/sau.

Again là quên; Hard vẫn nhớ nhưng khó, không tăng lapses. Good/Easy do thư viện tính. New Again chưa phải lapse; Hard trong Learning có thể tiếp tục Learning. Không gán interval cố định từ rating. UI preview từ backend, nhãn next_due_at phân biệt 1m/10m.

Web gửi event_id/Card ID/rating/expected Card version. Backend replay event gốc trước đọc trạng thái hiện tại; payload đổi hoặc stale Card trả 409. GAS kiểm version dưới ScriptLock. Mất ACK thì client dùng đúng event/version cũ, không tạo event mới cho lần chấm chưa xác nhận.

Telegram callback r:<card_id>:<rating>:<row_version> tối đa 64 bytes; Word callback cũ vẫn hỗ trợ. ID không cắt ngắn. Cron/hiển thị UTC+7, dữ liệu UTC. Migration v3 trước mở writers; crash xuyên tabs cần đối chiếu, không có ACID.

Hàm SM-2 trong packages/shared/src/srs/engine.ts chỉ giữ fixtures cũ, không dùng review production. Không thêm lịch fallback thủ công khi FSRS/config lỗi; trả lỗi để xử lý.
