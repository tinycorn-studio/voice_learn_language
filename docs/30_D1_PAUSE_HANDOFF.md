# Bàn giao tạm dừng sau M7-07 — 14/10/2026

> Tài liệu lịch sử tại điểm dừng M7-07. Người dùng đã yêu cầu tiếp tục; trạng thái mới nhất tại PROGRESS.md và docs/31_D1_ROLLOUT_RECOVERY.md. Không dùng các trạng thái production/Git bên dưới làm trạng thái hiện tại.

**Yêu cầu người dùng:** hoàn thiện M7-07 rồi tạm dừng do quota; lưu đủ thông tin để phiên sau tiếp tục. Không tự chạy M7-08, tạo automation, tài nguyên remote, deploy/push/merge trong lúc tạm dừng.

## Điểm tiếp nối

- Repository: `D:\Profile\VoiceChatLearnLanguage`; branch **feat/M7-07-data-migration**. Commit cuối xem `git log -1` (commit task này chứa luôn file bàn giao).
- M7-01–M7-07 **DONE LOCAL**. M7-08–M7-10 chưa làm. Production vẫn GAS, chưa có migration/cutover D1.
- M7-05 commit `ad9019f`: durable Telegram updates/deliveries, commands, legacy keyboards, retry/unknown/ordering và digest transactional mirror.
- M7-06 commit `111c5c9`: signed one-way Sheet mirror, lease/version/epoch/backoff/dead-letter/rebuild; config mirror=false.
- Trước đó M7-04 `2f7a099`, M7-03 `cda4e06`, M7-02 `0abc5c7`, M7-01 `0e9f63e`; WIP `ec9c0e6` đã được hoàn thiện M7-05, không quay lại WIP này.
- Lần kiểm remote Git 14/10: main `adf0aea`, các nhánh M7 chỉ local, chưa push/merge. Đọc lại remote nếu tiếp tục; không reset/overwrite khi có thay đổi khác.

## Đã triển khai và kiểm chứng local

| Task | Đầu ra chính | Evidence |
| --- | --- | --- |
| M7-01 | Capture/API/GAS diagnostics, privacy, synthetic baseline | 139 tests + baseline riêng |
| M7-02 | Tool ACK sau save, refresh nền coalesce, Telegram ACK trước write | 143 tests |
| M7-03 | D1 schema, factory HTTP/Bot/Cron, SQL guards/FK/Reviews immutable | 146 tests, workerd D1 |
| M7-04 | D1 CRUD/FSRS/native audit/Settings/stats, atomic Events/outbox, legacy HMAC replay | 152 tests |
| M7-05 | Commands/delivery recovery, update dedup, digest claimed/sent/failed/unknown | 162 tests |
| M7-06 | D1 → GAS mirror, partial write/lost ACK/version/lease/epoch, frozen rebuild | 169 tests |
| M7-07 | Seven-tab freeze/export/checksum/quarantine, idempotent import/verify/checkpoints, reverse restore, CLI | **177 tests/28 files** |

Gate cuối M7-07: typecheck/lint/build/Worker dry-run và secret/diff checks. Artifacts private `.artifacts/M7-07/`: `tests.log`, `migration-tests.log`, `synthetic-snapshot.json`, `cli-final-dry-run.json`, `cli-final-import.json`, `cli-final-verify.json`, `worker/`. CLI verify ok/integrity=true/mismatches=[]; synthetic counts 1 Word, 2 Cards, 1 Review, 3 Events, 1 Settings, 1 User, 1 Dispatch. Không dùng fixtures làm dữ liệu thật.

Sửa regression trong phiên: optional Telegram callback type; SQL lease chống edit cùng message; GAS writers kiểm freeze bên trong lock; checksum reseal bỏ checksum cũ; bulk workerd migration test timeout riêng 15 giây; mirror fixture setup trước chuyển authority d1. Các tests cũ vẫn pass.

## Trạng thái production và quyền truy cập

Lần kiểm read-only 14/10 trước tạm dừng:

