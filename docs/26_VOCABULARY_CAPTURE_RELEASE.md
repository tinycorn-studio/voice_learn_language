# M5-12 — Tự ghi nhận từ và frontend FSRS

Ngày 13/10/2026. Phạm vi được người dùng yêu cầu triển khai sau review M5-11: V01–V04 capture/validation và V05 frontend FSRS. Không chạy migration/setup, thay secret hoặc thêm dịch vụ AI/model mới.

## Cách xử lý

- Detector nhận câu hỏi có tên từ rõ như `Overwhelmed, that mean?`, `Overwhelmed, what does that mean?`; vẫn chặn câu thường, hỏi "that" thiếu đối tượng và target bịa.
- So sánh từ trong câu hỏi sau NFKC/case/space và dấu câu ASR. Không chấp nhận đổi từ hoặc lấy câu hỏi khác làm source. `source_excerpt` lưu từ snapshot transcript thật, tối đa 500 ký tự.
- `VocabularyCapture` giữ snapshot câu hỏi/context/event ID trong memory theo phiên. Tool đến sớm được chờ transcript phù hợp tối đa 6 giây; không gán cho câu hỏi mới nhất nếu source khác nhau.
- Các tool ID cùng câu hỏi dùng một operation/event ID. Lời gọi gốc và tool sau recovery không tạo hai writes; mất acknowledgement vẫn dùng queue/API idempotency hiện có. Saved chỉ sau response persistence.
- Sau `turnComplete`, chờ 1,5 giây cho tool/transcript muộn. Nếu chưa có tool hợp lệ, gửi một yêu cầu tool qua `clientContent` trên kết nối Gemini Live hiện tại; không gọi AI theo audio chunk hoặc mở model text mới. Tối đa một recovery đã gửi cho mỗi câu hỏi, 10 recovery mỗi Start; chờ kết quả 10 giây. Transport chưa sẵn sàng được đợi có budget 6 giây, không tính là một request đã gửi.
- Không chờ Google Sheets trong hàng xử lý audio/transcript. Stop/Start mới dọn timers, pending tools và lịch sử capture; callback cũ không cập nhật phiên mới. Write đã gửi trước Stop vẫn phải đối chiếu acknowledgement/queue.
- UI hiển thị đang ghi nhận hoặc chưa xác nhận lưu; trạng thái theo từ, tối đa 30 mục trong memory và hiện 3 mục gần nhất. Các badge saved/pending/failed từ queue vẫn là trạng thái persistence.
- Frontend dùng Card ID/version, preview/submit/stats và interval badges từ backend FSRS đã có. Word → Card mặc định và scheduling `ts-fsrs` vẫn chạy backend/GAS, không tính lịch trên browser.

## Bằng chứng local

- Regression trước sửa: **8 fail**, gồm named question, punctuation, tool tới trước ASR, missing tool và audio bị chặn bởi write.
- Sau sửa: **138 tests/20 files PASS**; typecheck/lint/build, Worker dry-run và secret scan là gates của release. Evidence `.artifacts/M5-12/`.
- App integration có cả original-tool và recovery-tool: hỏi → tool → Word/Events/Card đúng một row sau mất ACK/retry; preview/Card rating chính thức, mất review ACK/retry và reload/delete. Mock Gemini/audio và GAS VM, không thay nghiệm thu dịch vụ thật.
- Bổ sung timeout, Stop, fresh Start, ASR sau turnComplete, khác tool IDs khi save chưa ACK và cap 10 recoveries.
- Artifact build bằng public env `VITE_API_BASE_URL` đúng Worker và `VITE_APP_VERSION=M5-12-20261013`; đã kiểm có API Card/preview/submit/stats và recovery. Không dựa vào file env ở thư mục không được Vite envDir nạp.

## Triển khai và nghiệm thu

Giữ Pages rollback **1a4f0e48-f02e-4bbe-9ec6-e8e03852a739**, production branch `production`. Trước deploy giữ source/bundle/hash và đọc lại deployment. Người dùng đã yêu cầu triển khai M5-12; chỉ upload đúng artifact sau gates pass. Kết quả deployment/source hash được ghi tiếp bên dưới và trong PROGRESS.

Sau deploy mở lại Mini App, kiểm build M5-12-20261013, hỏi một từ bằng câu chuẩn và một câu `X, that mean?`. Chỉ coi lưu thành công khi badge xác nhận và có Word/Card; mở Flashcards, xem preview, chấm Good và kiểm Reviews/due thay đổi. Nếu chưa lưu, chụp trạng thái ghi nhận và sao chép API diagnostics; không gửi initData/token/key.

Giới hạn: Recovery vẫn cần Gemini sinh tool hợp lệ; quá budget thì báo chưa xác nhận thay vì giả saved. Model có thể phát thêm lời trong recovery dù prompt yêu cầu chỉ gọi tool; cần live QA. ASR đến quá muộn ngoài cửa sổ 6 giây hoặc source/target thực sự khác vẫn bị chặn. Không ghi audio/transcript vào diagnostics; không tự reset Events hoặc chạy migration để chữa lỗi.

