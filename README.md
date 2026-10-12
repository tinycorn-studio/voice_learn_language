# VoiceChatLearnLanguage

> BỘ KẾ HOẠCH VÀ TÀI LIỆU TRIỂN KHAI — 12/10/2026 (UTC+7)  
> **Trạng thái:** documentation/planning; chưa kết nối tài khoản thật, chưa có sản phẩm hoạt động.  
> **Đường dẫn đích Windows:** `D:\Profile\VoiceChatLearnLanguage`

## Mục tiêu
Ứng dụng luyện hội thoại tiếng Anh bằng giọng nói sử dụng Gemini Live API, tự nhận diện yêu cầu học từ (vd. *What does overwhelmed mean?*), ghi từ vào Google Sheets qua Apps Script, và ôn tập bằng Telegram Bot/Telegram Mini App với Spaced Repetition. Ưu tiên free tier, không tự vận hành VPS hay máy tính 24/7, bảo mật và dễ duy trì qua nhiều phiên coding-agent.

## Mức độ sẵn sàng
- ✅ Bộ tài liệu, quy tắc làm việc, tiến trình, kịch bản setup, Apps Script starter được chuẩn bị.
- ⬜ Chưa setup Google, Cloudflare, Telegram; chưa cung cấp API key/token.
- ⬜ Chưa hiện thực frontend, Worker, Telegram, SRS hay tích hợp end-to-end.
- ⚠️ Giá, quota, tên model và lệnh CLI có thể đổi; kiểm tra tài liệu nguồn trước mỗi đợt triển khai.

## Công nghệ dự kiến
- `React + TypeScript (strict) + Vite` cho web/PWA và Telegram Mini App (dùng **một codebase** + environment adapter).
- `Gemini Live API` giọng nói realtime; model đề xuất `gemini-3.8-live` **nếu đang được mở cho project ở Free Tier**; token tạm thời cấp bởi Worker.
- `Cloudflare Workers` cho API, xác thực Telegram, webhook, scheduler; có thể dùng Cloudflare Pages/Workers Static Assets để host web.
- `Google Apps Script + Google Sheets` làm nguồn dữ liệu giai đoạn MVP; **clasp** quản lý code Apps Script từ repo.
- `Telegram Bot` nhắc ôn + inline quiz; `Telegram Mini App` cho flashcard, thống kê và voice chat.
- `Vitest + ESLint + Prettier + TypeScript`, Git, CI lint/test/build; không dùng n8n, Anki là tùy chọn sau MVP.

## Đọc tài liệu theo thứ tự
1. [AGENTS.md](AGENTS.md): **quy tắc bắt buộc** cho lập trình viên và AI agent.
2. [PROGRESS.md](PROGRESS.md): điểm tiếp nối và trạng thái của dự án (**đọc trước mỗi phiên**).
3. [docs/00_PRODUCT_SCOPE.md](docs/00_PRODUCT_SCOPE.md): phạm vi/luồng sử dụng.
4. [docs/01_ARCHITECTURE.md](docs/01_ARCHITECTURE.md): kiến trúc và luồng dữ liệu.
5. [docs/13_MILESTONES.md](docs/13_MILESTONES.md): roadmap, tiêu chí nghiệm thu.
6. [docs/03_SETUP_WINDOWS.md](docs/03_SETUP_WINDOWS.md): cài đặt Windows từ đầu.
7. Tài liệu tích hợp: [Gemini](docs/04_GEMINI_SETUP.md), [Apps Script](docs/05_APPS_SCRIPT_SETUP.md), [Cloudflare](docs/06_CLOUDFLARE_SETUP.md), [Telegram](docs/07_TELEGRAM_SETUP.md).
8. [docs/19_AGENT_WORKFLOW.md](docs/19_AGENT_WORKFLOW.md): quy trình hoàn thành task, update tiến độ.

## Cấu trúc sau khi triển khai
```text
VoiceChatLearnLanguage/
  AGENTS.md                  # Rules cho AI coding agent
  PROGRESS.md                # Nguồn trạng thái duy nhất; checklist ID task
  CHANGELOG.md               # Lịch sử thay đổi
  README.md
  docs/                      # Specifications, runbooks, milestone, ADR
  apps-script/               # Mã Google Apps Script có thể push bằng clasp
  scripts/                   # PowerShell tự động mở/đóng phiên
  apps/web/                  # SẼ TẠO M1: React/Vite Mini App/PWA
  apps/worker/               # SẼ TẠO M2: Cloudflare Worker TypeScript
  packages/shared/           # SẼ TẠO M2: Zod schema/types dùng chung
  tests/                     # SẼ TẠO dần: integration/e2e fixtures
  .github/workflows/         # SẼ TẠO M2: lint/test/build CI
```
Không tạo sẵn `apps/web` rỗng vì CLI khởi tạo Vite có thể từ chối ghi đè thư mục không trống.

## Khởi động nhanh (Windows PowerShell)
```powershell
# Sau khi giải nén gói vào D:\Profile\VoiceChatLearnLanguage
Set-Location 'D:\Profile\VoiceChatLearnLanguage'
Get-Content .\PROGRESS.md
.\scripts\Start-Session.ps1
# làm lần lượt theo docs/03_SETUP_WINDOWS.md và docs/13_MILESTONES.md
```
Nếu PowerShell không cho chạy script, dùng `powershell -ExecutionPolicy Bypass -File .\scripts\Start-Session.ps1` cho phiên chạy đó; không cần thay đổi policy toàn hệ thống.

## Chốt yêu cầu sản phẩm
- 1 người dùng giai đoạn đầu; tài khoản Telegram là định danh production; không thu âm toàn bộ hội thoại lên Sheets.
- Lưu từ theo ý định rõ ràng; chặn từ trùng (lemma + loại từ + nghĩa), giữ ngữ cảnh; hỗ trợ hỏi “What does that mean?” dựa trên lượt ngay trước.
- Từ mới phải lưu ngay cả khi Telegram/Anki không hoạt động (chưa cần Anki).
- 1 bộ từ theo timezone `Asia/Ho_Chi_Minh` (UTC+7), sự kiện lưu thời gian UTC ISO8601.
- SRS MVP với Again/Hard/Good/Easy; trạng thái và thuật toán mô tả trong `docs/16_SRS.md`.

## Lưu ý thực tế
Đây là **bộ quy hoạch và scaffold** — không tuyên bố đã triển khai chạy thật. Mọi key, id, URL phải tự cấu hình; không commit credential thật. Chi phí $0 chỉ đúng nếu usage nằm trong quota Free Tier; xem `docs/17_COSTS_AND_LIMITS.md`.
