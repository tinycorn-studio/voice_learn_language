# M7-12 — Sửa auth gọi nhầm Pages, 15/10/2026

## Lỗi và nguyên nhân

User log Desktop lúc 08:38 +07: auth POST 405/INVALID_JSON, app_origin và api_origin cùng `https://voice-chat-learn-language.pages.dev`, build M7-11. Bundle public `index-BEIrwtmL.js` không có Worker origin; code dùng API base rỗng và gửi `/api/v1/auth/telegram` về static Pages. Worker auth bằng initData giả vẫn trả JSON 401, nên log này chưa cho thấy lỗi D1 hay Telegram HMAC.

Vite `envDir: '../..'` đọc monorepo root, trong khi `.env.production` ở `apps/web` và bị gitignore. Lần M7-11 chỉ truyền build tag, không truyền API URL; file env không được đọc và clean Git/CI cũng không có file. Hash local/public đã khớp một artifact thiếu cấu hình; kết luận deploy frontend M7-11 đạt chưa đủ kiểm chứng semantic API routing.

## Thay đổi

- Root/envDir tuyệt đối theo vị trí `apps/web/vite.config.ts`, env frontend đọc trong `apps/web`.
- `apps/web/public-config.json` version public production API URL trong Git; không có secrets. Override env vẫn ưu tiên; production không phụ thuộc file ignored.
- Build bắt buộc HTTPS API origin hợp lệ, chặn rỗng/Pages/HTTP/placeholder và URL có credentials/path/query/hash. Static import.meta.env replacement giữ API URL trong artifact thật.
- Regression thực thi App đã build trong browser DOM với synthetic Telegram initData, kiểm fetch URL và diagnostic api_origin. Bốn trường hợp config sai phải fail build. Trước sửa **5/5 FAIL**, auth URL thực tế `/api/v1/auth/telegram`; sau sửa **5/5 PASS**.

## Trạng thái và evidence

IN_PROGRESS: regression đã đạt, đang chạy gates/CI trước Pages deploy. Artifact/log private dưới `.artifacts/M7-12`; không dùng initData/API keys thật hoặc ghi D1/Sheet.

Release dự kiến build `M7-12-20261015`; chỉ báo frontend production sửa xong sau tải lại bundle public và thực thi probe auth tới Worker, CORS/hash/tag đúng. Probe synthetic không thay nghiệm thu đăng nhập Telegram/voice của người dùng.

M7-10 Cron/CPU/thiết bị/outage/restore còn pending theo PROGRESS. Đây là hotfix frontend/API origin; không dùng kết quả này để đóng các gate đó.