- Frontend `https://voice-chat-learn-language.pages.dev`, asset `index-C2NMt0rU.js` = release M5-12, Pages deployment `ae4031d8-7eab-467e-bf79-811f8ac6f051`.
- Worker active **e07a24e2-5aeb-4aae-93cb-c6be6a79aa1d**, deployment `63ab0051-18f1-41cc-9f06-27902cae6280`, 100%; GAS Web App **v5**. M7 chưa deploy.
- `apps/worker/wrangler.toml`: DATA_BACKEND=gas, SHEET_MIRROR_ENABLED=false; Cron `0-5 1 * * *` (08:00–08:05 UTC+7). Staging config vẫn gas/mirror=false, crons=[]; chưa gắn DB.
- D1 inventory từng trả Authentication error 10000 dù token có d1(write). **14/10 lúc khoảng 08:28 đã chạy thành công, trả []**. Không kết luận nguyên nhân, không tự login/rotate credentials nếu chưa cần. Chưa tạo database remote nào trong đợt này.
- CLI migration cần GAS env credentials/owner và Cloudflare API token cho remote; chưa xác minh/nạp credentials migration local hoặc lấy snapshot thật. Không trích secret ra chat/log/Git; không đổi GAS_SHARED_SECRET vì còn dùng cho Events HMAC/session compatibility.
- Clasp có auth staging riêng trong `.artifacts/clasp-staging/.clasprc.json`, mapping project `.clasp.json` ignored. Dùng đường dẫn tuyệt đối `-A` và `-P`; backup pull ở thư mục riêng và redact remote setup literals trước diff. Không in remote Code.js/diff thô; không force push, không chạy runQuickSetup.

## M7-08 — công việc cần làm khi người dùng yêu cầu tiếp tục

1. Chạy Start-Session, đọc AGENTS/README/PROGRESS/docs13/plan27/evidence28/runbook29/file này; kiểm git status/log/diff. Tạo branch task M7-08 và đánh dấu IN_PROGRESS trước code/thao tác task.
2. Xác minh lại API/quota tài liệu chính thức D1/Workers/Google/Telegram, account Free và D1 auth. Không nâng Paid hoặc thêm Queues/R2/DO. Tạo DB staging riêng trong Free khi scope/quyền rõ; ghi database ID/binding/config và dùng ba SQL migrations 0001–0003.
3. **Chứng minh REST batch thật atomic** bằng synthetic insert + SQL guard fail và đọc lại không có row, rồi owner/FK/unique/append-only/OCC checks. Adapter scripts/lib/d1-api-binding.ts hiện mới mock-tested; nếu API không như kỳ vọng, sửa/chuyển sang Worker D1 binding, chưa import thật.
4. Chuẩn bị GAS staging Sheet/project riêng và source candidate. Pull backup remote HEAD/deployed v5 trước push; review source khác biệt sau redact, version/redeploy đúng endpoint. Candidate dùng cùng Spreadsheet/Lock/Properties scopes, không cần Drive/OAuth scope mới. Không đẩy code vào production để “thử”.
5. Diễn tập synthetic end-to-end: freeze → seven-tab export → dry-run không quarantine → import D1 staging frozen → verify full hashes/IDs/FKs → reverse restore sang GAS target riêng → export/verify lại. Chạy CLI thực tế, không chỉ VM. Preserve null/optional fields, Settings defaults, dispatch unknown và legacy Events HMAC.
6. Lấy snapshot dữ liệu thật chỉ khi endpoint/credentials/owner/freeze window đã rõ và có backup được review. Trước final freeze cần xử lý toàn bộ writer và Sheet direct edits. Missing headers/legacy audit/hash/duplicate/orphans là blocker; không tự xóa/gộp hoặc đoán FSRS. Rerun dùng cùng file manifest; fresh snapshot cần run/target phù hợp.
7. Shadow compare read-only cùng owner/now/limit/sort: vocabulary, due, stats, preview cả Again/Hard/Good/Easy. Test independent Cards, old Word keyboard, stale version, duplicate update, concurrent ratings, lost ACK và crash recovery trên DB staging riêng; không chấm hai kho production.
8. Đo >=30 baseline rồi >=50 candidate create/review samples, p50/p95/max; auth/DB/FSRS/refresh/Gemini/Telegram tách chặng. Kiểm Worker Free CPU và subrequest budget thật, indexed query plans/rows read-written và dung lượng; synthetic VM timing không là số mạng.
9. Fault injection GAS timeout/503: API và Telegram vẫn dùng D1; mirror backlog/retry/dead-letter/lag/rebuild và restart. Hiện Cron candidate chỉ xử lý 1 mirror event + 1 Telegram delivery mỗi tick; foreground Telegram drain tối đa 3. Đo backlog bursts, nếu lag p95 >5 phút thì tối ưu batch/budget có tests trước tăng; không hứa throughput đã đạt.
10. Ghi staging versions/manifest hashes/restore evidence/benchmark/risk vào PROGRESS/evidence; chạy CI/gates và chỉ đóng M7-08 khi đạt tiêu chí thật.

