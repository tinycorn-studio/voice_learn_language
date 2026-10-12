# Review triển khai Antigravity — M5-04

Ngày: 2026-10-12 (UTC+7). Revision được review: `9963ed1`, gồm các commit triển khai M1–M4. Working tree sạch khi bắt đầu. Phạm vi: source local, hợp đồng API, acceptance criteria, unit/integration tests. Không gọi dịch vụ thật, thay secret, push hoặc deploy.

**Kết luận: chưa sẵn sàng dùng thật.** Nền tảng TypeScript, schema, SRS và kiểm thử đã có; các màn hình vẫn chạy bằng state cục bộ, luồng voice chưa được nối, và có lỗi mất sự kiện/nhắc ôn khi retry. Thiếu credentials không phải blocker duy nhất.

## Các lỗi cần sửa

### R01 — P1: Start Microphone chưa khởi tạo hội thoại Gemini

Vị trí: `apps/web/src/features/voice/components/VoiceSessionPanel.tsx:62–75`.

Handler chỉ xin quyền micro rồi đặt trạng thái `listening`. Không xin live token, tạo `GeminiLiveSessionClient`, chuyển MediaStream thành PCM hoặc phát audio đầu ra. Tìm toàn bộ production source cho thấy client và `sendPcmAudioChunk` chưa có caller. Người dùng bấm Start sẽ thấy đang nghe nhưng không có hội thoại AI. Cần nối auth → token → capture PCM → WebSocket → playback/transcript và đóng toàn bộ tài nguyên khi Stop/unmount. M1-02 cần hoàn thiện code trước khi nghiệm thu thiết bị thật.

### R02 — P1: Báo đã lưu nhưng dữ liệu từ vựng và ôn tập chỉ tồn tại trong RAM

Vị trí: `apps/web/src/app/App.tsx:40–79`; `apps/web/src/features/voice/components/VoiceSessionPanel.tsx:99–111`.

App khởi tạo dữ liệu mẫu và dùng `setWords` cho lưu/sửa/xóa/ôn. Không có `fetch` trong production web source; raw Telegram initData không được dùng để xác thực Worker. Badge được đặt `saved` ngay và phản hồi khẳng định đã lưu, dù chưa gọi API. Reload làm mất thay đổi, Sheet/Telegram không nhận từ mới; lịch ôn cũng không được ghi vào Reviews. Cần client API có auth, lấy dữ liệu thật, xử lý pending/error và chỉ báo saved sau xác nhận backend. `VocabularySaveQueue` hiện chỉ được sử dụng trong test.

### R03 — P1: Webhook đánh dấu hoàn thành trước khi ghi review, làm mất sự kiện sau lỗi transient

Vị trí: `apps/worker/src/entry.ts:216–225`.

`markTelegramUpdateProcessed` chạy trước `recordReview` và các side effect. Tái hiện bằng harness: request callback đầu gặp lỗi mạng GAS → HTTP 503; Telegram retry cùng update → HTTP 200 `duplicate_update`, trong khi Reviews vẫn chỉ có header. Cần tách pending/completed và chỉ xác nhận hoàn tất sau xử lý thành công; dùng event_id bền vững để bảo vệ side effect qua isolate/restart. Một Set trong isolate không đủ làm nguồn trạng thái xử lý.

### R04 — P1: Nhắc ôn được ghi sent trước khi Telegram gửi thành công

Vị trí: `apps-script/Code.gs:608–636`; `apps/worker/src/entry.ts` trong `handleScheduledCron`.

`claimDailyDigest_` ghi `status: sent` và `sent_at` trước `sendMessage`. Tái hiện: Telegram trả 503 → cron trả `telegram_send_failed`; chạy lại cùng ngày → `already_dispatched`, chỉ có một lần thử gửi. Người dùng mất thông báo cả ngày và log báo thành công sai. Cần claim có trạng thái/lease, bước ghi nhận kết quả gửi, phân biệt lỗi chắc chắn chưa gửi với timeout chưa rõ kết quả, và retry có giới hạn.

### R05 — P2: PATCH cùng event_id không idempotent

Vị trí: `apps-script/Code.gs:295–323`, `352–359`.

`updateWord_` không tìm event đã xử lý trước kiểm version. Tái hiện: PATCH version 1 thành công; gửi lại đúng body/event_id vì mất response → 409 Version mismatch. DELETE cũng không kiểm event cũ, nên retry tiếp tục tăng version và append Events. Cần lưu và trả lại kết quả gốc theo event_id trước khi áp dụng mutation; không chỉ kiểm idempotency cho upsert/review.

### R06 — P2: Sửa sense/POS có thể tạo hai bản ghi cùng khóa duy nhất

Vị trí: `apps-script/Code.gs:333–350`.

`updateWord_` thay POS/sense rồi ghi word_key mà không kiểm khóa đích đã thuộc từ khác. Tái hiện: tạo bank/financial và bank/river, sửa river thành financial → hai word_id khác nhau có cùng word_key. Upsert về sau chỉ tìm một dòng, gây lệch thống kê và SRS. Cần tính/validate khóa đích trước khi ghi bất kỳ field nào; trả conflict hoặc merge theo quy tắc rõ ràng, trong lock.

