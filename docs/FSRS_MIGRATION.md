# FSRS — Migration và vận hành schema v3

M5-06 kiểm thử migration bằng Apps Script VM local. Chưa chạy Google Sheet thật, chưa clasp push/redeploy. Các thao tác dịch vụ dưới đây cần chủ dự án xác nhận.

## Chuẩn bị

1. Tạm dừng writers (Worker/Bot/Cron). Ghi revision Worker và deployment/version GAS đang dùng.
2. Tạo bản sao toàn bộ Spreadsheet, xác nhận đủ tabs và số dòng; giữ ngoài Sheet hoạt động.
3. Theo 05_APPS_SCRIPT_SETUP.md, clasp pull vào thư mục backup riêng rồi diff với apps-script/; không pull đè source Git, không push force.
4. Kiểm tra SHEET_ID, owner và quyền staging; không ghi secrets vào log/Git.

## Dry-run và apply

Gọi **public wrapper** `migrateSchemaV3(true)`. Hàm nội bộ `migrateSchemaV3_(ss, isDryRun)` cần Spreadsheet, không gọi bằng một boolean. Có thể tạo helper tạm trong bản staging để chạy từ Editor:

```javascript
function inspectMigration() {
  console.log(JSON.stringify(migrateSchemaV3(true)));
}
function applyMigration() {
  console.log(JSON.stringify(migrateSchemaV3(false)));
}
```

- Dry-run trả `{ migrated_cards: N, status: 'DRY_RUN' }`: N là số Words chưa xóa/chưa có bất kỳ Card nào. Không đổi tabs, header, rows hoặc Script Properties.
- Apply giữ ScriptLock, tạo Cards/Settings, append header thiếu của Cards, Settings, Reviews, Events và DailyDispatchLog; nâng trực tiếp layout v1/v2. Thành công trả `{ migrated_cards: N, status: 'APPLIED' }`, đặt SCHEMA_VERSION=3.
- Chạy lại không tạo default Card cho Word đã có Card; không ghi đè Card hiện có.
- Settings không tự tạo dòng mặc định. Không có dòng/trường trống thì Worker dùng defaults tập trung trong fsrs-engine.ts.

## Bảo toàn dữ liệu cũ

Word chưa có Card sinh `c_<word_id>` loại default. Giữ due, repetitions, interval/version cũ và suspended; bỏ Word đã xóa; lưu nguyên Word vào legacy_snapshot_json.

SM-2 cũ không chứa memory model FSRS đáng tin cậy. Migration đặt state=New, stability/difficulty=0; lần đánh giá thật tiếp theo gọi thư viện chính thức khởi tạo memory. Đây là cold start có chủ đích, có thể đổi lịch dài hạn sau lần đánh giá đó. Không ước tính stability từ interval. Metadata not-yet-scheduled được thay bằng revision thư viện/tham số thật sau khi Worker lập lịch.

Dual-read bao gồm Words chưa có Card ngay cả khi Cards điền một phần; GET không tạo dòng. Ghi review vẫn yêu cầu **header v3 đầy đủ**, phải migrate trước khi mở writers; không tuyên bố ghi an toàn vào schema v1 chưa nâng cấp.

## Nghiệm thu staging

1. Đối chiếu Card mới, owner/word, due và suspended; dry-run lần hai N=0.
2. Preview bốn ratings; review tăng đúng Card.row_version, có native log/snapshot trước/sau.
3. Retry cùng event/payload chỉ một Review; đổi rating/version trên cùng event trả 409. Hai events cùng Card version chỉ một được chấp nhận.
4. Hai Card của một Word ôn độc lập; sửa Word không làm stale Card. Review Again vào Relearning, Hard không tăng lapses.
5. Kiểm Telegram callback Card ID, badges phút, thống kê qua 00:00 UTC+7 trên PC/Android/iOS.
6. Sau gate và xác nhận mới push/version/redeploy GAS/Worker. Clasp push riêng không cập nhật Web App deployment.

## Rollback và ghi dở

Giữ tabs/lịch sử v3 khi rollback code. **Không xóa Cards/Settings/cột Reviews** vì có thể có review mới. Backup trạng thái hiện tại, đối chiếu Reviews/Events với pre-v3 trước khi restore; restore có thể mất thay đổi sau backup và phải được xác nhận.

ScriptLock tuần tự hóa writers; Sheets không có transaction xuyên tabs. Review tồn tại thiếu Events snapshot trả 409, cần đối chiếu previous_card_json, next_card_json, versions và backup; không replay từ Word hiện tại. Bảo đảm transaction tại mọi điểm crash cần storage có transaction trong task riêng.

Events bản FSRS thử nghiệm trước M5-06 có fingerprint khác; replay có thể conflict. Đối chiếu thủ công, không đổi event ID rồi chấm lại để vượt conflict.