Mục tiêu dự kiến chưa đo: backend p95 ≤800 ms, valid tool→saved ≤1,5 s, callback ACK p95 ≤1 s, mirror healthy p95 ≤5 phút. D1 không làm nhanh Gemini inference/tool emission. Telegram không có fencing token, cần fault test edit timeout/late arrival qua lease 30 giây; không suy ordering tuyệt đối từ local test.

## M7-09 — cutover production sau staging

1. Chuẩn bị artifact Worker/Pages/GAS, config D1 binding/epoch và rollback code **giữ D1**, full SQL backup/bookmark + full Sheet manifest. Review concrete package và xác nhận deploy/cutover theo AGENTS; không xin duyệt khi artifact/gates chưa có.
2. Freeze/drain HTTP/Bot/Cron/GAS writers, dừng direct Sheet edits, chốt final snapshot hai lượt và đối chiếu hashes. Telegram updates chưa commit không được mark processed/drop. Import/verify production D1 frozen; chưa mở writes khi còn mismatch/quarantine.
3. Mọi HTTP/Bot/Cron cùng factory D1, DATA_BACKEND=d1; không fallback GAS. Giữ secret/model/origin/session compatibility. Chọn source_epoch/MIRROR_EPOCH/SHEET_MIRROR_EPOCH khớp; GAS DATA_AUTHORITY=d1 chặn legacy writes.
4. Deploy đúng artifact, xác minh actual binding/backend/schema/version/100% traffic; mở D1 writes có chủ đích, real save/review/retry/old keyboard, kiểm Word/Card/Review/Event/outbox và due. Bật mirror và Cron mỗi phút sau smoke.
5. Trước D1 write đầu tiên có thể rollback GAS snapshot. Sau D1 writes chỉ rollback code tương thích D1; muốn quay GAS phải freeze/export/reverse restore/verify đủ dữ liệu mới nhất. Mirror lag không là backup.

## M7-10 — nghiệm thu/bàn giao còn thiếu

- Người dùng chấm Good thật trên Telegram/Mini App; đối chiếu Card next_due, native Reviews snapshots, Events và mirror ACK.
- Mirror outage/recovery trên service thật; quota/CPU/rows/storage growth, backup SQL/Time Travel và restore vào DB tách biệt. Không xóa Reviews/Events để tiết kiệm quota.
- PC/Android/iOS Telegram: capture direct/recovery, retry/dedup, audio/reconnect, UI saved/error, card/preview/rating/stats. Ghi rõ thiết bị chưa có evidence.
- Quan sát 24–48 giờ chỉ khi người dùng yêu cầu tiếp tục/monitor; không tự tạo automation trong trạng thái tạm dừng.
- Push/CI/merge vào main là bước còn lại; xem lại yêu cầu/quyền Git lúc tiếp tục. Không merge candidate thiếu staging/production QA chỉ vì local tests pass.

## Các việc ngoài phạm vi đợt D1

CSV import/restore UI, Settings/day limits UI và áp daily limit vào study queue, quota alert/backup vận hành rộng hơn còn pending. M5-12 mới xác nhận save Sheet và /review hiện, chưa có live Good/Reviews/due. Optional Anki/phát âm/ôn trong hội thoại thuộc M6, không tự kéo vào M7. Chi tiết từng ID ở PROGRESS.

## Lệnh bắt đầu phiên sau

```powershell
Set-Location D:\Profile\VoiceChatLearnLanguage
.\scripts\Start-Session.ps1
git status --short
git log -10 --oneline
Get-Content docs/30_D1_PAUSE_HANDOFF.md
# Chỉ bắt đầu M7-08 khi người dùng yêu cầu tiếp tục; hiện đã tạm dừng.
```

Runbook thao tác/CLI: docs/29_D1_MIGRATION_RUNBOOK.md. Plan: docs/27_D1_PERFORMANCE_MIGRATION_PLAN.md. Evidence: docs/28_D1_IMPLEMENTATION_EVIDENCE.md. Không chạy lại cả suite nếu chỉ đọc trạng thái; khi code/config đổi thì chạy checks phù hợp và gate bắt buộc trước hoàn thành/deploy.
