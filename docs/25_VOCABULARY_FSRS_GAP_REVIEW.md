# M5-11 — Review hỏi nghĩa → lưu từ → ôn FSRS

Ngày 13/10/2026, source main `8a6bc44`; branch review `fix/M5-11-vocabulary-flow-review`. Người dùng mô tả hỏi tên từ kèm "that mean", Gemini giải thích nhưng không thấy từ được lưu để ôn. Đây là review; không sửa feature, deploy, chạy setup/migration hay ghi dữ liệu Sheet thật.

## Kết luận

Cơ chế đã có nhưng chưa bảo đảm hoàn thành luồng tự lưu trong hội thoại thật. Có các đường bỏ sót trước khi gọi API lưu, và frontend production chưa chứa giao diện/API FSRS mới đã merge trong Git. Chưa có trace của đúng lượt người dùng bị mất từ nên không gán một lỗi duy nhất cho lượt đó.

Luồng đang có trong source:

`Gemini toolCall.save_vocabulary → validate transcript/intent/target → onSaveVocabulary → queue → POST vocabulary → Worker HMAC → GAS upsert Words/Events → Cards mặc định (nếu tab tồn tại) → FSRS backend preview/submit → Reviews append-only`.

FSRS sử dụng thư viện `ts-fsrs` ở backend, không tính lại công thức trên frontend. Một từ mới tạo một Card mặc định `c_<word_id>`; khi người dùng chấm Again/Hard/Good/Easy, backend tính lịch và lưu lịch sử. Chưa có giao diện tạo/quản lý nhiều loại Card hoặc tự sinh bộ câu hỏi AI riêng cho mỗi từ.

## Các phát hiện cần xử lý

### V01 — P1: Tự lưu phụ thuộc hoàn toàn vào model gọi tool

Vị trí: `apps/web/src/features/voice/services/gemini-live-client.ts:306–338`, prompt dòng 49.

`turnComplete` chỉ flush transcript và cập nhật trạng thái. Chỉ vòng lặp `toolCall.functionCalls` mới gọi callback lưu. Detector là guard của tool, chưa phải cơ chế chạy sau mọi câu hỏi nghĩa. Probe với câu hỏi chuẩn + câu giải thích nhưng không có tool frame: **0 saves, 0 notices**; cùng câu hỏi có tool hợp lệ: **1 save**. Hội thoại trả lời tốt không chứng minh đã chạy persistence.

Hướng sửa: quy định rõ phải gọi tool khi có ý định học từ; thêm bước đối chiếu intent sau lượt đã hoàn thành và cơ chế phục hồi có giới hạn khi model bỏ sót. Không lưu từ của câu thường, không gọi AI cho từng audio chunk; một lượt chỉ có một event kể cả tool và fallback cùng xuất hiện. Báo trạng thái đang xử lý/chưa lưu cho người học.

### V02 — P1: Cách nói "X, that mean?" chưa được detector hỗ trợ

Vị trí: `packages/shared/src/utils/detector.ts:78–95`, `129–205`, `262–290`.

Các probe synthetic:

| Câu hỏi | Kết quả hiện tại |
| --- | --- |
| What does overwhelmed mean? + tool hợp lệ | Lưu 1 lần |
| Overwhelmed, that mean? | ignore / source_excerpt_lacks_explicit_intent |
| Overwhelmed, what does that mean? | clarify / missing_referent khi không có assistant referent có quote |

Cách nói người dùng mô tả thuộc nhóm có thể bị bỏ sót; ví dụ trên là synthetic, không phải transcript thật của người dùng. Hướng sửa: nhận diện câu hỏi nghĩa của người học dùng ngữ pháp chưa hoàn chỉnh, ưu tiên tên từ rõ ràng trong chính câu hỏi; vẫn hỏi lại khi chỉ có "that" và không xác định được đối tượng.

### V03 — P1: So khớp source_excerpt quá chặt, từ chối khác dấu câu

Vị trí: `packages/shared/src/utils/detector.ts:242–250`; normalize tại `packages/shared/src/utils/normalize.ts:10`.

Transcript `What does overwhelmed mean` và tool excerpt `What does overwhelmed mean?` bị coi là khác nhau: **saved:false / source_excerpt_does_not_match_user_turn**. Normalize hiện chỉ xử lý NFKC, case/space; không xử lý dấu câu. Client không gọi clarification cho lỗi này, callback lưu không chạy nên không có badge pending/failed.

Hướng sửa: gắn tool với snapshot câu hỏi thật, chuẩn hóa sai khác định dạng an toàn và dùng transcript thật làm source lưu. Tiếp tục chặn đổi mục tiêu, đoạn trích bịa và câu thường; không bỏ toàn bộ kiểm tra boundary để làm cho save "pass".

### V04 — P1: Tool tới trước transcript bị từ chối và cache kết quả thất bại

Vị trí: `gemini-live-client.ts:314–338`, validator `detector.ts:242–250`.

