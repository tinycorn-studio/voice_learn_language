# 22 — Kết quả sửa review Antigravity (M5-05)

Ngày 2026-10-12, branch `fix/M5-05-review-fixes`. Phạm vi: sửa R01–R09 của [review M5-04](21_IMPLEMENTATION_REVIEW.md), kiểm chứng local; chưa deploy hoặc nghiệm thu tài khoản/thiết bị thật.

| Lỗi | Thay đổi                                                                                                                                 | Bằng chứng tự động                                                                                            |
| --- | ---------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------- |
| R01 | App tạo session thật: unlock audio, AudioWorklet PCM16/16kHz, mint token, WebSocket setup, phát PCM đúng rate, interruption/Stop cleanup | `browser-audio-session.test.ts`, `voice-session.test.ts`, `tests/app-flow.test.tsx`                           |
| R02 | Bỏ sample/RAM-only CRUD; Telegram auth, phân trang API, lưu/sửa/xóa/ôn qua Worker/GAS; chỉ saved khi có ack, retry cùng event            | `tests/app-flow.test.tsx`: mất response sau commit, retry đúng một Words/Events; edit/review/mount lại/delete |
| R03 | Dedup update chỉ sau thành công; pending cùng isolate dùng một promise, GAS Events bảo vệ retry qua isolate mới                          | `tests/review-regressions.test.ts`: lỗi GAS lần đầu → retry → replay Worker mới, chỉ một Reviews              |
| R04 | Claim rồi mới send/finish; sent có message_id, failed retry tối đa ba, timeout unknown không tự resend; Cron tick 08:00–08:05            | `tests/review-regressions.test.ts`: 503, backoff, budget, timeout, `/pause` thật                              |
| R05 | PATCH/DELETE/preferences/review lưu fingerprint và snapshot; retry cùng event trả kết quả cũ                                             | `tests/review-regressions.test.ts`: PATCH sau mutation mới, payload conflict, DELETE retry sau restore        |
| R06 | Validate complete proposed row và unique key trước khi ghi bất kỳ field nào                                                              | `tests/review-regressions.test.ts`: collision không thay đổi Words                                            |
| R07 | Reconnect unexpected close/goAway, bounded backoff, resumption/token renewal, Stop hủy timer/token race                                  | `gemini-live-client.test.ts`, `voice-session.test.ts`                                                         |
| R08 | CSV parse record xuyên newline/quote/CRLF/BOM, kiểm header/count/enum/number/date, giữ formula escape                                    | `csv.test.ts`: roundtrip đúng một row, reject malformed/NaN/negative/out-of-range/date                        |
| R09 | Source excerpt phải trùng transcript user, target trực tiếp phải khớp; dịch Việt → Anh dùng quy tắc riêng; mơ hồ yêu cầu làm rõ          | `detector.test.ts`, `gemini-live-client.test.ts`                                                              |

Bổ sung version vào keyboard mới để không chấm lại thẻ stale; review retry giữ nguyên version/event khi response bị mất. Schema v2 append header được test chạy hai lần không thay dữ liệu cũ. Worker kiểm response schema Apps Script/Gemini/Telegram và có timeout cho upstream.

## Kiểm tra local

- `npm run typecheck`: workspace và cả root integration tests theo TS strict.
- `npm run lint`: workspace source và `tests/`.
- `npm test`: 12 files, 55 tests; test fixtures dùng dữ liệu synthetic.
- `npm run build`: shared/Worker typecheck và production Vite web bundle.
- `wrangler deploy --dry-run --config apps/worker/wrangler.toml --outdir .artifacts/worker`: bundle Worker thành công, không deploy.
- `npm run check:secrets`, `git diff --check`: kiểm secret/whitespace trước bàn giao.

## Giới hạn và bước nghiệm thu

Mic/AudioContext/WebSocket/Gemini token/Telegram trong tests là mocks; Apps Script chạy trong VM với Sheets giả, không mô phỏng transaction hay concurrency dịch vụ thật. M1-02/M1-03/M3-04/M4-04/M5-02 vẫn cần QA theo tiêu chí ban đầu. CSV parser đã sửa, nhưng chưa có màn hình/endpoint restore toàn bộ backup. Pending queue chỉ giữ trong phiên hiện tại; UI yêu cầu retry trước khi đóng. Auth hiện yêu cầu Telegram Mini App; không có bypass cho web ngoài Telegram.

Chưa xác minh model/quota của project thật, OAuth, CORS production, HTTPS AudioWorklet và hành vi background/iOS. Rate limit mint token ở memory theo isolate, chưa phải giới hạn toàn cục. ScriptLock không đảm bảo ACID khi lỗi giữa các writes/tabs; xem ADR-007. Digest unknown cần đối chiếu thủ công, không tuyên bố exactly-once Telegram.

Bước tiếp: cấu hình M0-02/M3-01, backup và [migrate Sheet v2](05_APPS_SCRIPT_SETUP.md), staging deploy được cho phép, rồi chạy microphone → Gemini → đúng một Sheet row; retry không trùng; Telegram nhắc/trả lời cập nhật lịch. Kiểm PC/Android/iOS, mất mạng/mic denied/Stop/background trước production. Giữ deployment cũ và backup để rollback.
