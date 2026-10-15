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

Hotfix đã deploy Pages production **e7c48c2a**, source `4b39092`, build **M7-12-20261015**. Public asset **index-C7HXOF0O.js**, SHA256 `DFA4CF681C7A745AAF0C0F7B12ED816767AB008DB10FF121D00DD89812A6784C`, khớp artifact local và chứa đúng Worker origin/tag. Backend/GAS/D1 không thay đổi trong task này. Artifact/log private dưới `.artifacts/M7-12`; không dùng initData/API keys thật hoặc ghi D1/Sheet.

- Typecheck/lint/tagged production build/secret scan/diff PASS. Local full suite maxWorkers=2: 183/186 pass, ba timeouts 5 giây ở migration/Telegram workerd; serial maxWorkers=1: 181/186 pass, bốn timeouts workerd và một App-flow recovery wait assertion. Các case fail đổi giữa hai lượt; không sửa assertions/timeout để vượt gate.
- [CI 38668068679](https://github.com/tinycorn-studio/voice_learn_language/actions/runs/38668068679) SUCCESS trên clean Ubuntu checkout của `4b39092`: **186 tests/29 files PASS**, typecheck/lint/build; config mặc định được kiểm khi không có env ignored trên máy local. Không báo local full suite pass.
- Thực thi App từ **bundle public đã download** trong DOM, bridge fetch tới Worker thật với initData giả: `api_origin` đúng Worker, POST `/api/v1/auth/telegram` trả **401 UNAUTHENTICATED / phase api / JSON / server_request_id có giá trị**, allow-origin đúng Pages. Trước sửa Pages trả **405 / không JSON / api_origin Pages**. Probe private `.artifacts/M7-12/public-routing-proof.json` không chứa auth payload.
- Sau khi đóng/mở Mini App, người dùng trả lời **“Đã đăng nhập được”** trên bản M7-12 trong phiên 15/10. Hotfix auth đã được user nghiệm thu; không suy ra voice/rating/device QA toàn bộ đã đạt. Retry trong bundle M7-11 cũ vẫn dùng cấu hình cũ.
- Git tích hợp qua [PR #2](https://github.com/tinycorn-studio/voice_learn_language/pull/2), chỉ merge sau CI của head cuối PASS. Nếu cần rollback frontend, build source trước với **explicit Worker API URL** và tag mới rồi verify semantic; không redeploy bundle M7-11 thiếu API URL. D1/Worker vẫn giữ authority và dữ liệu hiện tại.

M7-10 Cron/CPU/thiết bị/outage/restore còn pending theo PROGRESS. Đây là hotfix frontend/API origin; không dùng kết quả này để đóng các gate đó.

Tham chiếu Vite đã đối chiếu: [env và mode](https://vite.dev/guide/env-and-mode.html), [envDir](https://vite.dev/config/shared-options.html#envdir).
