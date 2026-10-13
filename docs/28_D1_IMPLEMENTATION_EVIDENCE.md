# M7 — Bằng chứng triển khai D1 và latency

## M7-01 — 13/10/2026, local

- Diagnostic capture có stages direct/recovery, persistence/timeout/reject, correlation UUID và elapsed monotonic; metadata được Zod whitelist, bounded 100, không chứa từ/transcript/tool args/token.
- API diagnostics copy được cả khi không có HTTP failure; vẫn giữ format v1, bổ sung `capture`. GAS operation và Worker request log duration/action/route template, không query/IDs học.
- Suite 139 tests/20 files PASS và baseline test riêng 1 test PASS. Typecheck/lint/build/secret scan/diff check PASS; Vite build bằng API origin production + build tag M7-01 nhưng **chưa deploy**.
- Benchmark GAS VM 30 create + 30 review: create p50 0,53/p95 0,90 ms, review p50 1,66/p95 3,57 ms; 1 và 3 upstream calls tương ứng. Đây là CPU/orchestration synthetic không có mạng/Google, **không phải latency production** và không dùng để hứa tốc độ sau D1. `.artifacts/M7-01/baseline.json`.
- Sandbox EPERM khi Vitest/Vite đọc modules được xử lý bằng chạy đúng lệnh local qua approval; kết quả không coi EPERM là lỗi application. Production baseline từng chặng chờ bản diagnostics/staging, nghiệm thu ở M7-08/M7-10.

## M7-02 — 13/10/2026, local

- Mini App trả tool result sau persistence ACK, không chờ refresh; refresh coalesce theo vocabulary/review, mutation trong lúc GET đang chạy có lượt đọc lại phía sau. Voice startup không tải due/stats; vào review mới tải. Rating bỏ thẻ theo server response và refresh nền.
- Telegram ACK “Đang ghi nhận…” trước write, timeout 1 giây; không báo thành công sớm. Sau commit edit đúng message và gỡ keyboard, fallback callback cho update cũ không message ID. ACK/edit lỗi không làm chấm lại; delivery bền vững tiếp tục ở M7-05, chưa deploy bước trung gian này.
- Tests trì hoãn write chứng minh ACK trước và success sau commit; trì hoãn GET chứng minh saved/tool ACK không phải đợi GET. Coalesce regression bảo vệ trailing refresh và App integration đầy đủ vẫn pass.
- **143 tests/23 files PASS**, typecheck/lint/build/secret scan/diff check PASS. `.artifacts/M7-02/`. Chưa đo latency thật hoặc deploy; D1 authority/migration còn các tasks tiếp theo.

## M7-03 — 13/10/2026, local

- SQL revision 1: domain records giữ JSON nguyên schema v3, cột indexed có CHECK parity, Words unique key, FK owner/Word/Card, Reviews append-only triggers, Events replay, dispatch/outbox/delivery/checkpoint/system state.
- SQL guard CHECK trong DB.batch được chứng minh rollback toàn batch và maintenance bằng **Miniflare/workerd D1 thật local**, không phải mock SQLite. Kiểm unique, owner FK, index/JSON version parity và Reviews immutable pass.
- Factory dùng chung HTTP/Bot/Cron, lazy sau auth/live-token; D1 missing/schema chưa sẵn sàng fail closed, không fallback GAS. DATA_BACKEND production/staging vẫn gas; local config có binding synthetic riêng, chưa tạo database remote.
- **146 tests/24 files PASS**, typecheck/lint/Worker dry-run PASS. `.artifacts/M7-03/`. D1 staging thật và full migration/rollback rehearsal vẫn M7-08.
- Miniflare 4.20260730.0/@cloudflare/workers-types 5.20261013.1; audit phát hiện sharp/undici transitive mới, đã pin dev overrides sharp 0.35.5/undici 7.29.1 và kiểm runtime lại. Audit còn các cảnh báo Vitest/tinypool/mocker có từ trước, không đưa dev runtime vào Worker bundle; chưa upgrade major ngoài scope.
