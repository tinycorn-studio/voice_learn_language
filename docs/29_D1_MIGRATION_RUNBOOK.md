# M7-07 — Công cụ migration và rollback D1

M7-07 hoàn thành local; M7-11 ngày 14/10/2026 đã export/import dữ liệu thật và deploy GAS v7. Trạng thái production mới nhất tại PROGRESS và docs/31_D1_ROLLOUT_RECOVERY.md; docs/30_D1_PAUSE_HANDOFF.md là điểm dừng lịch sử.

## Công cụ và an toàn dữ liệu

- `scripts/Invoke-D1Migration.ps1`: build CLI vào `.artifacts/M7-07/migrate.mjs`, chạy Node, lỗi có exit code khác 0.
- `scripts/lib/d1-migration.ts`: snapshot bảy tabs, SHA-256 toàn manifest/từng tab, validation/quarantine, import chunks và verify, reverse export/restore.
- `scripts/lib/d1-api-binding.ts`: prepared SQL escaping và Cloudflare REST batch adapter. Remote batch rollback phải được chứng minh trên staging M7-08, chưa suy từ mock.
- `apps-script/Code.gs`: signed `migration.freeze`, `migration.exportPage`, `migration.restoreBatch`, `migration.enableMirror`; source đã deploy v7 trong M7-11.
- Mọi output nằm trong `.artifacts/`, không commit snapshot/report có dữ liệu riêng tư. Terminal chỉ in trạng thái/counts; không in signed body/token/transcript hoặc JSON lỗi từ upstream. Lưu backup ra nơi riêng do chủ dự án quản lý trước cutover.
- Các mutation CLI cần `--apply`; D1 phải chọn rõ `--local` hoặc `--remote`. Import không mở writes, không tự chuyển DATA_BACKEND và không tự tạo tài nguyên remote.

## Local smoke đã chạy

```powershell
.\scripts\Invoke-D1Migration.ps1 help
.\scripts\Invoke-D1Migration.ps1 dry-run --input .artifacts/M7-07/synthetic-snapshot.json --output .artifacts/M7-07/cli-final-dry-run.json
.\scripts\Invoke-D1Migration.ps1 d1-import --local --apply --persist .artifacts/M7-07/cli-final-db --input .artifacts/M7-07/synthetic-snapshot.json --epoch cli_final --output .artifacts/M7-07/cli-final-import.json
.\scripts\Invoke-D1Migration.ps1 d1-verify --local --persist .artifacts/M7-07/cli-final-db --input .artifacts/M7-07/synthetic-snapshot.json --output .artifacts/M7-07/cli-final-verify.json
```

Kết quả verify `{ok:true,integrity:true,mismatches:[]}`. Snapshot synthetic có Words=1, Cards=2 độc lập, Reviews=1, Events=3, Settings=1, Users=1, Dispatch=1. Không dùng persist path này cho dữ liệu thật hoặc coi fixture là backup production. Rerun cùng manifest an toàn; manifest mới cần target/rehearsal riêng nếu dữ liệu target đã khác.

## Chuẩn bị nguồn GAS

1. Chỉ thực hiện sau khi candidate/rehearsal và quyền deploy đã rõ. Backup remote HEAD/deployed version bằng clasp trong thư mục riêng, redact secrets trước diff; không force push/runQuickSetup. Push source đã kiểm thử, tạo version và redeploy đúng Web App. Xem docs/05_APPS_SCRIPT_SETUP.md.
2. CLI cần process environment `GAS_EXEC_URL`, `GAS_SHARED_SECRET`, `OWNER_TELEGRAM_ID` dạng số. Nạp secret bằng phương thức riêng an toàn; không đưa vào command history/Git/chat. Đối chiếu owner/URL staging trước gọi; CLI cho phép URL HTTPS script.google.com, không tự lấy secret từ Cloudflare.
3. Xác minh đủ bảy tabs, header v3 và dữ liệu hiện tại. Không chạy setup/migration phá dữ liệu để vượt lỗi; layout legacy thiếu phải có backup và xử lý riêng trước final snapshot. Sheet chỉ xem/xuất sau cutover, không chỉnh tay trong lúc export.
4. Freeze có ScriptLock chung với mọi business writer và setup/schema migrations. Writer kiểm tra lại WRITES_ENABLED/DATA_AUTHORITY bên trong lock, nên request đã qua HMAC vẫn không lọt ghi sau freeze. Lock timeout là lỗi, không giả freeze thành công.

```powershell
.\scripts\Invoke-D1Migration.ps1 gas-freeze --apply --output .artifacts/migration/source-freeze.json
# Đọc freeze_id trong file private, giữ biến local; không cần đưa dữ liệu/token vào chat.
.\scripts\Invoke-D1Migration.ps1 gas-export --freeze-id $migrationFreezeId --output .artifacts/migration/final-snapshot.json
.\scripts\Invoke-D1Migration.ps1 dry-run --input .artifacts/migration/final-snapshot.json --output .artifacts/migration/validation.json
```

Export mỗi page tối đa 50 rows; header/count/freeze/schema metadata phải ổn định. Snapshot giữ raw headers/cells, bao gồm cột ngoài schema. Final cần export kiểm tra lần hai trong cùng freeze và so sánh **từng tab sha256** (exported_at khiến checksum toàn file khác). Chọn một file manifest bất biến cho import/resume; không thay file giữa chừng. App freeze không ngăn owner sửa Sheet bằng tay; tạm dừng mirror nếu export chính mirror Sheet, và kiểm hai lần để phát hiện drift.

Nếu hủy migration khi D1 chưa nhận write, mở GAS lại có chủ đích:

```powershell
.\scripts\Invoke-D1Migration.ps1 gas-unfreeze --apply --freeze-id $migrationFreezeId --output .artifacts/migration/source-unfreeze.json
```

