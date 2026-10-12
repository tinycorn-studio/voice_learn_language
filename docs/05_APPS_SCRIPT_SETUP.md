# 05 — Google Sheets + Google Apps Script + CLASP (quản lý code từ PC/AI agent)

> Đây là hướng dẫn quan trọng nhất cho yêu cầu **auto modify Apps Script**. Script code trong repo là source of truth. `clasp` hỗ trợ push/pull/version/redeploy. Có **ủy quyền OAuth** ban đầu; các tools không được tự tạo/login account nếu chưa được cấp phép.

## A. Chuẩn bị Google Sheet
1. Google Drive → New → Google Sheets → đặt tên `VoiceChatLearnLanguage`.
2. Sao chép `Spreadsheet ID`: phần giữa `/d/` và `/edit` trong URL.
3. Tạo tabs theo `docs/09_DATA_SCHEMA.md` (tối thiểu `Words`, `Events`, `Reviews`, `Users`, `DailyDispatchLog`). Dán header mỗi tab từ docs. Xem `apps-script/Code.gs` starter: hiện mới có `vocabulary.upsert`, chưa có SRS/reviews.
4. Chỉnh timezone spreadsheet `Asia/Ho_Chi_Minh`; lưu timestamps dạng UTC ISO8601 để không lệch ngày.
5. Giữ file **private**, chỉ cho account sở hữu script truy cập, không publish công khai.

## B. Tạo Apps Script project
1. Mở https://script.google.com/home → `New project` → tên `VoiceChatLearnLanguage`.
2. `Project Settings` → copy **Script ID** (khác Spreadsheet ID).
3. https://script.google.com/home/usersettings → bật **Google Apps Script API**. Nếu tài khoản Workspace bị hạn chế, cần admin hỗ trợ.
4. Install Node LTS 20+ và clasp (theo official docs):
```powershell
npm install -g @google/clasp
clasp --version
clasp login
```
5. Chuyển vào code folder (đã có `Code.gs`, `appsscript.json`):
```powershell
Set-Location 'D:\Games\Projects\VoiceChatLearnLanguage\apps-script'
# File này chứa Script ID mapping, được gitignore để tránh nhầm project
'{"scriptId":"PUT_YOUR_SCRIPT_ID_HERE","rootDir":"."}' | Set-Content -Encoding utf8 .clasp.json
# SỬA PUT_YOUR_SCRIPT_ID_HERE trước khi chạy tiếp
clasp status
```
6. Để tránh ghi đè một project có sẵn code, **backup trước** bằng `clasp pull` trong thư mục sạch/temp với `.clasp.json` phù hợp, rồi diff với local; chỉ `clasp push` khi đã xác nhận đúng Script ID và local code là bản cần giữ. Dự án mới hoàn toàn có thể push trực tiếp.
7. `clasp push` đồng bộ code lên project; `clasp open-script` để xem trong editor.

```powershell
clasp push
clasp open-script
```
8. Manifest trong repo `apps-script/appsscript.json` khai báo scope Spreadsheet theo nhu cầu. Một số OAuth consent sẽ xuất hiện lần đầu script chạy/deploy.

## C. Cấu hình Script Properties (KHÔNG COMMIT)
Apps Script Editor → Project Settings → Script Properties → Add properties:
- `SHEET_ID`: ID Spreadsheet tạo ở A.
- `GAS_SHARED_SECRET`: ngẫu nhiên đủ mạnh, cùng giá trị với Worker secret.
- `OWNER_USER_ID`: định danh owner chính xác dạng `telegram:<numeric_user_id>` (ví dụ minh họa `telegram:123456789`), phải trùng `event.user_id` do Worker tự tạo **sau khi xác thực Telegram initData**; KHÔNG tin ID do client tự gửi. Lấy numeric ID từ sự kiện `/start`/`message.from.id` của bot đã xác thực (hoặc `initData` đã kiểm tra chữ ký) rồi cấu hình thủ công lần đầu.
- `MAX_EVENT_AGE_SECONDS`: `300`.

Không lưu các giá trị thật trong `appsscript.json`, `Code.gs`, `PROGRESS.md`, CI log hoặc repo. Apps Script Script Properties **không phải secret manager độc lập cho môi trường đa tenant**; quyền sửa script có thể đọc được chúng.

## D. Web app deployment: lần đầu và phiên bản mới
### Lần đầu (manual permissions)
1. Trong Apps Script editor: Deploy → New deployment → Type **Web app**.
2. Execute as **Me** (account sở hữu dữ liệu Sheet).
3. Who has access: **Anyone** nếu request đi từ Worker thông qua HMAC body (không thể tin chỉ vào URL/public access). Cảnh báo: đây là public HTTPS endpoint được bảo vệ ở **tầng ứng dụng**; không thực hiện bước này cho đến khi `Code.gs` đã kiểm tra HMAC đúng.
4. Authorize scopes; ghi lại `Web app URL` dạng `https://script.google.com/macros/s/.../exec` trong Worker secret `GAS_EXEC_URL`.
5. **Apps Script không có HTTP status tùy ý giống Node**, Worker cần kiểm tra JSON body `{ok:true|false}` và timeout, không chỉ HTTP 200.

