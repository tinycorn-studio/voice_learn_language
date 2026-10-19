# M8-08 — An toàn và không chặn hội thoại khi lưu code-switching

## Mục tiêu

Hoàn thiện ba phần code-switching (Tasks 2.1–2.3): nhận từ/cụm tiếng Việt được chêm vào câu tiếng Anh mà tránh ghi nhầm tên riêng/từ ngoại ngữ có dấu; không gộp nhiều mục tiêu vào một thẻ; để Gemini tiếp tục trả lời khi thao tác lưu D1 chạy nền.

## Phạm vi

- Không thêm API route, schema, bảng D1, dịch vụ/chi phí hoặc dependency NLP mới.
- Giữ nguyên các thay đổi code-switching đang có ở working tree; sửa trong cùng phạm vi và ghi rõ baseline.
- Tách rõ phát hiện chắc chắn, không phát hiện và trường hợp nhiều mục tiêu/mơ hồ; mơ hồ không được tự ghi vào D1.
- Khai báo function `save_vocabulary` theo Live API `NON_BLOCKING`; phản hồi tool dùng `SILENT` để không ngắt câu trả lời đang phát. Lưu vẫn phải chờ API thành công trước khi báo `saved`.
- Không tuyên bố có thể xác minh hoàn toàn bản dịch Anh–Việt bằng luật cục bộ. Boundary validation phải ràng buộc user source, candidate tiếng Việt, dạng dữ liệu và ví dụ; giới hạn semantic còn lại cần ghi rõ.

## Tiêu chí nghiệm thu

1. Các trường hợp dương hiện có (`cái kéo`, `oi bức`, `bực bội`) vẫn nhận đúng target.
2. Các từ ngoại ngữ có dấu và tên riêng kiểm thử (`café`, `résumé`, `São Paulo`, `Hà Nội`) không bị auto-save nếu không có ngữ cảnh code-switching chắc chắn.
3. Nhiều cụm tiếng Việt tách bởi từ nối tiếng Anh/Việt không bị gộp; detector yêu cầu làm rõ hoặc từ chối lưu tự động.
4. Từ đệm/từ cảm thán tiếp tục bị loại. ASR thiếu dấu, candidate một từ ngoài danh sách tin cậy, hoặc tên riêng viết hoa không được ghi nhầm; đây là detector heuristic bảo thủ, không bao phủ toàn bộ từ điển tiếng Việt.
5. Tool call phải khớp source excerpt/candidate, meaning phải chứa candidate theo ranh giới cụm, và output có dạng target hợp lệ. Regression ghi rõ semantic translation vẫn là output AI, không có từ điển xác minh đầy đủ.
6. Regression chứng minh function declaration là `NON_BLOCKING`, response là `SILENT`, audio response được xử lý trước khi persistence hoàn tất, và UI chỉ báo `saved` sau thành công backend.
7. `typecheck`, `lint`, full `test`, `build`, secret scan và `git diff --check` pass. Pages chỉ deploy sau yêu cầu riêng của người dùng; Gemini Live thật/D1/Telegram là QA riêng.

## Tài liệu API đã kiểm tra

Ngày 2026-10-16, tài liệu chính thức xác nhận model dự án `gemini-3.8-live` hỗ trợ function calling bất đồng bộ; function declaration `NON_BLOCKING` và response scheduling `SILENT` cho phép generation tiếp tục mà không bị ngắt. `gemini-3.1-flash-live-preview` chưa hỗ trợ async nên không được dùng để suy ra nghiệm thu. Không phát sinh thêm request AI hoặc thay đổi API key/quota.

- [Live API — Tool use](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Live API — Capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)
- [Gemini 3.8 Live model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)
- [Live API — Best practices](https://ai.google.dev/gemini-api/docs/live-api/best-practices)

## Bằng chứng và trạng thái

DEPLOYED / WAITING_LIVE_QA. Bảo toàn các file source/test dirty đã tồn tại; detector dùng allowlist + đặc điểm dấu tiếng Việt, tách các candidate thành nhóm, bỏ qua từ ngoại ngữ/tên riêng trong regression và trả clarification khi có nhiều nhóm. Validator khớp transcript, candidate theo ranh giới từ, ép target tiếng Anh ASCII và ví dụ chứa target. Gemini tool `NON_BLOCKING`, function response `SILENT`; test fake WebSocket xác nhận audio frame được xử lý và UI vẫn pending trong khi API save chưa trả, rồi mới chuyển `saved` sau thành công.

Verification: targeted tests 36/36; full suite 225/225 tests in 36 files; workspace typecheck, lint, production build, secret scan, `git diff --check` and Prettier check on changed source/spec files pass. Lần chạy full suite đầu trong sandbox không mở được loopback Miniflare (`connect EACCES 127.0.0.1`); chạy lại với quyền loopback được duyệt và toàn bộ suite pass. Production Pages build `M8-08-20261016`, deployment `26981e35-c6b2-44bf-8553-a8e465ea8543` on branch `production`, source HEAD `2a259f7` + dirty working tree; rollback deployment `9b291d2c-f798-4cc1-8ebb-df071e392a8d`. Canonical URL `https://voice-chat-learn-language.pages.dev` and unique deployment URL `https://26981e35.voice-chat-learn-language.pages.dev` both returned HTTP 200. Entry JS `index-O-t1fPnX.js` SHA256 `D0854E8E928320C03853508BC254B46CF9D86609CA88846228FF2EA48191E069`; CSS `index-DtsbfbpB.css` SHA256 `85AFDA768B2B256AA559D93C4C4F1EF9BA2F3CB6092B5CF754F79A16726F2E8E`; lazy Vocabulary `VocabularyManagerPanel-DHDlldf1.js` SHA256 `4E78A73C1A83B5C6D49AF48A3CD97DCB46118A0E1E542747253455AB6B091CD7`; lazy Review `FlashcardReviewPanel-B-odu5EF.js` SHA256 `DA95DB282F245703F388BFD61802B55DCA498CF8732A9C5A1F3F023C7B85724F`; all four public assets match local artifacts on both URLs. Worker/D1/GAS unchanged. Fake WebSocket does not replace QA on Gemini Live itself; semantic Anh–Việt remains model-generated and is not proven by local validator.

Next: user QA trên Telegram Mini App với một từ đơn, một cụm rõ, một câu có nhiều candidate, và từ café/tên riêng; xác nhận giọng tutor phát tiếp trong khi D1 pending và chỉ báo đã lưu sau ACK. Ghi kết quả để hoàn tất live acceptance.
