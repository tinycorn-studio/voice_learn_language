# 18 — Continuous Integration & Deployment Plan

## CI safe-by-default (M2-04)
GitHub Actions hoặc CI tương đương trên PR/main:
1. Checkout (SHA-pinned action version khi đủ điều kiện).
2. Node LTS pinned, `npm ci`.
3. `npm run typecheck`, `npm run lint`, `npm run test -- --run`, `npm run build`.
4. Detect leaking secrets/build size, `git diff --check`, public bundle scan. Không in `.dev.vars`/refresh token.
5. No deploy on PR, especially forks.

## Apps Script Automation via clasp
Clasp quản lý remote Script project: `clasp push`, `clasp version`, `clasp deployments`, `clasp redeploy`. Đây là cách chuẩn để AI coding tool **chỉnh Apps Script bằng code thay vì mở editor trình duyệt**.

### Workflow khuyến nghị
- Local/dev: agent sửa code → unit tests Apps Script với mocks → review diff → `clasp status` → `clasp push` vào DEV script → test dev `doPost` → version.
- Staging: GitHub Actions **manual workflow_dispatch + human approval**, sử dụng CI secrets `CLASPRC_JSON` / `CLASP_JSON_STAGING` nếu chính sách cho phép; test staging.
- Prod: manual approval bắt buộc; backup source/version và Sheet; set mapping `.clasp.json` riêng cho prod; `clasp push` (không `--force` mặc định), `clasp version`, `clasp redeploy DEPLOYMENT_ID VERSION`.
- Do not auto-deploy to production on every source commit trong giai đoạn cá nhân; tránh ghi đè bản web editor và giảm rủi ro credential.

### Bảo mật credentials trong CI
`~/.clasprc.json` chứa refresh token OAuth, quyền rộng; **không** commit vào Git, GitHub Artifacts hay paste chat. Nếu đặt trong CI secrets, chỉ dùng repo private + protected environment + reviewer; rotate khi nghi ngờ. `.clasp.json` chỉ chứa scriptId nhưng mapping nhầm có thể phá prod; thiết lập chính xác ở runtime. Có thể dùng service account/Google Apps Script API theo điều kiện quyền nếu phù hợp nhưng cần xác minh hỗ trợ trước.

## Rollback
- Apps Script giữ `deploymentId` bất biến và previous `versionNumber`; `clasp redeploy DEPLOYMENT_ID PREVIOUS_VERSION "rollback"` rồi smoke test signed endpoint.
- Worker dùng Cloudflare Versions/Rollbacks dashboard; frontend rollback bản build trước.
- Schema thay đổi: migrate backward có backup; rollback code không tự rollback dữ liệu.

## Automation rules
- Agent không bao giờ gọi deploy nếu task chưa pass test hoặc thiếu explicit permission để cập nhật môi trường thật.
- Mọi deploy có check command + result vào PROGRESS (không có secret), commit/tag + version.
- Mọi remote mutation phải chỉ đúng account/project/scriptID/environment; bắt buộc verification.

## Official reference
https://developers.google.com/apps-script/guides/clasp
