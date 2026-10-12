# FSRS — Kế hoạch kiểm thử

## Bằng chứng local M5-06

Baseline có 70 tests pass nhưng bộ hồi quy đầu tiên tái hiện 7 lỗi. Không dùng số tests cũ để kết luận an toàn. Bằng chứng sau sửa: [23_FSRS_REVIEW_FIXES.md](23_FSRS_REVIEW_FIXES.md).

| File                                        | Kiểm tra                                                                                                                                                                                                  |
| ------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| packages/shared/src/srs/fsrs-engine.test.ts | 9 fixtures: init, preview không mutate, Good/version, Hard, Again của Review, Cards độc lập, UTC, retention, Date                                                                                         |
| tests/fsrs-integration.test.ts              | 6 cases adapter ↔ GAS VM: create, preview, submit/replay, Hard, stats, migration lặp                                                                                                                      |
| tests/fsrs-regressions.test.ts              | 13 cases: Telegram Card ID, Relearning, Card version, changed payload, v1 dry-run, partial migration, Settings, UTC+7/deleted, replay sau delete, OCC, partial commit, native audit, cold start/suspended |
| FlashcardReviewPanel.test.tsx               | 5 cases: reveal, ACK/error, 1m/10m/Card version, preview thất bại                                                                                                                                         |
| tests/app-flow.test.tsx                     | 2 cases App/API: auth lỗi; flow hai Card cùng Word, sửa nghĩa, mất ACK/retry, remount/delete                                                                                                              |

Tests khác bảo vệ webhook/auth/HMAC, digest, voice/audio, vocabulary, detector/CSV. VM harness không chứng minh Google LockService ngoài thực tế; test cạnh tranh kiểm OCC logic qua hai requests.

## Gate

npm run typecheck, npm run lint, npm test, npm run build, Worker wrangler deploy --dry-run, scripts/Check-Secrets.ps1 và git diff --check. Bundle dry-run không deploy. Chỉ đóng task local sau khi chạy pass.

## Live QA còn chờ

- Backup/migrate staging v1/v2, chạy lại không trùng; đối chiếu snapshots/due cũ.
- Hai ratings đồng thời thật chỉ một được ghi; mất mạng sau commit/retry không nhân đôi.
- Review Again → Relearning, Hard không lapse; học lại sau 1 phút, badges và callback đúng thẻ.
- Qua nửa đêm UTC+7; deleted/suspended không nằm trong hàng ôn/thống kê active.
- PC/Android/iOS Telegram/Safari; Cron digest và restore backup.

Không ép interval/difficulty có thứ tự cứng cho mọi state; thư viện với input/config là chuẩn. Không suy luận Hard luôn tốt nghiệp Learning hoặc Again luôn tăng lapses.