### Sau mỗi lần AI agent sửa Apps Script
```powershell
Set-Location 'D:\Games\Projects\VoiceChatLearnLanguage\apps-script'
clasp status
clasp push                 # cập nhật HEAD, không tự đổi published URL/deployment version
clasp version "M3-02 validated HMAC upsert"
clasp deployments          # xem deployment ID + version hiện hành
# xem: clasp redeploy <DEPLOYMENT_ID> <VERSION_NUMBER> "M3-02"
```
CLI `clasp redeploy` chỉ thực hiện khi đã review diff, test và xác minh deployment id. Lưu version/deployment id (không phải credential) trong `PROGRESS.md` evidence. Trước publish vào production, giữ bản deployment trước để rollback.

**Rất quan trọng:** Không dùng `clasp push --force` mặc định. Nếu chỉnh Apps Script trên web editor sau khi đã quản lý bằng Git, code local và cloud có thể diverge; `clasp pull` + diff trước khi push. Quy ước: không sửa prod editor thủ công trừ incident khẩn; sửa rồi phải pull và commit.

## E. Tự động sửa Apps Script bằng AI / IDE
- **Chuẩn miễn phí đề xuất:** Git + `@google/clasp` CLI + VS Code/Rider + coding agent; agent sửa `apps-script/*.gs` như file thường, chạy local lint/tests với mock Apps Script services, sau đó gọi `clasp push`/version khi bạn cho phép. Không cần plugin bên thứ ba để auto modify.
- **Nếu muốn dùng CI/CD:** GitHub Actions chạy lint/test với `npm ci`, `clasp push`/deploy chỉ khi merge main và được approve. Credentials cần đặt trong encrypted secrets của CI; `.clasprc.json` chứa OAuth refresh token quyền mạnh. Hạn chế quyền repo, rotate token và không echo logs; xem `docs/18_CI_CD.md`.
- **Nếu dùng MCP server/IDE extension hỗ trợ Apps Script:** kiểm tra chính xác provider, scopes, quyền sửa/triển khai, bảo mật trước khi dùng. Không phải công cụ bắt buộc; `clasp` đủ nhu cầu tự động sửa source.
- Không tự động đụng production chỉ từ yêu cầu chat không có quyền truy cập máy và Google account.

## F. Data access / HMAC protocol
Worker gửi:
```json
{
  "payload": "{\"action\":\"vocabulary.upsert\",\"event_id\":\"...\",\"issued_at\":\"2026-10-12T02:00:00Z\",\"user_id\":\"...\",\"data\":{\"word\":\"overwhelmed\",\"meaning_vi\":\"quá tải\"}}",
  "signature": "BASE64URL(HMAC_SHA256(GAS_SHARED_SECRET, UTF8(payload)))"
}
```
Apps Script dùng `Utilities.computeHmacSha256Signature` verify chữ ký trên **chính xác** chuỗi `payload`; parse sau khi verify, check timestamp <=300s và event id chưa tồn tại, ScriptLock cho upsert. Ngăn kẻ lạ POST tùy tiện vào Web App đang public.
- `issued_at` phải timezone UTC; request quá cũ hoặc tương lai bị reject.
- Event ID duplicate trả thành công `duplicate:true` mà không tăng count.
- Nếu Google Sheets chứa công thức, mọi text external phải được escape để không biến thành formula.
- Không dùng `doGet` tiết lộ bảng; chỉ phản hồi dữ liệu đã validate và đúng quyền owner.

## G. Starter status / những gì CHƯA có
`apps-script/Code.gs` có `doPost` bảo vệ bằng HMAC và `vocabulary.upsert` + Events. Cần test/thẩm định trước triển khai production. Chưa hiện thực `vocabulary.list/search/edit/delete`, `reviews`, daily reminder `claim`.

## H. Troubleshooting
- `Script API is not enabled`: bật https://script.google.com/home/usersettings và đăng nhập lại.
- `No valid credentials`: `clasp login`; kiểm tra đúng Google account.
- `Push succeeded but web app unchanged`: đã push HEAD nhưng chưa `clasp redeploy` đến version mới.
- `Permission denied`: scope spreadsheet/editor/owner; cấp quyền Google lần đầu trong editor.
- `Invalid signature`: Worker/GAS secret khác nhau; payload stringify lại sau ký; base64url padding/sắp xếp; clock skew; cần đối chiếu test vectors.
- `Too many calls`/thời gian thực thi: batch update/cache, quota Apps Script. Sheets không dành cho write-heavy app.

## Official references
https://developers.google.com/apps-script/guides/clasp
https://developers.google.com/apps-script/guides/web
https://developers.google.com/apps-script/guides/services/quotas
https://developers.google.com/apps-script/reference/lock/lock-service
https://developers.google.com/apps-script/reference/properties/properties-service
