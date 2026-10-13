# VoiceChatLearnLanguage

> BỘ KẾ HOẠCH VÀ TÀI LIỆU TRIỂN KHAI — 12/10/2026 (UTC+7)  
> **Trạng thái:** web/Worker/Apps Script đã triển khai; voice/auth/vocabulary được người dùng xác nhận. Frontend M5-12 bổ sung capture và FSRS UI đã public; luồng hỏi nghĩa → Sheet/Card → review cùng các gate vận hành còn chờ live QA. Xem `PROGRESS.md` và `docs/26_VOCABULARY_CAPTURE_RELEASE.md`.
> **Đường dẫn đích Windows:** `D:\Profile\VoiceChatLearnLanguage`

## Mục tiêu

Ứng dụng luyện hội thoại tiếng Anh bằng giọng nói sử dụng Gemini Live API, tự nhận diện yêu cầu học từ (vd. _What does overwhelmed mean?_), ghi từ vào Google Sheets qua Apps Script, và ôn tập bằng Telegram Bot/Telegram Mini App với Spaced Repetition. Ưu tiên free tier, không tự vận hành VPS hay máy tính 24/7, bảo mật và dễ duy trì qua nhiều phiên coding-agent.

## Mức độ sẵn sàng

- ✅ Bộ tài liệu, quy tắc làm việc (`AGENTS.md`), tiến trình (`PROGRESS.md`), kịch bản setup đã khởi tạo.
- ✅ Source đã sửa R01–R09 theo review M5-04, có tests hồi quy và tích hợp App → Worker → Apps Script VM. Bằng chứng/giới hạn trong [báo cáo sửa lỗi](docs/22_REVIEW_FIXES.md):
  - `packages/shared`: Zod contracts, bộ phát hiện từ vựng (`detectVocabularyIntent` đạt 30/30 mẫu câu 0 FP / 0 FN), bộ lập lịch SRS (`Again/Hard/Good/Easy`), xuất/nhập CSV, chống formula injection.
  - `apps/web`: đăng nhập Telegram qua Worker, dữ liệu API thật, PCM AudioWorklet → Gemini trực tiếp → playback, reconnect có budget/Stop; Flashcards và CRUD lưu backend rồi mới báo thành công. Không có dữ liệu mẫu; mở ngoài Mini App chưa được xác thực.
  - `apps/worker`: xác thực Telegram `initData`, ephemeral token `uses:1`, HMAC Apps Script, webhook retry và Cron `0-5 1 * * *` (08:00–08:05 UTC+7) với tối đa ba send attempts khi lỗi xác định.
  - `apps-script/Code.gs`: HMAC, `LockService`, mutation replay/unique key; schema v3 Words/Cards/Reviews/Settings. FSRS có lịch từng Card độc lập, preview backend, retry/OCC và native audit; xem [review FSRS](docs/23_FSRS_REVIEW_FIXES.md).
- ⬜ Chờ cấu hình tài khoản & khoá bí mật thật (`M0-02`, `M3-01`) để chạy nghiệm thu thiết bị thật & triển khai production (`M1-02`, `M5`).
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
  scripts/                   # PowerShell tự động mở/đóng phiên & quét secret
  apps/web/                  # React/Vite Mini App/PWA (Voice, Flashcards, Vocab)
  apps/worker/               # Cloudflare Worker TypeScript (Auth, Token, Webhook, Cron)
  packages/shared/           # Zod schema, intent detector, SRS engine, CSV utils
  tests/                     # Integration/E2E tests (Worker <-> Apps Script VM harness)
  .github/workflows/         # CI gate (typecheck, lint, test, build)
```

## Khởi động nhanh (Windows PowerShell)

```powershell
# Sau khi giải nén gói vào D:\Profile\VoiceChatLearnLanguage
Set-Location 'D:\Profile\VoiceChatLearnLanguage'
Get-Content .\PROGRESS.md
.\scripts\Start-Session.ps1
# làm lần lượt theo docs/03_SETUP_WINDOWS.md và docs/13_MILESTONES.md
```

Nếu PowerShell không cho chạy script, dùng `powershell -ExecutionPolicy Bypass -File .\scripts\Start-Session.ps1` cho phiên chạy đó; không cần thay đổi policy toàn hệ thống.

Frontend đọc `VITE_API_BASE_URL` từ `.env.local` ở root (copy `.env.example`, chỉ public vars). Worker giữ secret riêng theo docs setup. `npm run build` tạo web assets; kiểm bundle Worker riêng bằng `wrangler deploy --dry-run --config apps/worker/wrangler.toml --outdir .artifacts/worker`. Lệnh dry-run không triển khai. Sheet hiện có cần backup và `migrateSchemaV3(true/false)` theo [runbook FSRS](docs/FSRS_MIGRATION.md) trước khi mở writers của Worker mới.

## Chốt yêu cầu sản phẩm

- 1 người dùng giai đoạn đầu; tài khoản Telegram là định danh production; không thu âm toàn bộ hội thoại lên Sheets.
- Lưu từ theo ý định rõ ràng; chặn từ trùng (lemma + loại từ + nghĩa), giữ ngữ cảnh; hỗ trợ hỏi “What does that mean?” dựa trên lượt ngay trước.
- Từ mới phải lưu ngay cả khi Telegram/Anki không hoạt động (chưa cần Anki).
- 1 bộ từ theo timezone `Asia/Ho_Chi_Minh` (UTC+7), sự kiện lưu thời gian UTC ISO8601.
- Thuật toán **FSRS Spaced Repetition** hiện đại chuẩn Anki sử dụng thư viện chính thức `ts-fsrs` (`^5.4.2`), tách biệt thực thể `Words`, `Cards`, `Reviews` (Schema v3). Xem [docs/FSRS_ENGINE.md](docs/FSRS_ENGINE.md), [docs/FSRS_MIGRATION.md](docs/FSRS_MIGRATION.md), [docs/FSRS_TEST_PLAN.md](docs/FSRS_TEST_PLAN.md), và [docs/16_SRS.md](docs/16_SRS.md).

## Lưu ý thực tế

Source đã kiểm thử local; nghiệm thu dịch vụ thật vẫn chờ cấu hình. Mọi key, id, URL phải tự cấu hình; không commit credential thật. Chi phí $0 chỉ đúng nếu usage nằm trong quota Free Tier; xem `docs/17_COSTS_AND_LIMITS.md`.
