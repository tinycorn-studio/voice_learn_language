# M8-10 — Log chẩn đoán theo nhu cầu

**Trạng thái:** DONE / USER_ACCEPTED — Pages Production đã phát hành, người dùng xác nhận thành công trên Telegram Mini App  
**Task ID:** M8-10  
**Branch:** `feat/M8-10-diagnostics-on-demand`  
**Ngày mở:** 2026-10-19 (UTC+7)

## Mục tiêu

Panel chẩn đoán kết nối không còn chiếm chỗ mặc định trên giao diện chính. Panel chỉ tự hiện khi có lỗi, và người dùng luôn có một nút nhỏ trên header để mở/đóng thủ công khi cần sao chép log.

## Vấn đề hiện tại

- `ApiDiagnosticsPanel` render khi có bất kỳ bản ghi nào, kể cả entry `OK` và startup stages; vì app ghi startup diagnostics ngay khi mở nên panel gần như luôn xuất hiện ở giao diện chính dù không có lỗi.
- Người dùng chỉ cần log khi gặp sự cố; panel thường trực gây nhiễu giao diện.

## Phạm vi

1. Panel chỉ render khi: có entry lỗi (`code !== 'OK'`) hoặc người dùng bấm nút "Chẩn đoán" trên header.
2. Lỗi mới với `request_id` khác sau khi người dùng đã đóng panel sẽ tự mở lại; bấm lại nút sẽ đóng.
3. Thêm nút toggle trên `app-header-actions` cạnh nút theme/info: icon `pulse`, 44px, có `aria-expanded`/`aria-controls`, `data-testid="diagnostics-toggle"`.
4. Bỏ `<details>` lồng bên trong panel; khi panel mở thì hiển thị đầy đủ mã lỗi gần nhất, bảng độ trễ, hành động và textarea log. Textarea giữ `aria-label="Log chẩn đoán"`.
5. Không đổi nội dung/giới hạn/privacy của log (memory-only, bounded), không đổi API/schema/Worker/D1/FSRS.

## Tiêu chí nghiệm thu

- Khi mọi request OK và chưa từng bấm nút: không có section chẩn đoán nào trên giao diện chính.
- Khi có entry lỗi: panel tự hiện kèm "Mã lỗi gần nhất" và "Mã đối chiếu"; nút "Kiểm tra kết nối"/"Sao chép log" dùng được ngay, không cần bấm mở trước.
- Nút "Chẩn đoán" mở được panel bất kỳ lúc nào kể cả khi không có lỗi; bấm lần nữa đóng; `aria-expanded` phản ánh trạng thái.
- Sau khi người dùng đóng panel, lỗi mới (`request_id` mới) tự mở lại.
- Nút theme/info, ba tab đáy và các hành vi hiện có giữ nguyên.
- Regression tests cho: ẩn mặc định, auto-hiện khi lỗi, toggle thủ công, đóng/mở lại theo lỗi mới; full suite, typecheck/lint/build/secret scan/Prettier/diff check pass.

## Ràng buộc và quyết định

- Chỉ thay đổi frontend `apps/web`; không thay API route, schema, Worker, D1 hay GAS.
- Trạng thái mở/đóng chỉ thuộc phiên hiện tại (state React), không lưu storage.
- Auto-open tính theo `request_id` của lỗi gần nhất; không auto mở lại chỉ vì entry `OK` mới.

## Kết quả local

- `npx vitest run apps/web/src/app/api-diagnostics-panel.test.tsx`: 8/8 PASS (2 test mới: ẩn khi `open=false` kể cả có log OK; đóng rồi tự mở lại khi request mới thất bại; 3 test cũ cập nhật bỏ thao tác mở `<details>` thủ công).
- Full suite `npx vitest run --maxWorkers=1 --minWorkers=1 --testTimeout=20000 --silent`: 240/240 tests, 39 files PASS. Lần chạy song song mặc định có 1 timeout flaky ở `tests/d1-migration.test.ts` (worker-side, không liên quan thay đổi frontend này) và pass khi chạy lại với cấu hình serial như trên.
- `npm run typecheck`, `npm run lint`, `npm run build`, `npm run check:secrets`, Prettier check trên các file thay đổi và `git diff --check` PASS.
- Hành vi mới: panel trả `null` khi `open=false`; App auto-set `diagnosticsOpen=true` khi `latestFailureId` (request_id của entry lỗi mới nhất) thay đổi; nút `diagnostics-toggle` trên header có `aria-expanded`/`aria-controls="diagnostics-panel"`; textarea log giữ nguyên `aria-label="Log chẩn đoán"`.

## Deploy

- Deploy Pages Production build `M8-10-20261019` bằng `wrangler pages deploy apps/web/dist --project-name voice-chat-learn-language --branch production --commit-dirty=true` (wrangler 4.149.0, xác nhận người dùng trước khi deploy).
- Deployment `c1430518-7647-4964-b8e5-73776896d50f`, environment Production, branch `production`, source HEAD `a759e6e` + dirty working tree. Unique URL `https://c1430518.voice-chat-learn-language.pages.dev` và canonical `https://voice-chat-learn-language.pages.dev/?v=M8-10-20261019` đều HTTP 200; HTML tham chiếu entry mới `index-DWUeEshb.js` + `index-CBusY0-5.css`.
- SHA256 public khớp local: entry JS `F49A7849C73286A5DCC9C378BC89F10CD9ECE11BFAFA7218DAFCEC97FB7335DE`; CSS `C36E96D57256DC03D473C33697BF30E020A4C3E977F5FB717A752E4E35226F64`; lazy Vocabulary `8DCDF267428FCAADADE76C611C3E7415310F3DEA5C0F86295731208EB91212F5`; lazy Review `626739EAD0DBFDD7B475F7D7951EB32743C97567E47C60E7BA774D6DE10A511D`. Bundle chứa nhãn `M8-10-20261019`.
- Rollback: deployment Production trước đó `cf3b57ac-104f-4059-b0ab-6de069c06cb6`. Worker/D1/GAS không đổi.
- Người dùng mở Mini App trong Telegram sau deploy và xác nhận thành công (2026-10-19, UTC+7): panel chẩn đoán ẩn mặc định, nút Chẩn đoán hoạt động như thiết kế.
