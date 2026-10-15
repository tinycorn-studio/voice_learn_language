# M8-04 — Visual system cho Mini App

## Mục tiêu

Đưa demo hướng hợp nhất vào Mini App: giữ nền tảng xanh navy gọn, tăng khoảng thở, làm icon và trạng thái dễ quét, thể hiện ý nghĩa nút bằng màu/viền rõ. Đây là refresh presentation; không đổi business logic, API hay dữ liệu.

## Nền tảng tham khảo

- Material Design 3: dùng vai trò màu semantic, bề mặt và thang typography nhất quán; áp dụng linh hoạt theo nhận diện VoiceChat, không sao chép nguyên giao diện Android.
- WCAG 2.2 AA: chữ thường đạt tương phản 4.5:1; focus nhìn thấy; vùng bấm không thấp hơn tiêu chí Target Size (Minimum), đồng thời ưu tiên vùng chạm lớn hơn cho điện thoại.
- Telegram Mini Apps: theo `colorScheme`/`themeChanged`, mobile-first, giữ safe area và giao diện gọn; khi SDK không có thì dùng `prefers-color-scheme`.

Nguồn chính thức: [Material Design 3 foundations](https://m3.material.io/foundations/), [M3 color roles](https://m3.material.io/styles/color/the-color-system), [WCAG 2.2](https://www.w3.org/TR/WCAG/), [Telegram Mini Apps](https://core.telegram.org/bots/webapps).

## Quy tắc thiết kế

- Tập trung tokens màu cho nền, surface, text, muted, outline, primary, danger, warning, success và info; có cặp light/dark.
- Ưu tiên Telegram theme hiện tại; theo system preference ở browser ngoài Telegram. Cập nhật theme khi Telegram phát `themeChanged`.
- Ba tab Voice, Ôn tập, Từ vựng đặt ở cuối nội dung với icon rõ và nhãn luôn hiển thị. Không dùng màu đơn lẻ làm phương tiện duy nhất để phân biệt trạng thái.
- Các nút chính/tiện ích/lỗi/xóa/đánh giá FSRS có outline 2px theo vai trò. Again đỏ, Hard vàng hổ phách, Good xanh lá, Easy xanh dương; nhãn chữ luôn được giữ.
- Icon SVG nội tuyến, nhất quán nét 2px, 20–22px cho điều hướng và khoảng 18px cho hành động; icon trang trí có `aria-hidden`, nhãn thao tác vẫn bằng chữ.
- Vùng chạm thao tác chính từ 44px trở lên; focus-visible nổi rõ; giữ layout cuộn dọc trên màn hẹp và tôn trọng safe-area đáy.

## Phạm vi

`apps/web/src/styles.css`, App navigation/theme, icon dùng trong voice/review/vocabulary, cùng component tests cần thiết. Không thêm dependency icon, không đổi API/Worker/Sheet/D1. Việc triển khai Pages được ghi ở phần rollout bên dưới theo yêu cầu riêng sau khi hoàn thành local.

## Tiêu chí hoàn thành

1. Light/dark tokens có thể dùng ở tất cả ba tab; cập nhật theo Telegram theme hoặc OS fallback.
2. Tab, microphone, send, translate, transcript latest, reveal/rating, export, edit/delete/save có icon nhìn rõ và viền semantic.
3. Nhãn chữ, trạng thái loading/disabled và focus keyboard vẫn dễ hiểu; responsive ở chiều rộng điện thoại.
4. Regression tests phù hợp, `typecheck`, `lint`, `test`, `build`, secret scan và `git diff --check` pass.
5. `PROGRESS.md` và `CHANGELOG.md` ghi đúng evidence, giới hạn và bước tiếp theo; trạng thái local và production được phân biệt rõ.

## Production rollout — 2026-10-15 19:23 +07:00

Người dùng yêu cầu deploy sau khi M8-04 hoàn tất local. Chỉ triển khai static frontend lên Pages project `voice-chat-learn-language`, production branch `production`; không thay Worker, D1 hoặc Apps Script.

- Production: [Mini App](https://voice-chat-learn-language.pages.dev/?v=M8-04-20261015). Deployment: [1cbde724-f582-4111-97a3-a64a43fe191b](https://1cbde724.voice-chat-learn-language.pages.dev/). Source `49ff593aa6e25a7241b845ca07bdc10f3c468414`, build tag `M8-04-20261015`.
- Trước upload, `typecheck`, `lint`, full suite (206/206 tests, 32/32 files, `--testTimeout=20000`), production build, secret scan (0 secret patterns / 0 forbidden tracked files) và `git diff --check` đều pass. Build dùng `VITE_API_BASE_URL=https://voice-chat-learn-language-worker.voice-chat-learn-language.workers.dev` và `VITE_APP_VERSION=M8-04-20261015`.
- Smoke sau deploy: production URL và deployment URL đều HTTP 200; entry JS `index-DGDO56WH.js`, CSS `index-8QlYSybz.css`, lazy chunk `VocabularyManagerPanel-Pk3pP5CZ.js` và `FlashcardReviewPanel-B-2B-J17.js` đều HTTP 200. Hash JS/CSS công khai khớp artifact local:
  - JS: `032B49A2C6FC915D771226FC6EAAF22C8D1FDAAC07D8A32D8712EEC372622567`.
  - CSS: `F763DBB9535DF43C3E75042C50C13E84D823D83C3A26F30D1726D29760907269`.
- Rollback point ngay trước lần deploy này là Pages deployment `59ebfc76-8227-4e6f-9340-c942266ec6e1` (M8-03). Chưa thực hiện rollback.
- Còn chờ người dùng đóng/mở lại Mini App trong Telegram và kiểm tra theme, icons/nút cùng các tab. Smoke HTTP không thay thế kiểm tra trực tiếp Telegram hoặc accessibility audit đầy đủ trên thiết bị.
