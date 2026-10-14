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

## M7-04 — 13/10/2026, local

- D1 adapter dùng chung vocabulary/review; Word/Card/Event/outbox atomic, native ts-fsrs audit, replay trước đọc mutable state, Card OCC, owner/active guards. CRUD giữ corrections/unique sense/soft-delete và snapshot replay; Settings validate và UTC+7 stats.
- **152 tests/25 files PASS**, lint/Worker dry-run PASS; D1 integration kiểm crash giữa audit insert rollback, hai events cùng version chỉ một thắng, cùng event đồng thời trả một result, Hard không lapse/Again Relearning, Card độc lập và legacy GAS HMAC Event replay qua cutover. Production chưa đổi.
- D1 read-only inventory Cloudflare bị **Authentication error 10000**. Không tạo database remote hoặc đổi OAuth trong bước này; tiếp tục local M7-05–M7-07, staging/cutover M7-08/M7-09 cần quyền D1 sau khi candidate đủ review.
- Digest/delivery durable hoàn thiện ở M7-05; Sheet processor/Migration ở M7-06/M7-07. `.artifacts/M7-04/`.

## M7-05 — 14/10/2026, local

- Telegram review/preferences lưu Events, domain mutation, update dedup, result delivery và mirror outbox trong cùng D1 batch. `/review` lưu durable command trước HTTP 200; retry qua SecurityStateStore mới không nhân review/delivery. Keyboard Word ID cũ vẫn resolve được.
- Delivery bounded ba jobs/lượt, lease 30 giây; SQL CAS ngăn hai isolates edit cùng message đồng thời, revision cũ superseded. Edit retry idempotent; send mất ACK hoặc send lease hết hạn thành dead/unknown_outcome, không tự gửi lại. Poison payload dead-letter riêng, definite failures tối đa ba lần có backoff.
- Digest claim/finish có OCC + maintenance guard + atomic outbox, version tăng từng transition. Claimed quá hai phút chuyển unknown; sent/unknown không retry, failed backoff tối đa ba. Pause guard kiểm preferences snapshot ngay trong transaction; finish replay không tạo thêm outbox, stale token/status conflict.
- 10 integration tests trên workerd D1 local PASS; full suite **162 tests/26 files PASS**, typecheck/lint/build/Worker dry-run/secret scan/diff PASS. Fixture retry được sửa để truyền SecurityStateStore mới bằng tham số thứ tư; đã chạy lại đủ 10 test sau sửa fixture. Artifacts `.artifacts/M7-05/`.
- Cloudflare `d1 list --json` đã thành công và trả `[]` ngày 14/10; lỗi 10000 trước đó hiện không tái hiện, chưa kết luận nguyên nhân. Chưa tạo DB remote hoặc deploy M7; config production vẫn GAS/Cron cũ. Cron mỗi phút chỉ bật ở staging/cutover sau mirror/migration gates.
- Telegram không hỗ trợ fencing token cho edit: lease lớn hơn HTTP timeout giúp serialize lượt đang chạy; trường hợp request ngoại vi đến rất muộn sau timeout vẫn cần kiểm chứng trong staging. Không coi local suite là SLA mạng hoặc nghiệm thu thiết bị thật.

## M7-06 — 14/10/2026, local

- Cron D1 drain một Telegram job và một mirror event/tick, bounded Free subrequests; mirror event gồm nhiều entity snapshots, HMAC fresh timestamp, owner/epoch/body validation. Global durable lease + job CAS, backoff/jitter, tối đa tám attempts, permanent conflicts dead-letter; explicit requeue và queue health age/count không xuất nội dung.
- GAS mirror dưới ScriptLock, preflight cả batch trước writes; metadata `_mirror_version/_mirror_json/_mirror_epoch` ghi cùng range với row. Older versions ACK/skip; same-version different snapshot/epoch/immutable audit conflict. Partial cross-tab write hoặc lost ACK replay sửa nốt, không thêm Reviews/Events trùng. Formula injection được escape ở cells, snapshot canonical JSON giữ nguyên.
- Mirror chỉ bật khi GAS DATA_AUTHORITY=d1/MIRROR_ENABLED=true/MIRROR_EPOCH khớp Worker và D1 source_epoch. Legacy business writers bị chặn khi authority d1. Production config vẫn gas/mirror=false, source GAS chưa push/redeploy.
- Frozen rebuild duyệt đủ bảy entity tables, deterministic content jobs/checkpoints qua unique IDs, rerun không nhân outbox; dead jobs không bị xóa. Đây là operator tool local, không gọi rebuild toàn DB trong Cron/HTTP request Free.
- **169 tests/27 files PASS**, typecheck/lint/build/Worker dry-run PASS, thêm bảy workerd D1 ↔ GAS VM fault-injection tests. `.artifacts/M7-06/`. Remote Google/D1 staging, throughput/mirror p95 và Free CPU còn M7-08; chưa coi tests synthetic là nghiệm thu production.

