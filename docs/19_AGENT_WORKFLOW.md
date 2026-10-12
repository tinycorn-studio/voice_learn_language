# 19 — Tiếp tục dự án qua nhiều phiên ChatGPT/Codex/Cursor/Rider

## Cách vận hành
`PROGRESS.md` là file trạng thái trung tâm. `AGENTS.md` là quy tắc bắt buộc. AI agent mới chỉ cần đọc 4 file đầu (`README`, `AGENTS`, `PROGRESS`, `Milestones`) rồi xem code/diff liên quan.

## Đầu mỗi phiên
1. `scripts/Start-Session.ps1` in ngày, git status, next task, blocker.
2. Xác nhận `PROGRESS.md` là thật (không đánh dấu DONE khi chưa code/test).
3. Chọn Task ID nhỏ nhất chưa hoàn thành mà dependency đã đạt; không nhảy vào task blocked.
4. Đọc docs của tính năng và upstream API docs mới; ghi task STARTED vào mục `Đang thực hiện` (một agent một task).
5. Chạy baseline tests, xem local changes trước khi chỉnh sửa.

## Trong phiên
- Implement chỉ theo phạm vi Task ID; có code + test + docs liên quan.
- Nếu thay đổi source Apps Script, dùng clasp chỉ trên project dev/staging (cẩn trọng scriptId). Push không có nghĩa WebApp đã publish.
- Nếu API thay đổi, update contract/data schema/security/ADR.
- Khi chặn: ghi `Blockers` cụ thể, tạm dừng, không tạo fake success.

## Sau khi task đạt DoD
Dùng PowerShell script cập nhật tự động:
```powershell
.\scripts\Complete-Task.ps1 -TaskId M1-01 `
  -Evidence 'npm run typecheck/lint/test/build pass; files apps/web/...; commit abc123' `
  -Next 'M1-02: microphone + Gemini Live streaming'
```
Script sẽ:
- đổi đúng dòng checklist task từ `[ ]` sang `[x]` trong `PROGRESS.md` (không sửa task khác);
- cập nhật `Updated`, `Đang thực hiện`, `Next action`;
- thêm dòng activity/evidence vào `PROGRESS.md` và `CHANGELOG.md`.

**Chỉ chạy sau khi test pass**. Nếu đang dở, đừng dùng script; điền status IN_PROGRESS và next command thủ công vào PROGRESS, commit sau.

## Khi phát hiện bug/task mới
- Thêm Task ID không trùng ở PROGRESS và docs milestone, ghi dependency, acceptance. Nếu là thay đổi kiến trúc quan trọng thì ADR.
- Tránh sửa các task đã đánh dấu done không ghi changelog. Nếu regression, tạo task FIX-XXX riêng.

## Mẫu prompt cho AI coding agent mới
```text
Bạn đang làm dự án VoiceChatLearnLanguage trong thư mục hiện tại.
Đọc README.md, AGENTS.md, PROGRESS.md, docs/13_MILESTONES.md trước khi làm.
Kiểm tra git status, xác định task chưa hoàn thành có thể làm tiếp và docs của task.
Chỉ implement phạm vi task; TypeScript strict, code dễ test, không expose secrets.
Chạy tests phù hợp và báo command + kết quả trung thực.
Nếu DONE, cập nhật PROGRESS.md và CHANGELOG.md (có Task ID, timestamp UTC+7, evidence, next action) trong cùng commit.
Nếu bị block, cập nhật status/blocker/next chính xác, không đánh dấu DONE.
Không tự deploy/đổi quyền/chạm credential production khi chưa được phép.
```

## Checklist tự review kết thúc phiên
- [ ] Files changed được tóm tắt.
- [ ] Test/build results chính xác (chưa chạy thì ghi chưa chạy).
- [ ] PROGRESS cập nhật + next action dễ thực hiện.
- [ ] CHANGELOG updated.
- [ ] Không có secrets trong Git/logs/screenshots.
- [ ] Nếu có remote deployment: environment/IDs/versions/rollback point recorded.
