# M8-02 — Tối ưu độ trễ tương tác

Ngày 15/10/2026, nhánh `feat/M8-02-interaction-latency`. Đây là thay đổi local; chưa deploy và chưa đo trên production.

## Thay đổi

- D1 create/review gom event replay lookup và Word/Card context lookup vào một `D1Database.batch()` preflight; mutation vẫn nằm trong batch atomic riêng, giữ event replay, optimistic concurrency control và retry.
- Telegram delivery lấy revision mới nhất trước, bỏ các revision cũ bằng cơ chế superseded đã có. Foreground webhook khởi động delivery trước Sheet mirror; Cron vẫn là đường phục hồi durable.
- Bổ sung thời lượng persistence cho capture diagnostic, thời lượng ACK/commit/delivery và độ trễ chờ delivery. Log chỉ có thời gian/trạng thái/action, không có từ vựng, transcript, payload hay token.
- Transcript rows được memoize để cập nhật interim không render lại mọi câu cũ; scroll được gộp theo `requestAnimationFrame`.
- Không giảm recovery grace interval: cần telemetry thiết bị thật trước khi thay đổi cửa sổ thu hồi có ảnh hưởng correctness.

## Benchmark local

Harness Miniflare/workerd D1 trong bộ nhớ, synthetic queries, 10 lượt warm-up và 30 mẫu cho từng cách đọc. Baseline chạy hai `first()` tuần tự; candidate chạy cùng hai câu SELECT bằng một `batch()`.

| Cách đọc | D1 round-trips | p50 | p95 |
| --- | ---: | ---: | ---: |
| Tuần tự (baseline) | 2 | 12.61 ms | 16.05 ms |
| Batch (candidate) | 1 | 6.63 ms | 8.04 ms |

Trong phép đo synthetic này, p50 giảm khoảng 47% và p95 khoảng 50%; thay đổi chắc chắn về cấu trúc là giảm một D1 round-trip cho cặp preflight. Số liệu local không bao gồm auth, Gemini, mạng tới Cloudflare D1, Telegram hoặc thiết bị người dùng; không dùng để dự đoán production p95, CPU hoặc quota.

Chạy lại phép đo bằng:

```powershell
npx vitest run tests/m8-02-local-benchmark.test.ts --maxWorkers=1 --minWorkers=1 --testTimeout=20000 --reporter=verbose
```

## Verification

- Focused regression: 46 tests / 6 files PASS.
- Full suite trước khi thêm harness benchmark: 200 tests / 30 files PASS; harness chạy độc lập: 1 test PASS.
- Typecheck, lint, production build và secret scan PASS.
- Còn cần live p95/Telegram callback latency, voice capture save latency, CPU/quota và thiết bị thật sau deploy; đây là nghiệm thu vận hành, không phải bằng chứng local.
