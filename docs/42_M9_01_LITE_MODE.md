# M9-01 — Chế độ hội thoại nhẹ (turn-based)

**Trạng thái:** IN_PROGRESS — local implementation + gates hoàn tất; chờ xác nhận deploy Worker/Pages và QA thiết bị thật  
**Task ID:** M9-01  
**Branch:** `feat/M9-01-lite-mode` (tạo từ `837d425`)  
**Ngày mở:** 2026-10-19 (UTC+7)

## Mục tiêu

Mở đường cho 1k user/day với chi phí 0đ: thêm chế độ hội thoại turn-based ("Chế độ nhẹ") bên cạnh Gemini Live — STT/TTS chạy trên thiết bị (Web Speech API), câu trả lời lấy từ text LLM free tier qua Worker route mới. Không thêm dịch vụ ngoài (user directive: "không cần cài đặt thêm gì nặng").

## Bối cảnh

- Gemini Live đắt/quota thấp, không kham nổi 1k phiên/ngày ở Free tier; text LLM (flash-lite) rẻ và free tier hào phóng hơn.
- Chi phí backend chính là rows written D1 (~13–20 rows/mutation, baseline docs/28); chế độ nhẹ không ghi D1 nên không làm tăng write.
- Auth Telegram hiện có tái sử dụng nguyên trạng; multi-user + daily caps là M9-02/M9-03, không nằm trong task này.

## Phạm vi

1. Shared: `chatTurnHistoryItemSchema` (role learner/tutor, text 1–300), `chatTurnRequestSchema` (message 1–500, history max 6, strict), `chatTurnResponseSchema` (reply 1–1200) trong `packages/shared/src/contracts/api.ts`.
2. Worker: adapter `generateTutorReply` (`apps/worker/src/adapters/gemini-tutor.ts`) gọi `generateContent` với `GEMINI_TRANSLATION_MODEL` (mặc định `gemini-3.5-flash-lite`), `maxOutputTokens 320`, temperature 0.6, timeout provider 10s, system instruction cố định vai trò gia sư; route `POST /api/v1/chat-turn` trong `entry.ts` (validate → rate limit 10 lượt/phút/user/isolate → envelope 200 `cache-control: no-store`); map lỗi 429→`RATE_LIMITED`, timeout→`TIMEOUT` 504, còn lại→`UPSTREAM_ERROR` 502 sanitize; không ghi D1/Sheet, không log nội dung.
3. Web: `apps/web/src/features/lite/services/lite-speech.ts` (STT/TTS on-device, structural typing, injectable cho tests); panel `LiteConversationPanel` (log tối đa 20 lượt, gửi kèm tối đa 6 lượt history, mic toggle, TTS toggle mặc định on, retry lượt lỗi không nhân đôi history, fallback nhập chữ khi thiết bị không hỗ trợ Web Speech); toggle "Gemini Live / Chế độ nhẹ" trong tab Voice ghi nhớ qua localStorage `voice-chat.voice-mode`; privacy copy trong Info dialog.
4. Tests: worker adapter + route; panel component; App integration (toggle, persist, round-trip qua `chatTurn`, không mint live token); client `chatTurn` (payload/history, lỗi 429). Cập nhật `api-diagnostics.ts` allowlist route mới.

## Tiêu chí nghiệm thu

- Toggle chế độ trong tab Voice hoạt động, ghi nhớ lựa chọn; mặc định vẫn là Gemini Live; chọn lite khi chưa từng dùng không phát sinh request nào ngoài lượt người dùng gửi.
- Panel lite: gõ chữ hoặc mic đều tạo đúng một lượt learner + một lượt tutor; history gửi lên đúng 6 lượt gần nhất, đã cắt 300 ký tự; lượt lỗi có retry không nhân đôi lượt learner; TTS đọc reply khi bật; thiết bị không hỗ trợ mic hiển thị fallback nhập chữ.
- Worker route: auth bắt buộc; input/history/output đúng bound; vượt rate limit → 429 `RATE_LIMITED`; timeout → 504; lỗi provider sanitize; `cache-control: no-store`; không có ghi D1/Sheet.
- Regression tests, typecheck/lint/full suite/build/secret scan/Prettier/diff check pass; QA thiết bị thật (Web Speech trên Android/Desktop, fallback iOS) do người dùng thực hiện sau deploy.

## Ràng buộc và quyết định

- Không thêm dependency/hạ tầng mới: dùng Web Speech API có sẵn trong WebView + key Gemini hiện có; D1/GAS không đổi.
- Dùng lại `GEMINI_TRANSLATION_MODEL` thay vì thêm biến môi trường mới (cùng lớp model flash-lite, ít cấu hình hơn).
- History do client giữ trong bộ nhớ trang, không lưu server; Worker chỉ nhận tối đa 6 lượt/300 ký tự để giới hạn chi phí token và rủi ro prompt injection.
- Rate limit 10 lượt/phút/user tính theo isolate (giống translate 12/phút) — chấp nhận sai số giữa các isolate ở MVP; M9-03 sẽ làm caps theo ngày.
- Panel lite chỉ mount khi người dùng chọn chế độ nhẹ: tránh tải chunk sớm (đã từng làm vỡ probe JSDOM `production-web-build.test.ts` do Suspense render chunk ngay khi ẩn) và đảm bảo mic/TTS được cleanup khi đổi về Live.

## Kết quả local

- Worker: `npx vitest run apps/worker/src/adapters/gemini-tutor.test.ts apps/worker/src/entry.test.ts --testTimeout=20000` → 16/16 PASS (4 test adapter mới: mapping 429/timeout/rỗng; 3 test route mới: auth+validate+rate limit/no-store).
- Web: `npx vitest run tests/production-web-build.test.ts apps/web/src/app/lite-mode.test.tsx apps/web/src/features/lite/components/LiteConversationPanel.test.tsx` → 13/13 PASS; `learning-api-client.test.ts` 29/29 (2 test `chatTurn` mới: payload/history + lỗi 429 không retry).
- Full suite `npx vitest run --maxWorkers=1 --minWorkers=1 --testTimeout=20000 --silent`: **255/255 tests, 42 files PASS** (tăng 15 test so với 240/240 của M8-10).
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:secrets`, Prettier check/--write trên file thay đổi và `git diff --check` PASS.
- Fix trong quá trình làm: probe `tests/production-web-build.test.ts` phát hiện lite panel bị render eage dưới `hidden` + `Suspense` gây dynamic import chunk khi startup (JSDOM không load được) làm hỏng cây React; đã chuyển sang chỉ mount panel khi `voiceMode === 'lite'` và pass lại.

## Chưa làm / rủi ro

- Chưa deploy Worker/Pages; chưa QA Web Speech thật trên Android/Desktop/iOS (do người dùng thực hiện sau deploy).
- Quota free tier flash-lite chưa đo; chưa có số đo rows written impact (chế độ nhẹ không ghi D1 nên dự kiến trung tính).
- Web Speech API trên iOS Safari/WebView hạn chế — fallback nhập chữ là đường chính, cần xác nhận trải nghiệm thật.
