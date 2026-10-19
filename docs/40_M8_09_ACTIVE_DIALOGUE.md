# M8-09 — Hội thoại chủ động, roleplay và tổng kết phiên

**Trạng thái:** DEPLOYED_WAITING_USER_QA — Pages Production đã phát hành; chưa live QA
**Task ID:** M8-09
**Branch:** `feat/M8-09-active-dialogue`
**Ngày mở:** 2026-10-16 (UTC+7)

## Mục tiêu

Đưa bốn hoạt động học chủ động vào tab Voice Tutor theo mockup Hội thoại, đồng thời giữ nguyên ba tab đáy `Voice Tutor`, `Flashcards SRS`, `Vocabulary`, các nút hỗ trợ ở header và controls hội thoại hiện có.

## Phạm vi

1. **Active SRS Dialogue:** chỉ khi người dùng yêu cầu, tải thẻ đến hạn bằng API review hiện có. Người học chọn tối đa ba mục; từ và nghĩa ngắn được đưa vào system instruction của phiên Gemini để gợi câu hỏi/tình huống sử dụng. Không submit review, không sửa lịch, không tính công thức FSRS ở frontend.
2. **Gentle Coaching & Shadowing:** Gemini có thể phát `coach_correction` bất đồng bộ cùng hội thoại. Client chỉ nhận event nếu payload đúng schema, trích đoạn trùng lượt nói gần nhất, câu gợi ý có nội dung và cụm focus nằm trong câu gợi ý. UI giữ transcript gốc, thêm câu đề xuất với cụm focus nổi bật và nút nhại lại. Prompt cho phép một nhận xét phát âm ngắn khi âm thanh cho thấy lỗi rõ; không chấm điểm accent hay khẳng định chẩn đoán phát âm chính xác.
3. **Roleplay:** có bốn lựa chọn cố định: phỏng vấn việc làm, phản ánh dịch vụ khách sạn, trả giá khi mua đồ và thuyết trình ngắn. Người dùng có thể quay lại hội thoại tự do.
4. **Session Insights:** khi nhấn Stop, tổng hợp trên thiết bị thời lượng nói ước tính từ các frame micro vượt ngưỡng RMS, độ đa dạng transcript người học (từ duy nhất/tổng từ), các nhóm correction và cụm diễn đạt Gemini đã gợi ý. Báo cáo chỉ tồn tại trong state của trang; không gửi transcript, âm thanh, correction hay báo cáo tới Worker/D1.

## Tiêu chí nghiệm thu

- Tải thẻ đến hạn chỉ xảy ra khi bật phần luyện từ; lỗi tải có thể thử lại; không có thẻ due thì UI nói rõ; không chọn quá ba từ.
- Prompt phiên dùng scenario cố định và dữ liệu từ vựng đã giới hạn/JSON-quote như dữ liệu, không xem nội dung từ vựng là chỉ dẫn. Nội dung context không xuất hiện thành lượt hội thoại giả.
- `coach_correction` dùng `NON_BLOCKING`/`SILENT`, không trì hoãn audio hoặc `save_vocabulary`; payload không hợp lệ/không khớp câu vừa nói bị bỏ qua. Câu gốc và nút Dịch đang có vẫn hoạt động.
- Nút nhại lại đánh dấu cụm mục tiêu trong giao diện và cho biết người học cần đọc qua micro; không tự lưu âm thanh hoặc gửi thêm request.
- Report chỉ xuất hiện sau Stop, dùng dữ liệu phiên hiện tại; thời lượng được gắn nhãn ước tính, trường hợp không có dữ liệu thì hiển thị trạng thái rỗng thay vì số bịa.
- Ba tab đáy và các nút hỗ trợ giữ nguyên thứ tự, nhãn, hành vi và vị trí hiện tại.
- Regression tests cho context, validator, correction UI, chọn due words, speech activity/RMS, tính report và giữ nguyên điều hướng; workspace `typecheck`, `lint`, `test`, `build`, secret scan, format và `git diff --check` pass.
- Cập nhật `PROGRESS.md` và `CHANGELOG.md` trong cùng thay đổi. Deploy Pages khi người dùng yêu cầu; Gemini Live production/device QA cần nghiệm thu riêng.

## Ràng buộc và quyết định

- Dùng `GET /api/v1/reviews/due` hiện có; không thay API, schema, D1 repository hay mirror.
- Lịch FSRS authoritative tiếp tục nằm ở backend `ts-fsrs`; tính năng này chỉ đọc due cards để tạo ngữ cảnh nói.
- Không ghi transcript, PCM, correction, phrase report hoặc nội dung roleplay vào log/analytics/storage.
- Số đo voice activity dựa trên ngưỡng năng lượng micro và chỉ là ước tính. Transcript lexical diversity không phải điểm fluency chuẩn hóa.
- Giữ các thay đổi dirty M8-08 đã deploy và `apps/web/src/app/app-controls.test.tsx` có sẵn trước task; không reset/stash/ghi đè chúng.

## API/quota tham khảo trước khi code

Đã kiểm tra tài liệu Google AI chính thức ngày 2026-10-16. Gemini 3.8 Live hỗ trợ system instructions và asynchronous function calling; Live client phải tự gửi tool response. D1/API hiện tại đủ cho đọc thẻ due nên không cần route hoặc tài nguyên mới.

- [Gemini 3.8 Live model](https://ai.google.dev/gemini-api/docs/models/gemini-3.8-live)
- [Live API tool use](https://ai.google.dev/gemini-api/docs/live-api/tools)
- [Live API capabilities](https://ai.google.dev/gemini-api/docs/live-api/capabilities)

## Kết quả local

- `npm test -- --maxWorkers=1 --minWorkers=1 --testTimeout=20000 --silent`: 238/238 tests, 39 files PASS; Miniflare tests được chạy với loopback sau khi sandbox mặc định trả `EACCES`.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:secrets`, Prettier check và `git diff --check` PASS.
- UI regression xác nhận ba tab đáy (`Voice Tutor`, `Flashcards SRS`, `Vocabulary`) cùng theme/Info controls còn nguyên; due fetch chỉ chạy sau khi mở Active SRS.
- Deploy Pages Production build `M8-09-20261016`, deployment `5056740a-b910-489c-a55f-877ca26ee871`, branch `production`, source HEAD `2a259f7` + dirty working tree. Canonical `https://voice-chat-learn-language.pages.dev/?v=M8-09-20261016` và unique `https://5056740a.voice-chat-learn-language.pages.dev` HTTP 200; entry JS, CSS và hai lazy chunks có SHA256 khớp local build. Rollback M8-08: `26981e35-c6b2-44bf-8553-a8e465ea8543`. Worker/D1/GAS unchanged.
- Chưa thử tool correction với Gemini Live thật hoặc đo RMS trên Telegram/mobile. Thời lượng nói hiển thị là ước tính theo fixed RMS threshold; cần QA thực tế và hiệu chỉnh nếu noise/micro làm lệch.
