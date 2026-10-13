# M7 — Bằng chứng triển khai D1 và latency

## M7-01 — 13/10/2026, local

- Diagnostic capture có stages direct/recovery, persistence/timeout/reject, correlation UUID và elapsed monotonic; metadata được Zod whitelist, bounded 100, không chứa từ/transcript/tool args/token.
- API diagnostics copy được cả khi không có HTTP failure; vẫn giữ format v1, bổ sung `capture`. GAS operation và Worker request log duration/action/route template, không query/IDs học.
- Suite 139 tests/20 files PASS và baseline test riêng 1 test PASS. Typecheck/lint/build/secret scan/diff check PASS; Vite build bằng API origin production + build tag M7-01 nhưng **chưa deploy**.
- Benchmark GAS VM 30 create + 30 review: create p50 0,53/p95 0,90 ms, review p50 1,66/p95 3,57 ms; 1 và 3 upstream calls tương ứng. Đây là CPU/orchestration synthetic không có mạng/Google, **không phải latency production** và không dùng để hứa tốc độ sau D1. `.artifacts/M7-01/baseline.json`.
- Sandbox EPERM khi Vitest/Vite đọc modules được xử lý bằng chạy đúng lệnh local qua approval; kết quả không coi EPERM là lỗi application. Production baseline từng chặng chờ bản diagnostics/staging, nghiệm thu ở M7-08/M7-10.
