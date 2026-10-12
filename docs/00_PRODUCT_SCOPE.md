# 00 — Product Scope / yêu cầu nghiệp vụ

## Persona / phạm vi MVP
- 1 người dùng cá nhân, chat tiếng Anh bằng giọng nói trên Telegram Mini App (có thể mở trên Telegram Desktop/mobile). Standalone browser tạm thời chỉ local dev cho đến khi có cơ chế đăng nhập riêng.
- Đề cao quota miễn phí, bảo mật key, không cần máy tính/server riêng chạy liên tục. Hosted serverless chạy theo request/webhook/scheduler.
- Bảng từ: từ, loại từ, nghĩa ngắn, IPA (có thể chưa có ở MVP), ví dụ, câu đã hỏi, created/last_seen, count, due date, status. `Word` có thể có nhiều `sense`.
- Tự lưu khi người dùng **hỏi nghĩa** hoặc **yêu cầu nói từ tương ứng bằng tiếng Anh**. Không lưu mọi từ người dùng sử dụng thông thường.

## User stories / Acceptance
**US-01 Voice conversation:** nhấn Start, cấp quyền mic, nói, nghe AI trả lời; có transcript tối thiểu và nút Stop; xử lý mic denied, disconnect và iOS interaction-to-play audio.

**US-02 Detect word:** `What does overwhelmed mean?` → `overwhelmed`; `What does that mean?` → đối tượng rõ ràng ở câu AI ngay trước; không rõ → hỏi lại, KHÔNG lưu phỏng đoán.

**US-03 Persist:** lưu thành công hiển thị non-blocking `Saved` (hoặc pending nếu đang retry). Gọi 3 lần cùng event không tạo 3 row; lần hỏi lại increment count, không tạo 2 notes đồng nhất.

**US-04 Daily review:** đến 08:00 giờ Việt Nam bot gửi số từ đến hạn; bấm nút xem flashcard hoặc trả lời ngay; tính next due.

**US-05 Personal data:** người dùng có thể liệt kê/sửa/xóa/export từ; không log nội dung hội thoại/audio; có thể tắt nhắc ôn, đặt số câu/ngày.

## Không làm trong MVP
- Không nhận giọng nói trực tiếp từ app Gemini chính thức (không có API đọc chat đó theo thời gian thực).
- Không tự động đồng bộ Google Keep; không cần Anki hoặc n8n.
- Không đa user/public onboarding; không video, OCR, speech scoring nâng cao, thanh toán hoặc push mobile PWA ngoài Telegram.
- Không tự động bật billing hay vượt quota.

## KPI và quality gates
- Trợ lý trả lời tự nhiên, giao tiếp độ trễ thấp phù hợp realtime; đo p50/p95 thay vì đặt một con số cứng khi chưa đo.
- Tỷ lệ ghi trùng = 0 trong test retry; 0 secret trong frontend/build/log; 100% endpoint private xác thực; số nhiệm vụ không được đánh dấu DONE nếu test chưa chạy.
- Đánh giá detector bằng tối thiểu 30 câu (10 hỏi trực tiếp, 10 gián tiếp, 10 không nên lưu); ghi false-positive/false-negative.

## Quy ước UX
- Màu và theme gọn, tương phản tốt; trạng thái `listening / thinking / speaking / reconnecting / error / idle` rõ ràng.
- Người dùng biết microphone đang bật; Stop là hành động thực; không tự gửi audio khi chưa có quyền.
- Từ mới chỉ có badge mini, không che cuộc trò chuyện; có màn hình sửa nghĩa sai.