Probe gửi tool → transcript hoàn chỉnh → cùng tool ID: cả hai phản hồi **saved:false**, tổng **0 saves**. Lần đầu thiếu câu hỏi được coi là lỗi cuối cùng và ghi vào `toolResults`, nên transcript tới sau không kích hoạt kiểm lại. [Google Live API reference](https://ai.google.dev/api/live#BidiGenerateContentServerContent) nêu input transcription đến độc lập, không bảo đảm thứ tự với các message khác.

Hướng sửa: buffer tool chờ transcript phù hợp với timeout/budget; phân biệt "chưa đủ dữ liệu" với từ chối cuối cùng. Không cache lỗi thiếu transcript như thành công/terminal failure. Giữ event ID ổn định và không gửi saved:true trước acknowledgement lưu.

### V05 — P1: Frontend production chưa có giao diện FSRS mới trong main

Đã tải bundle công khai `/assets/index-uo6JRpSE.js`, build **M5-08-20261012** từ domain Pages đang dùng. Bundle có save_vocabulary và validator; màn ôn cũ gửi `POST /api/v1/reviews`, nhãn tĩnh `Again (10m)`. Không có `card_id`, `row_version`, `/preview`, `/api/v1/reviews/submit`, `/api/v1/reviews/stats`.

Source main `learning-api-client.ts:371–392` và `FlashcardReviewPanel.tsx` có preview/submit/stats theo Card, interval badges từ backend và version từng Card. Vì vậy merge Git/Worker hotfix chưa đưa giao diện này lên Pages. Backend vẫn có thể chạy FSRS qua route tương thích cũ; không kết luận engine FSRS đang tắt.

Hướng tiếp theo: sau khi sửa capture/validation, build và deploy frontend đồng bộ; đối chiếu bundle public và nghiệm thu hỏi nghĩa → Words/Card → preview → rating → Reviews/due đổi. Worker hiện **e07a24e2**, deployment **63ab0051**, 100% (read-only verified).

### V06 — P2: Setup Apps Script public còn cấu hình secret ghi cứng

Deployment Apps Script đang public là **version 5**. Đã clone immutable version vào backup riêng; business code trước `runQuickSetup` khớp Git sau chuẩn hóa newline. Khác biệt trong helper setup gồm giá trị secret ghi cứng, trong khi Git dùng Script Properties/placeholder. Không ghi giá trị vào báo cáo; bản tải local đã được che literal này. Không chạy helper hoặc đổi secret trong review.

Cần loại bỏ credential ghi cứng ở lần cập nhật GAS được duyệt; không chạy lại helper hiện tại để chữa thiếu từ. Việc setup tồn tại/set SCHEMA_VERSION=3 không chứng minh đã chạy hoặc headers/tabs thật đúng.

## Những phần có code, còn thiếu hoặc chưa nghiệm thu

| Phần | Trạng thái thực tế |
| --- | --- |
| Auth, Gemini voice, vocabulary GET | Người dùng đã xác nhận hoạt động sau M5-09/M5-10 |
| Lưu Word/Events và tạo Card mặc định | Có code ở Git và GAS v5; local integration pass; tự capture bị các lỗi V01–V04 chặn trước API |
| FSRS backend, snapshots/replay/OCC | Có code + tests; frontend mới chưa public; chưa đọc dữ liệu/headers Sheet thật trong review |
| Flashcards nhiều loại | Schema/backend cho phép Card độc lập; chưa có API/UI tạo/quản lý loại thẻ; mặc định một Card/từ |
| CSV backup/restore | Có export UI và parser/roundtrip tests; chưa có UI import/restore |
| Tắt/bật nhắc ôn | Bot có /pause và /start; chưa có màn Settings/đổi giới hạn ôn mỗi ngày trong Mini App |
| Cron ~08:00 UTC+7, quiz Telegram | Có implementation/tests; còn live QA gửi thật/chấm lại/retry không trùng |
| Quota/cost alerts, backup/restore, PC/Android/iOS | Chưa đủ evidence nghiệm thu; các task M0-02/M5-02/M5-03 còn pending |
| Anki, chấm phát âm, D1 | Optional M6, chưa làm; không chặn luồng lưu từ → FSRS của MVP |

## Kiểm chứng và giới hạn

- **36 tests/5 files PASS**: detector, Live client, App → Worker → GAS, FSRS integration và regressions. Log `.artifacts/M5-11/focused-tests.log`.
- **7 probes synthetic** với chính client/detector hiện tại: baseline lưu, thiếu tool, 3 biến thể câu hỏi, sai khác dấu câu, tool tới trước transcript. `.artifacts/M5-11/vocabulary-flow-probes.json` và fixture `probe.cjs`.
- Metadata GAS deployments/v5 source đã đọc bằng credential hiện có; không cấp OAuth mới. Clone vào thư mục riêng, không pull đè Git. `.artifacts/M5-11/gas-source-review.json` ghi business source khớp, setup literal đã redacted.
- `.artifacts/M5-11/frontend-feature-probes.json` và `frontend-public.js` xác minh bundle đang public; `worker-active-deployment.json` xác minh version Worker. Không suy ra Sheet headers/data từ source hoặc health.
- Không sửa feature/test source, không deploy, không chạy setup/migration, không ghi Google Sheet hoặc gửi bot message. Các probe không dùng token/key production, audio hoặc transcript riêng tư.
- Review hoàn tất không có nghĩa tính năng tự lưu/FSRS production đã hoàn thiện. Ưu tiên sửa V01–V04, đồng bộ frontend V05, sau đó live E2E trước khi đóng M1-03/M3-04/M4-04.