## M7-07 — 14/10/2026, local, tạm dừng sau task theo yêu cầu

- Signed freeze/export/restore GAS: lock drain và writer recheck bên trong lock, đủ bảy tabs/page 50, stable headers/count/freeze metadata, raw/canonical checksums; không dùng Words CSV thay full backup. Freeze ID cũ bị chặn; setup/schema mutations cũng tôn trọng maintenance.
- CLI PowerShell/Node có local/remote tách rõ, mutations yêu cầu --apply, private outputs chỉ dưới .artifacts; secret dùng process env, không in data/signed body/upstream lỗi. Remote D1 REST batch adapter mới mock-tested, real transaction gate M7-08.
- Plan validate numeric/boolean/date/owner/IDs/keys/FK/native audit/replay contracts; quarantine chặn import và giữ raw backup. Legacy missing Cards chỉ materialize explicit bằng official factory, preserve due/counts/suspended/archive; không reset Card có memory.
- Import INSERT-only/chunks 20 + maintenance guard/checkpoint, rerun skip IDs/verify exact full hashes; conflict không overwrite, không mở writes. Verify ID sets/canonical rows mọi bảng theo pages 50 + quick_check/FK. Imported Events giữ HMAC/result và review không bị chấm lại, outbox chưa phát sinh do import.
- Reverse D1 export → GAS target riêng/frozen, canonical _snapshot_json giữ null/optional fields; restore replay không duplicate. Unfreeze GAS xóa transient metadata, backup file giữ nguyên; edit sau restore vẫn export/validate được. Full SQL backup operational tables vẫn cần trước production rollback.
- **177 tests/28 files PASS**, gồm tám migration tests; typecheck/lint/build/Worker dry-run PASS. CLI help/dry-run/persistent local import/verify PASS, integrity=true/mismatches=[]; fixture 1 Word/2 Cards/1 Review/3 Events/1 Settings/1 User/1 Dispatch. Artifacts .artifacts/M7-07; secret/diff gates ghi PROGRESS.
- Chưa tạo D1 remote, nạp dữ liệu thật hoặc push/redeploy GAS/Worker/Pages. Production GAS giữ nguyên. Runbook docs/29_D1_MIGRATION_RUNBOOK.md; toàn bộ việc M7-08–M7-10/Git/QA còn lại ở **docs/30_D1_PAUSE_HANDOFF.md**. Không tự tiếp tục M7-08 trong lúc tạm dừng.

## M7-08 — 14/10/2026, Cloudflare D1 Remote Staging Rehearsal & Benchmark

- Khởi tạo database D1 staging riêng trên Cloudflare Free Tier: `voice-learn-staging-db` (ID `a8306e2e-f3ee-4e43-a6c1-07739dfffc26`, APAC).
- Áp dụng đầy đủ ba SQL migrations qua Wrangler remote: `0001_d1_primary.sql`, `0002_telegram_message_lease.sql`, `0003_sync_processor_lease.sql`. Cấu hình binding `DB` trong `apps/worker/wrangler.toml`, giữ `DATA_BACKEND=gas` cho production.
- **Chứng minh tính nguyên tử và ràng buộc trên remote D1 thật** (`.artifacts/M7-08/prove-d1-atomic-remote.mjs`):
  - Batch transaction rollback nguyên tử: Câu lệnh vi phạm `CHECK(valid=1)` trên `mutation_guards` khiến toàn bộ batch bị hủy, số dòng ghi vào DB sau rollback là 0.
  - Foreign key: Bị từ chối khi chèn Card có `word_id` không tồn tại.
  - Append-only reviews: Trigger `reviews_immutable_update` và `reviews_immutable_delete` chặn cả UPDATE lẫn DELETE với lỗi `Reviews are append-only`.
  - Unique constraint: Chặn chèn trùng `words.word_key`.