### R07 — P2: Mất socket bất ngờ chỉ đổi nhãn reconnecting, không kết nối lại

Vị trí: `apps/web/src/features/voice/services/gemini-live-client.ts:145–151`.

`onclose` không gọi connect hay lập lịch retry. Tái hiện bằng fake WebSocket: đã nhận resumption handle, gọi onclose, chờ → vẫn chỉ có một socket. Nhánh goAway có reconnect nhưng không bảo vệ mất mạng/đóng bất ngờ như mô tả. Cần retry có backoff/budget, resumption handle, vòng đời token và hủy retry khi Stop. Test hiện chỉ kiểm goAway.

### R08 — P2: CSV do chính exporter tạo có thể restore sai bản ghi

Vị trí: `packages/shared/src/utils/csv.ts:117–121`.

Exporter hỗ trợ quote field có xuống dòng, nhưng importer split theo newline trước khi parse quoted record. Tái hiện: xuất một word có example `First line\nSecond line`, import lại → hai item thay vì một. Cần parse CSV theo record xuyên dòng và validate toàn bộ item; dữ liệu numeric không hợp lệ hiện cũng có thể trở thành NaN. Chưa có UI/endpoint import để nghiệm thu restore end-to-end.

### R09 — P2: Guard function call không đối chiếu từ được hỏi với từ AI muốn lưu

Vị trí: `packages/shared/src/utils/detector.ts:249–275`.

Guard chỉ kiểm source_excerpt chứa một câu hỏi từ vựng. Tái hiện: `{word: 'elephant', meaning_vi: 'voi', source_excerpt: 'What does bank mean?'}` được trả `allowed: true`. Source excerpt cũng do model cung cấp, nên không đủ chứng minh ý định thật. Cần ràng buộc với transcript user đã nhận và kiểm target phù hợp; riêng luồng dịch Việt → Anh phải có quy tắc mapping để không so chuỗi máy móc.

## Bằng chứng kiểm tra

- `npm run typecheck`: pass, cả ba workspace.
- `npm run lint`: pass, cả ba workspace.
- `npm test`: 7 test files, 31 tests pass.
- `npm run build`: pass; web Vite bundle thành công. Worker build script hiện chỉ chạy `tsc --noEmit`, chưa chứng minh Wrangler bundling/deploy.
- `npm run check:secrets`: pass, không phát hiện forbidden tracked files/patterns.
- `git diff --check`: pass trước cập nhật tài liệu review.
- Bảy regression probes độc lập tái hiện R03–R09 bằng GAS VM harness, fetch/WebSocket giả và assertions. Các probe xác nhận hành vi lỗi hiện hữu, không phải xác nhận tính năng đã sửa. Script probe lưu ngoài repository trong thư mục artifact của chat, không thêm vào suite sản phẩm.
- Test/build lần đầu bị EPERM do sandbox khi Vite realpath; đã chạy lại ngoài sandbox và pass. Không coi lỗi sandbox là lỗi source.

## Giới hạn của bộ test và trạng thái nghiệm thu

31 test hiện xanh vì chưa kiểm đường đi từ App thật đến backend. Các integration test gọi Worker trực tiếp với dữ liệu giả; chưa có E2E microphone → Gemini thật → Sheets thật → Telegram thật. Test có tên expired HMAC chỉ assert chữ ký sai; test có tên pause opt-out chưa thực hiện lệnh pause. GAS harness không mô phỏng lock/concurrency thực tế.

Đã đối chiếu tài liệu hiện hành: [Google ephemeral tokens](https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens) và [Live WebSocket API](https://ai.google.dev/api/live). Chưa xác nhận model/quota/ephemeral token trên project thật. Cloudflare [runtime documentation](https://developers.cloudflare.com/workers/reference/how-workers-works/) xác nhận request không bảo đảm vào cùng isolate; vì vậy in-memory rate limit/dedup hiện chỉ có tác dụng theo isolate.

Mở lại M1-03, M3-03, M3-04, M4-02, M4-03 và M4-04 vì acceptance chưa được đáp ứng. M1-02 vẫn chưa hoàn thành; cần bỏ giả định chỉ cần credentials là đủ chạy voice. Giữ lịch sử evidence cũ để truy vết, nhưng dùng trạng thái checklist mới và review này cho bước tiếp theo.

Thứ tự sửa: R01/R02 (luồng sử dụng thật), R03/R04 (mất side effect khi retry), R05/R06 (toàn vẹn dữ liệu), R07/R09 (voice/detector), R08 (backup/restore). Thêm regression tests cho từng lỗi, rồi chạy đầy đủ gates và nghiệm thu dịch vụ/thiết bị thật trước M5-01. Review không thực hiện sửa lỗi hoặc deploy.

**Cập nhật M5-05:** Các lỗi source trên đã được sửa và có regression tests; trạng thái/bằng chứng mới ở [docs/22_REVIEW_FIXES.md](22_REVIEW_FIXES.md). Nội dung review này giữ nguyên để truy vết commit 9963ed1.
