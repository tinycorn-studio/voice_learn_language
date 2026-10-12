# 03 — Setup từ đầu trên Windows 10/11

> Theo trình tự này. Đây là **hướng dẫn**, chưa thực thi tự động trên máy của bạn. Đừng dán API key/Telegram token vào chat, Git hoặc ảnh chụp màn hình.

## A. Giải nén, kiểm tra thư mục, backup
1. Tạo `D:\Games\Projects\VoiceChatLearnLanguage` nếu chưa có.
2. Giải nén **nội dung của thư mục `VoiceChatLearnLanguage` trong ZIP** vào đó; không để lồng 2 cấp thư mục.
3. Nếu thư mục đã có file, sao lưu hoặc merge thủ công; không chọn `Replace All`.
4. PowerShell:
```powershell
$Project = 'D:\Games\Projects\VoiceChatLearnLanguage'
New-Item -ItemType Directory -Force -Path $Project | Out-Null
Set-Location $Project
Get-ChildItem -Force
Get-Content .\PROGRESS.md
```

## B. Các phần mềm cần cài
- Node.js LTS 20+ (khuyến nghị bản LTS mới còn hỗ trợ), npm bundled: https://nodejs.org/en/download
- Git for Windows: https://git-scm.com/download/win
- IDE Rider hoặc VS Code. Chrome/Edge devtools; Android và iPhone để test mic/audio.
- Tùy chọn: Python cho devtools, nhưng pipeline chính dùng Node/PowerShell.

```powershell
node --version
npm --version
git --version
npm install -g @google/clasp
clasp --version
npm install -g wrangler
wrangler --version
```
Nếu không có quyền admin, dùng npm local `npx @google/clasp` / `npx wrangler` thay cho global. Không bật `Set-ExecutionPolicy Unrestricted` trên toàn máy.

## C. Khởi tạo Git
```powershell
Set-Location 'D:\Games\Projects\VoiceChatLearnLanguage'
git init
git branch -M main
git status --short
# Đảm bảo không có .env / .clasprc.json / bot token
git add README.md AGENTS.md PROGRESS.md CHANGELOG.md docs apps-script scripts .editorconfig .gitignore .env.example
git commit -m 'docs: bootstrap architecture and operating plan'
```
`git commit` có thể cần `git config user.name/email` trước. Private repo được ưu tiên; nếu dùng GitHub, bật secret scanning và branch protection.

## D. Chuẩn bị tài khoản (cùng Google account)
1. Google AI Studio: https://aistudio.google.com/app/apikey → tạo Gemini API key; kiểm tra Billing/Free Tier và limit https://aistudio.google.com/rate-limit; **không** commit key.
2. Google Sheets: tạo sheet `VoiceChatLearnLanguage` với tabs theo `docs/09_DATA_SCHEMA.md`; copy Spreadsheet ID từ URL (đừng nhầm với Script ID).
3. Google Apps Script: https://script.google.com/home → project `VoiceChatLearnLanguage`; thực hiện `docs/05_APPS_SCRIPT_SETUP.md`.
4. Cloudflare: https://dash.cloudflare.com → đăng nhập và tạo Worker; hướng dẫn `docs/06_CLOUDFLARE_SETUP.md`.
5. Telegram: mở `@BotFather` tạo bot bằng `/newbot`, lấy token riêng; `/setmenubutton` sau khi đã deploy Mini App; xem `docs/07_TELEGRAM_SETUP.md`.

## E. Dựng theo milestone (KHÔNG bỏ qua auth)
### M1 Web
```powershell
# Tại project root
New-Item -ItemType Directory -Force .\apps | Out-Null
npm create vite@latest apps/web -- --template react-ts
Set-Location .\apps\web
npm install
npm run dev
```
Chỉ local dev lúc này. Bổ sung `@google/genai`, test, audio worklet đúng API phiên bản hiện hành tại milestone M1; không nhúng long-lived API key frontend để deploy internet. Mọi config Vite public `VITE_*` đều lộ trong bundle.

### M2 Worker
```powershell
Set-Location 'D:\Games\Projects\VoiceChatLearnLanguage'
npm create cloudflare@latest -- apps/worker
# Chọn Worker + TypeScript; không deploy trước khi đã thiết lập auth/secrets
Set-Location .\apps\worker
npx wrangler login
npx wrangler dev
```
Tạo route health, HMAC, ephemeral token, Telegram validation trước khi deploy; chi tiết `docs/06_CLOUDFLARE_SETUP.md`.

### M3 Apps Script
Theo `docs/05_APPS_SCRIPT_SETUP.md`: bật Apps Script API, `clasp login`, liên kết `.clasp.json` ignored, `clasp push`, authorise trong editor, deploy Web App, cấu hình Script Properties, thử HMAC request.

### M4 Telegram
Theo `docs/07_TELEGRAM_SETUP.md`: setWebhook tới Worker đã deploy, pin userID, setup Cron và mini app; test receiving review.

## F. Kiểm tra bước đầu
```powershell
.\scripts\Start-Session.ps1
# Khi thực sự đạt Acceptance M0-01, ghi bằng chứng:
.\scripts\Complete-Task.ps1 -TaskId M0-01 -Evidence 'node, git, clasp, wrangler versions verified; git init success' -Next 'M0-02: accounts và quota'
Get-Content .\PROGRESS.md
Get-Content .\CHANGELOG.md
```

## G. Troubleshooting nhanh
- `npm is not recognized`: đóng/mở terminal, kiểm tra PATH/Node install.
- `clasp login` browser không mở: kiểm tra firewall, `clasp login --no-localhost` nếu phiên bản CLI hỗ trợ, hoặc dùng tài liệu chính thức.
- `Script API has not been enabled`: https://script.google.com/home/usersettings → Google Apps Script API = ON.
- Mic blocked: dùng HTTPS hoặc `localhost`; kiểm tra browser permission/Telegram webview; iOS cần user gesture để play audio.
- `npm create cloudflare` lỗi do thư mục không trống: đảm bảo `apps/worker` chưa tồn tại hoặc xem tùy chọn scaffold đã tạo, không ép overwrite.
- Các secret lỗi 401: kiểm tra Worker secrets/GAS Script Properties; không in giá trị trong logs.

## Checklist cuối setup
- [ ] Ghi versions vào PROGRESS evidence (không secret).
- [ ] `git status` không chứa credential; có `.gitignore`.
- [ ] Gemini free tier verified cho đúng project/model, có cơ chế cảnh báo quota.
- [ ] Worker và Apps Script **chưa public** nếu chưa có HMAC/auth.
- [ ] Quyết định duy trì một account/allowlist, chưa hỗ trợ anonymous visitors.