- **Nâng cấp Cloudflare REST Batch Adapter** (`scripts/lib/d1-api-binding.ts`):
  - Chuẩn hóa khoảng trắng bên ngoài chuỗi nháy đơn (`renderSql`), loại bỏ ký tự newline thừa, ngăn chặn Cloudflare WAF chặn HTTP 403 do multiline query.
  - Bổ sung chi tiết mã lỗi HTTP status và error text khi API Cloudflare từ chối.
- **Diễn tập synthetic end-to-end trên D1 remote**:
  - `dry-run` thẩm định snapshot synthetic: 0 dòng quarantine.
  - Target freeze: Đặt `system_state.writes_enabled='false'` trước khi import.
  - `d1-import --remote --apply`: Import thành công 7 tabs dữ liệu synthetic.
  - `d1-verify --remote`: Xác minh 100% tính toàn vẹn hash, ID và khóa ngoại (`{"integrity":true,"mismatches":[],"ok":true}`).
  - `d1-export --remote`: Xuất ngược dữ liệu từ D1 remote ra file `.artifacts/M7-08/staging-synthetic-export.json`, bảo toàn canonical `_snapshot_json` và cơ chế bảo vệ chủ sở hữu (`owner_id: telegram:123`).
  - `dry-run` validate lại file snapshot xuất từ D1: 100% hợp lệ, 0 quarantine.
- **Benchmark hiệu năng thực tế trên Cloudflare D1 Remote (50 samples create + 50 samples review)**:
  - Create Word (Word + 2 Cards + Event + Outbox): min 478 ms, avg 522 ms, **p50 504 ms**, **p90 578 ms**, **p95 590 ms**, max 779 ms (Mục tiêu plan: ≤ 800 ms -> **ĐẠT**).
  - Review Submission (Card update + FSRS rating + Review + Outbox): min 479 ms, avg 517 ms, **p50 507 ms**, **p90 559 ms**, **p95 598 ms**, max 617 ms (Mục tiêu plan: ≤ 800 ms -> **ĐẠT**).
  - Read Latency: `listVocabulary` (20 items) 156 ms, `listDueReviews` 267 ms, `getReviewStats` 171 ms, `previewReview` 154 ms.
  - Thời gian xử lý thuần trên D1: ~150–200 ms/transaction (7–12 rows read, 13–20 rows written).
- **Shadow parity check**:
  - Indexed Query Plans (EXPLAIN QUERY PLAN): Tận dụng triệt để index `words_owner_created`, `cards_due`, `reviews_owner_time`, `outbox_ready`.
  - FSRS 4 buttons preview (Again, Hard, Good, Easy) tính toán chuẩn xác với thư viện `@open-spaced-repetition/ts-fsrs`.
  - Idempotent replay: Replay cùng `event_id` trả đúng kết quả `duplicate_event=true` mà không tạo bản ghi mới.
  - OCC conflict guard: Update với stale version bị từ chối với lỗi `409 CONFLICT`.
  - Fault injection / Outbox decoupling: 352 events xếp hàng an toàn trong `sync_outbox` khi chưa có kết nối mirror, các transaction create/review hoàn tất độc lập với Google/Telegram.
- **Artifacts**: Lưu trữ bảo mật tại `.artifacts/M7-08/`: `remote-benchmark-report.json`, `staging-synthetic-export.json`, `staging-export-validation.json`, `staging-synthetic-import.json`, `staging-synthetic-verify.json`, `synthetic-dry-run.json`.
- **Workspace gates**: `typecheck`, `lint`, `test` (177/177 tests), `build`, `Check-Secrets.ps1` đều PASS 100%. Không commit lên Git theo yêu cầu người dùng.

