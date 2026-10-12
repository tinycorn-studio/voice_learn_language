# 16 — Spaced Repetition Specification (MVP)

## Vì sao dùng scheduler đơn giản trước
MVP cá nhân, Sheets là kho chính; chưa cần FSRS phức tạp cần nhiều dữ liệu và kiểm chứng. Dùng lịch ngắt quãng có thể giải thích, test deterministic, không bịa rằng tương thích Anki-FSRS.

## State
- New word: `review_state=new`, `repetitions=0`, `interval_days=0`, `ease_factor=2.5`, `due_at=created_at` (đến hạn ngay hoặc user chọn ôn hôm sau).
- Grades: `again`, `hard`, `good`, `easy`.
- Mọi sự kiện review có `event_id`; request cùng event không được cập nhật nhiều lần.

## Algorithm v1 (Proposed, cần chốt M4-01)
- `again`: repetitions=0, interval_minutes=10; due = now+10m, ease=max(1.3, old_ease-0.2).
- `hard`: repetitions giữ hoặc +1 theo phase, interval = max(1 day, ceil(old_interval_days*1.2)), ease=max(1.3, old_ease-0.15).
- `good`: interval = nếu lần đầu 1d, lần tiếp 3d, sau đó max(4, ceil(old_interval_days*ease)); ease giữ.
- `easy`: interval = nếu lần đầu 4d, sau đó max(5, ceil(old_interval_days*ease*1.3)); ease=min(3.0, old_ease+0.15).
- Nếu interval cho thẻ `learning` <1 ngày: lưu `due_at` chính xác phút; ngày đầu vẫn có thể lặp trong ngày. Theo timezone user chỉ để nhắc/hiển thị, không tính date strings trực tiếp bằng timezone máy.

## Invariants
- `due_at` luôn ISO8601 UTC; `interval_days >=0`, `1.3<=ease_factor<=3.0`.
- Không apply một rating hai lần cùng `event_id`; review append-only kèm before/after.
- Nếu user sửa nghĩa, không xóa tiến độ trừ khi explicit reset.
- Bỏ qua (suspend)/xóa thì không gửi notify.
- Giới hạn số due mỗi ngày (default 10, configurable); sort overdue trước hoặc fairness per new/review.

## Test vectors M4-01
1. New + good → due 24h sau now.
2. New + easy → due 96h sau.
3. New + again → due 10m sau.
4. 3rd good với ease=2.5 và old interval=3d → khoảng 8d (ceil 7.5).
5. Hard không tạo due quá khứ; ease không dưới 1.3.
6. Review 23:59 VN → time UTC đúng khi qua ngày mới.
7. Same event_id replay → response cũ, không thêm review.
8. Pause notifications không đổi due_at; chỉ tắt gửi reminder.

## Nâng cấp FSRS
Nếu sau này cần tối ưu retention, nghiên cứu FSRS (stability/difficulty/retrievability) + dataset history; tạo ADR và migration. Không tuyên bố scheduler này là Anki hoặc chính xác tối ưu.
