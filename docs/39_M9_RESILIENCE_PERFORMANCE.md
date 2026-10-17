# M9 — Độ bền và hiệu năng vận hành

Nhánh `feat/M9-resilience-performance`, ngày 17/10/2026. Các thay đổi local; chưa deploy. Tài liệu gồm ba task: M9-01 queue bền (IndexedDB), M9-02 rate limit D1, M9-03 giảm CPU mirror.

## M9-01 — Queue lưu từ vựng bền qua reload

### Vấn đề

`VocabularySaveQueue` chỉ sống trong bộ nhớ phiên. Nếu Mini App bị đóng/reload khi Worker/GAS lỗi hoặc mất mạng, các từ đang `pending`/`failed` mất hoàn toàn; người dùng phải nói lại. Đây là hạn chế đã ghi nhận từ M8-07 (`Entries pending không giữ qua phiên`).

### Thay đổi

- Thêm `apps/web/src/features/vocabulary/services/durable-queue-storage.ts`:
  - Adapter IndexedDB: DB `voice-chat-capture-queue`, object store `entries`, keyPath `entry.request.event_id`, record version `1`.
  - Chỉ lưu entry `pending`/`failed`; entry `saved` là trạng thái UI tạm thời nên không persist.
  - TTL 7 ngày (`QUEUE_STORAGE_TTL_MS`); record quá hạn bị loại khi đọc.
  - Mọi record đọc lên đều Zod-validate (`vocabularyCreateRequestSchema` + trạng thái); record hỏng bị bỏ qua.
  - Không lưu token/`initData`; payload đúng bằng dữ liệu gửi API (word/meaning/example/source_excerpt).
  - `createIndexedDbQueuePersistence()` trả `null` khi IndexedDB không khả dụng (SSR, private mode) để queue giữ hành vi in-memory cũ.
- `VocabularySaveQueue` nhận tham số thứ ba `persistence` (mặc định `null`):
  - `hydrate()` khôi phục entry cũ, bỏ qua trùng `event_id`, không vượt `maxEntries`; không bao giờ throw.
  - Ghi persist fire-and-forget sau mỗi thay đổi, serialize qua `persistChain`; lỗi storage bị nuốt để không ảnh hưởng queue.
  - `flushPersistence()` chờ các ghi đang xếp hàng (dùng cho test).
- Hook `useVocabularyCaptureQueue` tạo persistence IndexedDB và hydrate khi mount; entry khôi phục giữ nguyên `status`/`attempts`/`lastError` để người dùng retry tay như trước (không auto-retry khi mở app).
- Thêm devDependency `fake-indexeddb` để chạy IndexedDB thật trong jsdom.

### Verification

- 9 test mới `apps/web/src/features/vocabulary/services/durable-queue-storage.test.ts`: roundtrip, TTL hết hạn, record hỏng bị bỏ, IndexedDB unavailable → null, khôi phục qua queue instance mới, saved không persist, storage lỗi không phá queue, hydrate bỏ qua trùng, giữ hành vi in-memory khi không có persistence.
- Full suite: 227/227 tests (37 files); typecheck/lint PASS.

## M9-03 — Giảm CPU đường mirror

### Vấn đề

Mirror từng đo CPU 32/13/16 ms trên request (docs/31) trong khi trần CPU Free là 10 ms. Mỗi lần drain một job, `processSheetMirror` thực hiện: parse `payload_json`, validate toàn bộ cây snapshot hai lần (`mirrorJobSchema` rồi `mirrorBatchSchema` bọc lại), `canonicalJson` lại toàn bộ cây, `importKey` HMAC mới cho mỗi chữ ký, và hai lệnh D1 cuối (update outbox + nhả lease) tách rời.

### Thay đổi

- `apps/worker/src/adapters/gas-client.ts`: cache `CryptoKey` HMAC theo secret trong isolate (tối đa 4 secret, xoá cache khi import lỗi). Mọi call có chữ ký (mirror, digest Telegram) không còn `importKey` lại mỗi lần.
- `apps/worker/src/adapters/sheet-mirror.ts`:
  - Bỏ lần validate thứ hai toàn cây: epoch vẫn validate bằng `mirrorBatchSchema.shape.epoch`; job vẫn được validate đầy đủ một lần bằng `mirrorJobSchema` trước khi dùng.
  - Envelope `mirror.applyBatch` được compose bằng helper `composeMirrorEnvelopePayload` theo đúng thứ tự key canonical (action, data, event_id, issued_at, request_id, user_id) và tái sử dụng `payload_json` nguyên văn, nên không cần `canonicalJson` lại cây snapshot mỗi lần retry. Khi `payload_json` đã canonical, bytes ký giống hệt cách cũ (có test chốt).
  - Update outbox cuối + nhả lease gộp chung một `db.batch()` (một vòng D1 thay vì hai); `finally` giữ nhả lease như lưới an toàn.
