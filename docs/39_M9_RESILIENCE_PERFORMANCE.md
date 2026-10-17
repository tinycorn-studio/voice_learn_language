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