Unfreeze từ chối freeze ID cũ hoặc DATA_AUTHORITY=d1. Khi mở GAS authority, transient `_snapshot_json/_mirror_*` được xóa khỏi cells dưới lock, giữ file backup đã verify; các lượt GAS ghi mới sau đó không bị metadata snapshot cũ che khuất.

## Validation và import

- Parse booleans true/false rõ ràng, numeric blank không biến thành 0; dates UTC, Word unique key, owner, ID, FK và duplicate review event. Telegram chat ID numeric được chuyển chuỗi khi safe integer.
- Giữ Word corrections/version, Card độc lập/memory/due/version, native audit trước/sau, Events hash/result và Settings/Users/dispatch. Native review snapshots phải khớp Card/Word/owner/version/due/state; logs có đầy đủ fields. Replay result phải đúng action contract; thiếu fingerprint/snapshot hoặc review Event thiếu audit là blocker.
- Quarantine chỉ ghi tab/row/reason trong report; raw row vẫn ở backup. Row=0 là lỗi quan hệ xuyên bảng; đọc snapshot private để đối chiếu. Không xóa/gộp dòng cho import pass.
- Word active thiếu Card mặc định bị chặn. Chỉ sau review mới thêm `--materialize-legacy-cards`: dùng official createInitialFsrsCard, state New/memory rỗng; giữ due/counts/interval/version/suspension và archive Word. Không reset Card FSRS hiện có hoặc viết công thức memory.
- Mirror/reverse JSON metadata giữ null/optional fields chính xác; nếu metadata khác displayed cells, quarantine thay vì âm thầm bỏ sửa tay.
- Import INSERT-only, không business upsert/review, không tạo lượt học/outbox. Chunks tối đa 20 statements có maintenance guard và durable checkpoint. Crash có thể để các chunks trước hoàn tất; chạy lại **cùng file** sẽ skip IDs hiện có, verify phát hiện mọi khác biệt. Không overwrite target để sửa conflict.
- Verify hash/ID set **mọi row** bảy bảng, pagination 50 rows/query, quick_check và foreign_key_check. Target có thừa/thiếu/khác dữ liệu là fail; writes vẫn false. Migration state chỉ verified sau toàn bộ gates; source_epoch chỉ đổi trong batch có freeze guard.

Remote staging: tạo DB/binding và apply ba SQL migrations bằng Wrangler sau kiểm Free/account. Freeze `system_state.writes_enabled=false` trước import. CLI cần `CLOUDFLARE_ACCOUNT_ID`, `CLOUDFLARE_API_TOKEN` trong process environment; giữ credential ngoài file output/chat. Dùng database ID staging đã xác minh:

```powershell
.\scripts\Invoke-D1Migration.ps1 d1-import --remote --apply --database-id $stagingDatabaseId --epoch $stagingEpoch --input .artifacts/migration/final-snapshot.json --output .artifacts/migration/staging-import.json
.\scripts\Invoke-D1Migration.ps1 d1-verify --remote --database-id $stagingDatabaseId --input .artifacts/migration/final-snapshot.json --output .artifacts/migration/staging-verify.json
```

Không chạy những lệnh remote mẫu vào production khi chưa qua M7-08/M7-09. Không bật writes chỉ vì import command exit 0; cần benchmark/parity/restore, artifact review và kiểm mọi entrypoint.

## Reverse migration / rollback

Trước D1 write đầu tiên có thể quay GAS snapshot đã freeze, sau kiểm không có event mới. Sau D1 writes, ưu tiên rollback code **giữ D1**. Nếu buộc quay GAS:

1. Freeze D1 writers, dừng/drain Bot/Cron/mirror; SQL export toàn DB/bookmark trước restore. Bảy-tab JSON phục vụ domain reverse migration, không thay full SQL backup các operational tables/outbox/deliveries.
2. `d1-export --local|--remote --database-id ... --freeze-id ... --frozen-at <UTC ISO> --output .artifacts/...json`, OWNER_TELEGRAM_ID trong env. Export không mở writes.
3. Chuẩn bị **GAS target riêng, trống và frozen**, DATA_AUTHORITY=gas; chưa mở cho người dùng. Nạp env target riêng. `gas-restore --apply --freeze-id <target ID> --input <D1 JSON>`. Header/row khác target trả conflict, không overwrite/xóa.
4. Restore bảo toàn canonical `_snapshot_json`; chạy lại không duplicate. Export target lại → planMigration/verify so với D1 frozen, đủ bảy bảng. Chỉ sau verify mới chuyển authority và unfreeze target. Nếu không xác định được send outcome, giữ dispatch unknown; không gửi lại để thử.
5. Sheet mirror đang lag hoặc Google hỏng không là lý do tự flip DATA_BACKEND sang GAS. Dead-letter cần sửa/requeue; rebuild M7-06 chạy operator ngoài Cron với D1 frozen và epoch/target được review.

## Bằng chứng và giới hạn

177 tests/28 files PASS; tám migration tests gồm pagination 51 rows, failed chunk resume, immutable audit, legacy materialization, cross-owner/invalid snapshot quarantine, replay HMAC/FSRS parity, differing target và reverse restore. CLI local help/dry-run/persistent import/verify pass; typecheck/lint/build/Worker dry-run/secret scan/diff gates ghi tại PROGRESS/evidence.

Remote API adapter mới chỉ mock-tested; GAS mới chỉ VM-tested. Chưa kiểm credentials/headers/data thật, remote rollback transaction, restored staging, CPU/quota/latency hoặc live devices. Những gate này bắt buộc M7-08–M7-10, không coi M7-07 local là production migration hoàn thành.