- Không đổi hành vi nghiệp vụ: lease/epoch/owner check/retry backoff/ngưỡng 8 lần/dead letter giữ nguyên.

### Benchmark local

Harness `tests/m9-03-local-benchmark.test.ts`, Node 22 local, job synthetic 4 entity Words (~25.7 KB payload), 5 warm-up + 60 mẫu, đo phần sync (parse + validate + đóng gói envelope, không gồm crypto/D1/mạng):

| Đường xử lý | p50 | p95 |
| --- | ---: | ---: |
| Legacy: 2× zod toàn cây + canonicalJson toàn cây | 0.194 ms | 0.510 ms |
| Optimized: 1× zod + compose | 0.065 ms | 0.116 ms |

Chữ ký (wall, Node threadpool nên không phản ánh CPU workerd): `importKey` mới p50 0.071 ms so với key cache p50 0.049 ms. Số local chỉ chứng minh cấu trúc giảm việc: bỏ một lần validate toàn cây + một lần canonical hoá toàn cây mỗi attempt, cache key import, giảm một vòng D1 — không dùng để dự đoán CPU production; re-profile production vẫn thuộc M7-10.

### Verification

- 5 test mới `tests/m9-03-local-benchmark.test.ts`: bytes compose ≡ `canonicalJson` cho payload canonical; chữ ký verify được với payload lưu kiểu `JSON.stringify`; key cache cho chữ ký trùng với import mới; `processSheetMirror` deliver thật với envelope compose (mock GAS verify HMAC); benchmark legacy/optimized.
- Regression mirror: `tests/d1-mirror.test.ts` 9/9 PASS.
- Full gates: typecheck/lint/build PASS.

## M9-02 — Rate limit dùng chung toàn cục

### Vấn đề

Rate limit live-token (5/phút) và translate (12/phút) nằm trong `SecurityStateStore` bộ nhớ per-isolate: khi Worker scale nhiều isolate hoặc isolate bị recycle, bộ đếm mất/mỗi isolate đếm riêng nên giới hạn thực tế bị nới lỏng.

### Thay đổi

- Migration `apps/worker/migrations/0004_rate_limits.sql`: bảng `rate_limit_windows(scope,user_id,window_start,count)` khoá chính `(scope,user_id,window_start)` + index `window_start` cho cleanup. Chưa apply production (deploy riêng khi được yêu cầu).
- `apps/worker/src/adapters/d1-rate-limiter.ts`:
  - `D1RateLimiter.consume`: cửa sổ cố định 60 giây neo theo bucket; một `db.batch([upsert ON CONFLICT count+1, select count])` — một vòng D1; `count > maxPerMinute` → `AppError RATE_LIMITED 429` giữ nguyên mã lỗi và message cũ.
  - `cleanupRateLimitWindows`: xoá window cũ hơn cutoff, gọi từ Cron phút.
- `SecurityStateStore.enforceRateLimit(scope, limiter, userId, nowMs, max)`: ưu tiên D1; `AppError` (kể cả RATE_LIMITED) được ném lại; lỗi hạ tầng khác (D1 down) rơi về sliding window bộ nhớ per-isolate — không fail open.
- `entry.ts`: tạo `rateLimiter` từ `env.DB` mỗi request; route live-token/translate gọi bản `enforce` async; `handleScheduledTick` thêm cleanup vào `Promise.allSettled` (processor `rate_limit_cleanup`).
- Khác biệt chủ động so với trước: fixed window thay sliding (burst qua ranh giới bucket có thể tới ~2× trong trường hợp xấu; chấp nhận vì đây là chống lạm dụng, không phải tính phí) và request bị từ chối vẫn tiếp tục đếm trong window. Không lưu token/initData, chỉ `user_id` + scope.

### Verification

- 5 test mới `tests/d1-rate-limit.test.ts` trên D1 harness thật: cho đúng max rồi chặn và chia sẻ bộ đếm giữa hai instance cùng scope/user khác isolate; rollover theo bucket 60 giây; scope/user độc lập; cleanup chỉ xoá window cũ; fallback bộ nhớ khi limiter lỗi + RATE_LIMITED từ D1 được ném lại; entry integration: 5 request 200 từ store A rồi store B hoàn toàn mới vẫn bị 429 (chứng minh bộ đếm toàn cục).
- Ghi chú vận hành: gộp nhiều runtime Miniflare trong một file test để tránh startup workerd song song vượt timeout dưới tải máy cao; các file D1 nặng hiện có vẫn giữ nguyên.
- Full suite: 237/237 tests (39 files); typecheck/lint/build PASS.