## Deployment production — 14:50 UTC+7, 13/10/2026

- Pages deployment **ae4031d8-7eab-467e-bf79-811f8ac6f051**, branch **production**, [URL](https://ae4031d8.voice-chat-learn-language.pages.dev). Wrangler 4.149.0 upload/deploy thành công.
- Public root, URL menu `/?v=20261012c` và `/?v=M5-12-20261013` đều HTTP 200, tải `/assets/index-C2NMt0rU.js`; index `public, must-revalidate, max-age=0`.
- SHA256 bundle public **A00E2F2EBDC2609F6FFECA6F239C4FC72788B1E1042B386532D035217D04B60E**, khớp chính xác artifact đã test. HTML SHA256 local **1ED0B8DCC0FB3035652FA8EAA3579ABD4699C877640DFADD3018787AA6D06D91**. Artifact `.artifacts/M5-12/frontend.zip`, SHA256 **1AB04C440D6AD1029033525B79EE11328866F36A67BB6B373B9659799959470F**.
- Artifact đã kiểm có build tag M5-12-20261013, đúng API origin, recovery và FSRS Card/preview/submit/stats. Build 61 modules, JS 345.68 kB/gzip 103.63 kB; 138 tests/20 files, typecheck/lint/build, Worker dry-run, secret scan (tracked + new files + bundle), git diff --check PASS.
- Worker vẫn **e07a24e2-5aeb-4aae-93cb-c6be6a79aa1d**, 100%; dry-run bundle **F551D88B...** khớp Worker trước đây, không cần redeploy backend. GAS vẫn version 5 theo lần đọc M5-11; không thay code/properties/Sheet.
- `/health` HTTP 200, request ID `1f086872-106f-4973-bf4c-f3a28ff8ad60`; `/api/v1/diag` HTTP 200/GAS GET connected 2153 ms, request ID `f5c884b8-0957-456d-b0b2-8d747993e0f5`. OPTIONS reviews/stats 204 và allow-origin đúng Pages.
- Pages source metadata ghi base commit `8a6bc44` + `commit-dirty=true`; dùng bundle SHA256 để xác định bytes triển khai. Review manifest/ZIP trước deploy được giữ nguyên; `.artifacts/M5-12/deployment-evidence.json` ghi kết quả sau deploy.
- Rollback đã giữ **1a4f0e48-f02e-4bbe-9ec6-e8e03852a739** và `.artifacts/M5-12/previous-public.js` SHA256 **D967E9628CCB539002E9E152552341E7EEB4EEA4470C49019013A02D6798D1E4**. Không thực hiện rollback.

Tại thời điểm deploy, M5-12 giữ **IN_PROGRESS / DEPLOYED_WAITING_LIVE_QA**: chưa có lượt hỏi nghĩa/Sheet/Card/rating thật sau deployment mới. Các tests integration dùng mocks/GAS VM; health/diag/CORS/public hash không thay thế nghiệm thu này. Cập nhật từ người dùng sau đó được ghi dưới đây.

## Cập nhật nghiệm thu — 18:16 UTC+7, 13/10/2026

- Source commit **0e073519c791e76c0e0cde46ba84b3481969dcd6** đã push lên `fix/M5-12-vocabulary-capture-fsrs-release`. [GitHub Actions 38365870013](https://github.com/tinycorn-studio/voice_learn_language/actions/runs/38365870013) đã **completed/success**, head SHA khớp source. Lần đọc CI cũ bị automatic approval review hết hạn mức; đọc lại đúng action sau mốc thử lại thành công, blocker đó đã hết.
- Người dùng trước tiên chọn “Vẫn chưa lưu hoặc chưa có thẻ”, sau đó cập nhật đã thấy, rồi xác nhận cụ thể: từ đã save trên Sheet và `/review` Telegram cũng đã hiện. Kết quả mới thay thế báo lỗi ban đầu, xác nhận capture/persistence/hiển thị ôn thực tế. Chưa có log thời gian/build của lượt thử; không kết luận nguyên nhân hoặc định lượng độ trễ từ lời xác nhận này.
- Không sửa source hoặc deploy thêm trong lượt kiểm tra; giữ production **ae4031d8**, build **M5-12-20261013**. Không có tab trình duyệt kết nối để đọc Sheet headers, không chạy setup/migration hoặc thay properties.
- Task giữ **IN_PROGRESS / WAITING_RATING_LIVE_QA**. Bước tiếp theo: reveal và chấm Good rồi kiểm `Reviews`/`due`. User xác nhận có từ trên Sheet và `/review`, chưa trực tiếp đối chiếu row `Cards` hoặc rating audit. Chưa merge nhánh M5-12 vào main hoặc coi mọi milestone đã nghiệm thu.
