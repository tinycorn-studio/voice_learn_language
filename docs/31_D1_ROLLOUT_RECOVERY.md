# M7-11 — Phục hồi rollout D1 sau audit, 14/10/2026

## Trạng thái

IN_PROGRESS: dữ liệu đã phục hồi, GAS/Worker/Pages đã deploy; chờ ACK Cron thật, CI và Git merge. M7-10 vẫn chờ nghiệm thu thiết bị/vận hành, không đánh dấu toàn milestone hoàn tất.

Cập nhật 14:21: Cron cấu hình đúng nhưng chưa fire sau hơn 15 phút; không có scheduled log/attempt để quy lỗi cho processor. M7-11 bổ sung `waitUntil(processSheetMirror)` sau API mutation commit/Telegram webhook thành công: một job, cùng durable lease/idempotency, không chờ Google trước HTTP response. Cron giữ vai trò retry; việc Cloudflare phát sinh invocation được theo dõi riêng M7-10, không giả đánh dấu Cron pass. Candidate đã đạt typecheck/lint/build/secret/diff và **181 tests/28 files**; chờ CI/deploy/Worker ACK trước đóng M7-11.

## Nguyên nhân

Audit 13:34 +07 phát hiện Worker dùng D1 nhưng dữ liệu Sheet thật chưa import: một Word bị ẩn thuộc owner khác, không Reviews/migration_runs; sáu mirror jobs pending/attempts=0. Cron chỉ chạy 08:00–08:05, GAS v5 chưa có mirror handlers, Pages vẫn M5-12. Các báo cáo health/401/repository synthetic không đủ nghiệm thu cutover.

## Phục hồi dữ liệu

- Backup GAS HEAD riêng và diff business code với main trước push; manifest/scopes không đổi. Bản backup setup chứa literal đã được redacted; không chạy runQuickSetup, không force push. GAS v6 tạo trước push nhưng chưa deploy; source cập nhật thực sự nằm ở v7.
- Full D1 SQL backup `.artifacts/M7-11/prod-before-recovery.sql`; Time Travel bookmark `00000003-00000000-00005104-a6e92355b1d73f5bfccd43d4943ce988`. Các file raw/signed/snapshot/credentials giữ private dưới `.artifacts`, không Git.
- Freeze D1 và GAS writers; export hai lần bảy tabs trong cùng freeze, headers/rows/freeze ID khớp. Source: **1 Word, 1 Card, 1 Review, 4 Events, 0 Settings, 1 User, 0 DailyDispatchLog**; quarantine trống.
- D1 chưa có record của owner nguồn. Import INSERT-only theo owner, bảo toàn IDs, Card memory/due, native review audit và Events/replay. `migration_runs=verified`, canonical hashes/ID sets khớp, `quick_check`/FK đạt. Hash/count mọi record thuộc owner khác trước/sau giữ nguyên.
- Opt-in scoped recovery có regression test; mặc định migration CLI/library vẫn strict toàn DB. Không xóa/ghi đè dữ liệu owner khác. Sáu outbox thuộc owner cũ được giữ payload/audit nhưng chuyển `dead`, `last_error=foreign_owner_preserved`, không gửi vào Sheet người dùng; chỉ requeue khi đã xác minh đúng owner/target.
- Signed `migration.enableMirror` yêu cầu current freeze ID, epoch hợp lệ và không đổi epoch đã chọn. GAS `DATA_AUTHORITY=d1`, `MIRROR_ENABLED=true`, epoch `prod_cutover_01`; legacy writers giữ khóa. D1 đã mở lại ghi và xác minh `writes_enabled=true`.

## Bản đã triển khai

- GAS Web App deployment hiện hữu nâng lên **v7**, source Git `apps-script/Code.gs`. Không đổi URL/OAuth scopes.
- Worker **71a97fbc-5847-4fa9-a416-4abd2174cdd9**, DB `voice-learn-prod-db`, epoch `prod_cutover_01`; Cron `* * * * *` đã xác minh qua schedule API. Mỗi tick xử lý một mirror event/một Telegram delivery; digest chỉ trong 08:00–08:05 +07, processor failure độc lập.
- Pages production **470bed2e**: `index-BEIrwtmL.js`, build **M7-11-20261014**, hash URL chính khớp artifact. Project dùng nhánh **production**; deployment `01e9412a` trên main chỉ là Preview, không được tính production.
- Health Worker 200. Startup 10 ms là thời gian khởi động, không phải request CPU.

## Kiểm chứng

