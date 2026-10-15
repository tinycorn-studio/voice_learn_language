# M8-06 — Feedback và lỗi theo ngữ cảnh

## Mục tiêu

Giảm cảnh báo chiếm diện tích hoặc lặp lại trên Mini App; đặt lỗi cần xử lý cạnh đúng nội dung và giữ thao tác thử lại.

## Hành vi đã triển khai

| Tình huống | Cách hiển thị |
| --- | --- |
| Chưa xác định được từ cần lưu | Toast cảnh báo nhẹ, đọc bằng `role="status"`/`aria-live="polite"`, tự đóng sau 5 giây, tạm dừng khi được focus/hover và có nút đóng. Nội dung hướng dẫn nói lại bằng tên từ cụ thể. |
| Capture/lưu từ thất bại | Hàng chờ ở App là trạng thái chính nếu đã có event; bỏ bản thông báo lặp trong Voice panel. Hàng pending/failed giữ lỗi và có thể retry. Failure trước khi tạo hàng chờ được báo bằng toast có cooldown theo từ. Nếu hàng chờ đầy, giữ event đã xác thực và lỗi cùng nút thử xếp hàng lại. |
| Auth thất bại | Giữ banner toàn cục và nút thử kết nối lại vì toàn app cần xác thực. |
| Tải Vocabulary/Review thất bại | Hiển thị cạnh tab liên quan và có nút tải lại. Lỗi của một nguồn không ngăn cập nhật dữ liệu của nguồn còn lại; dữ liệu cũ vẫn hiện nếu refresh lỗi sau lần tải thành công. |
| Sao chép log | Thành công hiện toast. Nếu trình duyệt chặn clipboard, giữ hướng dẫn sao chép thủ công trong panel diagnostics. Kết quả kiểm tra kết nối tiếp tục nằm cạnh công cụ chẩn đoán. |
| Tải preview lịch ôn thất bại | Lỗi nằm trong khu vực rating, có nút thử tải lại; các nút đánh giá vẫn khóa đến khi preview hợp lệ. |
| Sửa/xóa từ thất bại | Gắn lỗi với đúng hàng từ, có nút thử lại; sửa tiếp tục giữ form và payload/event id của thao tác cho đến khi người dùng thay nội dung. |

## Phạm vi kỹ thuật

- Chỉ thay đổi `apps/web` và tài liệu tiến độ.
- Không thêm API, không đổi quota, Worker, D1, Apps Script hoặc schema.
- Toast dùng chung stack tối đa ba thông báo, không chuyển focus, timeout được tạm dừng khi người dùng tương tác.
- Hàng chờ tiếp tục là nguồn trạng thái bền trong phiên cho event đã xác thực; retry giữ nguyên `event_id`.

## Acceptance criteria

1. Kết quả không nhận diện từ dùng toast lịch sự; lỗi capture không bị báo lặp nếu hàng chờ đã có trạng thái.
2. Auth error, lỗi tải theo tab, và lỗi hàng chờ có phạm vi riêng cùng thao tác retry phù hợp.
3. Hàng pending và failed đều retry được; event bị chặn do queue đầy vẫn được giữ cùng hướng xử lý.
4. Copy log thành công dùng toast, fallback thất bại còn hiển thị trong diagnostics.
5. Review preview có nút retry và không cho chấm khi preview chưa thành công.
6. Lỗi cập nhật/xóa Vocabulary hiển thị cạnh hàng tương ứng và retry được.
7. Regression tests/full test suite, typecheck, lint, build, secret scan và `git diff --check` pass. Production Pages deploy chỉ thực hiện khi người dùng yêu cầu; yêu cầu deploy đã được đưa ra.

## Evidence release — 2026-10-16 06:44 +07:00

- `npm test` theo concurrency mặc định: PASS, 213/213 tests trong 35 files. Test bundle lazy chunks có timeout 20 giây vì full suite chạy song song có thể mất hơn timeout mặc định 5 giây; chạy độc lập đạt.
- `npm run typecheck`: PASS cho toàn bộ workspace.
- `npm run lint`: PASS cho toàn bộ workspace.
- `VITE_APP_VERSION=M8-06-20261016 npm run build`: PASS cho toàn bộ workspace; Vite production build tạo entry `index-RoGF14pX.js`, CSS `index-V_IwAoZy.css`, lazy Vocabulary `VocabularyManagerPanel-CoZ2NDSt.js`, lazy Review `FlashcardReviewPanel-CkDJ7XEq.js`. Build chạy ngoài sandbox do Windows chặn process con (`spawn EPERM`).
- SHA256 entry `9DBA438DB7F58B7AA4D571AC92E7FE1BC4BCC9B934996BF01450FED7CBA53E5E`; CSS `6BD9ACE4549B3123BFCDA055000D8FC353ADD313441FA94714AE7F3B1614DED7`; Vocabulary chunk `C92BA87C8E99AAE54F96977099DD46B7E255FFBAF4C518C1539919199AFABEBB`; Review chunk `9CB8DDFABFC90D3E1DAED7CAECB782E2966EC637E1590C99BD273FFF1D7C590B`.
- `scripts/Check-Secrets.ps1`: PASS, không thấy file cấm hoặc secret pattern trong tracked files.
- `git diff --check`: PASS.
- Wrangler 4.149.0 xác nhận Pages project `voice-chat-learn-language`; deployment `802f523e-0af0-4918-b2af-6666b0c811c2` ở Environment `Production`, branch `production`, source commit `fa9af38d76c5391229ab8f0eec88436b243a91c7`.
- URL chính [voice-chat-learn-language.pages.dev](https://voice-chat-learn-language.pages.dev/?v=M8-06-20261016) và [unique deployment URL](https://802f523e.voice-chat-learn-language.pages.dev/) trả HTTP 200. HTML có tham chiếu build M8-06; entry JS, CSS và hai lazy chunks trả HTTP 200, SHA256 từng asset khớp build local.
- Chỉ deploy frontend tĩnh từ `apps/web/dist`; Worker, D1 và Apps Script không đổi. Rollback Pages về M8-05 deployment `6fb2db7f-5479-471d-be4d-efd75d483af6`.
- Chờ người dùng kiểm tra UI thật trong Telegram trên PC/mobile; chưa có bằng chứng QA thiết bị từ task này.

## Cơ sở UX

- WCAG 2.2 SC 4.1.3 yêu cầu status message được nhận biết bằng công nghệ hỗ trợ mà không phải chuyển focus: [Status Messages](https://www.w3.org/WAI/WCAG22/Understanding/status-messages.html).
- WAI-ARIA APG khuyến nghị dùng alert cho thông điệp quan trọng, giới hạn tự đóng để người dùng có thời gian đọc: [Alert Pattern](https://www.w3.org/WAI/ARIA/apg/patterns/alert/).
- Material Snackbar dành cho cập nhật ngắn không cần ngắt luồng thao tác: [Material 3 Snackbar](https://m3.material.io/components/snackbar/overview).
- Apple HIG khuyến nghị đặt feedback gần nội dung liên quan và dành alert cho thông tin quan trọng: [Feedback](https://developer.apple.com/design/human-interface-guidelines/feedback).
