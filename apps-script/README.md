# Apps Script starter — trạng thái DOC/EXAMPLE

`Code.gs` là **starter tối thiểu**, không phải backend hoàn chỉnh. Có HMAC validation, dedupe theo `event_id` và `vocabulary.upsert` cho MVP thử nghiệm; chưa có `reviews`, CRUD, cron digest, queue và full recovery. Trước production phải hoàn thành task M3, viết test với mock `SpreadsheetApp`, test concurrency và validate security.

Setup theo `../docs/05_APPS_SCRIPT_SETUP.md`. Sau khi liên kết đúng Google project với local `.clasp.json` (gitignored):
```powershell
clasp status
clasp push
clasp version "test signed upsert"
clasp deployments
# clasp redeploy <id> <version> "..." khi đã approve
```

**Script Properties** cần:
- `SHEET_ID`
- `GAS_SHARED_SECRET` (mạnh, giống Worker secret; không commit)
- `OWNER_USER_ID` (ví dụ `telegram:12345678` — set bằng user ID thật, không tin giá trị client)
- `MAX_EVENT_AGE_SECONDS` (vd 300)

Tab header `Words` và `Events` bắt buộc y hệt `docs/09_DATA_SCHEMA.md`. `doPost` **chỉ** chấp nhận signed envelope `{payload,signature}`. Không thử public trước khi HMAC đã được kiểm chứng end-to-end. Không gửi JSON unsigned trực tiếp tới Apps Script.

> NOTE: Apps Script `ContentService` trả HTTP 200 cả khi `{ok:false}`, Worker phải đọc và xác thực JSON `ok`.