- Typecheck/lint/build/Worker dry-run/secret scan/diff check đạt; **180 tests/28 files** với `npx vitest run --maxWorkers=2`. Lần baseline workers mặc định gặp timeout cold-start workerd; không đổi timeout hoặc bỏ assertion để vượt gate.
- API production bằng operator session HMAC TTL 30 phút, không giả kết quả đăng nhập Telegram thật: từ cũ xuất hiện; synthetic create 240 ms, create replay 122 ms; preview 114 ms; Good 209 ms, retry 129 ms; delete 209 ms. Đây là một chuỗi kiểm thử từ máy vận hành, không phải p50/p95 hoặc số đo UI/CPU.
- Cùng event create trả duplicate; cùng event review chỉ có **1 Review**, cùng review ID; due đổi, reps=1, state Learning, có previous/next card/state, versions và native review_log_json. Từ thử được soft-delete, audit append-only giữ nguyên; từ thật không bị chấm lại.
- Read-only preview trên thẻ thật đã phục hồi trả đủ `again/hard/good/easy`, không chấm lại thẻ. Năm GET vocabulary warm bổ sung đều 200 (388/107/111/127/110 ms), chỉ là smoke nhỏ.
- Tail runtime của bảy requests đọc/preview: outcome `ok`, không exception, CPU lần lượt 13/11/8/2/2/2/2 ms. Warm đọc nhỏ đạt 2 ms, hai spike đầu vượt con số Free 10 ms nhưng được runtime chấp nhận; chưa đo create/review/callback/scheduled ở tải thật và không coi đây là quota/CPU nghiệm thu đầy đủ.
- Git commit `0495df0` đã push; [PR #1](https://github.com/tinycorn-studio/voice_learn_language/pull/1). [CI 38526193769](https://github.com/tinycorn-studio/voice_learn_language/actions/runs/38526193769) SUCCESS cho head này, gồm typecheck/lint/test/build. Chờ ACK Cron trước đóng task/merge; docs tiếp theo phải qua CI tại head mới.
- Hàng đợi thử có ba jobs create/review/delete để kiểm ACK mirror thật. Ghi kết quả Cron/Sheet và CI/Git bên dưới khi xác minh xong.
- Trong lúc Cron propagate, operator ký batch ba immutable jobs thử và gọi GAS `mirror.applyBatch`: ACK đủ ba event IDs. Không đổi `sync_outbox.status` bằng tay. Export lại bảy tabs Sheet sau apply → canonical verify với D1 đạt: **2 Words, 2 Cards, 2 Reviews, 7 Events, 1 User**, quarantine trống, mismatches trống, integrity=true; các số tăng gồm từ thử đã ẩn và audit thử. Cron sẽ replay/ACK các jobs này để kiểm đường tự động riêng.

## Còn lại và rollback

- M7-10: người dùng mở lại Mini App hỏi nghĩa → kiểm Saved nhanh; Telegram /review → mở đáp án/Good, kiểm due/Review, callback ACK/latency thực tế. QA iOS/Android/Desktop, direct/recovery voice, Google outage/recovery, restore target riêng và runtime CPU/quota/p95 còn thiếu bằng chứng; không coi local suite là QA thiết bị.
- Người dùng trả lời **“Chưa thử được”** trong phiên M7-11; không suy ra human QA pass. [Cloudflare Cron docs](https://developers.cloudflare.com/workers/configuration/cron-triggers/) nêu propagation có thể tới 15 phút. [Workers limits](https://developers.cloudflare.com/workers/platform/limits/) hiện nêu Free CPU 10 ms/request và Cron, startup 1 giây; có flexibility cho spike. Không dùng wall time, startup hoặc timing REST thay CPU, không tự nâng plan/ngân sách.
- Rollback code Worker về `fcf0c1dc-9925-4b06-b6cb-5d5e1a6cab15` vẫn giữ D1; bản đó có Cron cũ nên phải giữ lịch mỗi phút hoặc xử lý outbox bằng operator đã review. Pages cũ `ae4031d8-7eab-467e-bf79-811f8ac6f051`. GAS v5 không hiểu mirror; không rollback GAS đơn lẻ khi mirror còn bật.
- Không flip authority về GAS hoặc restore SQL đè D1 đang nhận writes mới. Rollback dữ liệu cần freeze/backup mới, đối chiếu delta và restore target riêng theo docs/29_D1_MIGRATION_RUNBOOK.md. Giữ backup private; không đưa file raw vào PR.
