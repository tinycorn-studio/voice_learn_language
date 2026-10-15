# M8-05 — Theme toggle, voice continuity và tiện ích Mini App

## Mục tiêu

Hoàn thiện bốn điểm UX đã được người dùng duyệt từ mockup: đổi theme thủ công, giữ cuộc trò chuyện Voice khi đổi tab, báo lưu từ mới bằng toast, và chuyển hướng dẫn/quyền riêng tư vào popup Info.

## Phạm vi và hành vi

- Theme mặc định theo `Telegram.WebApp.colorScheme`; khi SDK không có thì theo `prefers-color-scheme`. Nút ở header đổi sáng/tối và lưu lựa chọn cục bộ. Có thao tác quay lại chế độ tự động. Theme đồng bộ với `meta[name="theme-color"]`.
- `VoiceSessionPanel` luôn được giữ mounted sau khi khởi tạo. Đổi sang tab khác chỉ ẩn panel, không gọi `stop()`. Khi phiên khác `idle`, hiện nút trạng thái để quay lại Voice. Nút Dừng micro vẫn kết thúc phiên.
- Các entry `saved` tạo toast thông báo có timeout và nút đóng. Entry `pending`/`failed` tiếp tục hiện với lỗi/trạng thái, và pending còn hành động retry.
- Nút Info trên header mở modal dialog accessible với nội dung hướng dẫn đã chuyển khỏi trang chính. Đóng bằng nút, Escape hoặc click backdrop; focus được đưa vào dialog, giữ trong dialog bằng Tab và trả lại nút Info khi đóng.

## Không thuộc phạm vi

- Không đổi Worker, API, D1, Apps Script, quyền microphone hay quy tắc lưu dữ liệu.
- Không triển khai Pages production trong task local này.

## Acceptance criteria

1. Theme theo Telegram/OS ở chế độ tự động; chế độ người dùng chọn được lưu, áp dụng sau reload và có thể reset về tự động.
2. Chuyển qua lại Voice/Ôn tập/Từ vựng không gọi cleanup/stop cho voice; nút dừng chủ động vẫn hoạt động và có lối quay lại Voice.
3. Từ lưu thành công tạo toast có thể đóng và tự ẩn; pending/failed tiếp tục có trạng thái và thao tác retry phù hợp.
4. Hướng dẫn không còn chiếm chỗ trong trang chính; nút Info mở dialog dùng được bằng bàn phím.
5. Regression tests cho theme, đổi tab/giữ mount, toast và dialog; typecheck, lint, full test suite, build, secret scan và `git diff --check` pass.
6. `PROGRESS.md` và `CHANGELOG.md` ghi evidence local và nêu rõ production chưa deploy.

## Tài liệu API tham khảo

Telegram Mini Apps cung cấp `colorScheme` và theme events realtime; implementation tiếp tục dùng SDK đã có trong app, không thêm dependency hoặc API backend. Nguồn: [Telegram Mini Apps — Color Schemes](https://core.telegram.org/bots/webapps#color-schemes).

## Evidence local

- `npm test -- --silent --reporter=dot --testTimeout=20000`: 213/213 tests, 35 files PASS.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:secrets` và `git diff --check`: PASS.
- Web production bundle được Vite tạo thành công. Các regression kiểm theme persist/reset, Info dialog/keyboard, toast lifecycle, và giữ voice session khi qua tab.
- Thay đổi nằm trên branch `feat/M8-05-miniapp-controls`. Pages production chưa deploy; Telegram device QA bắt đầu sau khi có yêu cầu phát hành riêng.
