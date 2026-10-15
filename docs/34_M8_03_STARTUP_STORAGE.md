# M8-03 — Khởi động nhanh và quan sát dung lượng D1

Ngày 15/10/2026. M8-03 đã deploy riêng frontend Pages; không truy vấn database production.

## Bằng chứng triển khai

- Pages project `voice-chat-learn-language`, environment `Production`, branch `production`; deployment `59ebfc76-8227-4e6f-9340-c942266ec6e1`, source code commit `5923c66`, build tag `M8-03-20261015`.
- [Mini App production](https://voice-chat-learn-language.pages.dev/?v=M8-03-20261015) và [deployment URL](https://59ebfc76.voice-chat-learn-language.pages.dev/) trả HTTP 200. Public JS `index-qdMBqaQr.js` SHA256 `E40109D7F2A6E145F56BC7A5A728B0063F87AF5C7F75691C318CC6650128D42F`, khớp artifact local; FlashcardReviewPanel/VocabularyManagerPanel lazy chunks đều 200.
- Worker `/health` trả 200; không deploy Worker hoặc thay D1/GAS. Deployment production trước đó để rollback: `bd7681c4-d114-47d7-bf64-0da7a61772f8`.
- Chờ người dùng thử lại trong Telegram thật; chưa đo startup latency, p95, D1 storage/quota hoặc thiết bị.

## Luồng khởi động

- HTML hiển thị boot shell nhẹ trước khi React mount; Telegram SDK dùng `defer` và đứng trước entry module để không chặn parser mà vẫn được thực thi trước code app.
- App chỉ giữ thao tác Voice sau khi Telegram auth hoàn tất. Không tải Words trong auth critical path.
- Review và Vocabulary chỉ tải khi mở tab. Vocabulary list được lấy khi người dùng mở tab; fetch hiện có vẫn đi hết các page để giữ behavior search/export hiện tại.
- Review/Vocabulary components được Vite tách khỏi entry JS thành lazy chunks; trạng thái loading riêng ngăn hiển thị nhầm “không còn thẻ” trong lúc request đầu tiên.

## Startup diagnostics

Format `mini-app-api-diagnostics-v1` bổ sung mảng `startup`, chỉ giữ timestamp, stage allowlist, elapsed/duration ms; tối đa 30 mốc trong memory của phiên. Không gửi telemetry tự động, không lưu vào local storage/server và không nhận request/body/transcript/token. Các stage phân biệt app mount, auth/voice ready và tải Vocabulary/Review. Người dùng chỉ chia sẻ log khi chủ động bấm sao chép.

## Đo dung lượng D1

Ưu tiên Cloudflare Dashboard: **Workers & Pages → D1 → chọn database → Metrics**. D1 metrics có dung lượng database, rows read/written và query latency; dữ liệu analytics được giữ tối đa 31 ngày. Không cần thêm API key hoặc endpoint của ứng dụng. [Cloudflare D1 metrics](https://developers.cloudflare.com/d1/observability/metrics-analytics/).

Query aggregate dưới đây ước lượng số row và byte payload theo bảng, không trả record/vocabulary. `LENGTH(CAST(... AS BLOB))` đếm byte nội dung UTF-8; số này thấp hơn dung lượng thực vì không gồm toàn bộ cột cấu trúc, index, page và overhead SQLite. Chạy thủ công, hiếm khi cần, vào giờ ít hoạt động vì nó scan các bảng. Thay tên database trong cấu hình Wrangler; chỉ dùng câu SELECT:

```powershell
$storageSql = @'
SELECT 'words' AS table_name, COUNT(*) AS row_count,
  COALESCE(SUM(LENGTH(CAST(record_json AS BLOB))), 0) AS logical_bytes FROM words
UNION ALL
SELECT 'cards', COUNT(*), COALESCE(SUM(LENGTH(CAST(record_json AS BLOB))), 0) FROM cards
UNION ALL
SELECT 'reviews', COUNT(*), COALESCE(SUM(LENGTH(CAST(record_json AS BLOB))), 0) FROM reviews
UNION ALL
SELECT 'events', COUNT(*), COALESCE(SUM(LENGTH(CAST(record_json AS BLOB)) + LENGTH(CAST(COALESCE(result_json, '') AS BLOB))), 0) FROM events
UNION ALL
SELECT 'settings', COUNT(*), COALESCE(SUM(LENGTH(CAST(record_json AS BLOB))), 0) FROM settings
UNION ALL
SELECT 'users', COUNT(*), COALESCE(SUM(LENGTH(CAST(record_json AS BLOB))), 0) FROM users
UNION ALL
SELECT 'daily_dispatches', COUNT(*), COALESCE(SUM(LENGTH(CAST(record_json AS BLOB))), 0) FROM daily_dispatches
UNION ALL
SELECT 'sync_outbox', COUNT(*), COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) FROM sync_outbox
UNION ALL
SELECT 'telegram_updates', COUNT(*), COALESCE(SUM(LENGTH(CAST(result_json AS BLOB))), 0) FROM telegram_updates
UNION ALL
SELECT 'telegram_deliveries', COUNT(*), COALESCE(SUM(LENGTH(CAST(payload_json AS BLOB))), 0) FROM telegram_deliveries
UNION ALL
SELECT 'migration_runs', COUNT(*), COALESCE(SUM(LENGTH(CAST(checkpoint_json AS BLOB))), 0) FROM migration_runs
UNION ALL
SELECT 'system_state', COUNT(*), COALESCE(SUM(LENGTH(CAST(key AS BLOB)) + LENGTH(CAST(value AS BLOB))), 0) FROM system_state
UNION ALL
SELECT 'mutation_guards', COUNT(*), COALESCE(SUM(LENGTH(CAST(guard_id AS BLOB))), 0) FROM mutation_guards
UNION ALL
SELECT 'sync_processor_lease', COUNT(*), COALESCE(SUM(LENGTH(CAST(lease_token AS BLOB)) + LENGTH(CAST(lease_until AS BLOB))), 0) FROM sync_processor_lease;
'@
$databaseName = 'your-d1-database-name'
npx wrangler d1 execute $databaseName --remote --command $storageSql
```

Free tier limits vary by plan and account. As of this document date, Cloudflare lists 500 MB per database and 5 GB aggregate storage on Workers Free; check the live [D1 limits](https://developers.cloudflare.com/d1/platform/limits/) before planning capacity. The Dashboard's `databaseSizeBytes` is the authoritative file-size metric; aggregate SQL is only for locating logical row/payload growth.

## Retention boundary

Do not prune `reviews` (append-only FSRS history) or `events` (idempotency/replay/audit). Do not remove pending/leased/dead mirror payloads. Delivered outbox payload compaction and Telegram dedupe cleanup are future changes only after a measured growth need, defined retry/replay retention, verified backup/restore and regression tests. No automatic deletion was added in M8-03.
