# 12 — Operations, Backup, Deploy & Rollback

## Environments
- `local`: UI local + Worker dev, Google Sheet DEV riêng, Google Script DEV riêng, Telegram test bot; secrets riêng.
- `staging`: Cloudflare staging Worker, Sheet STAGING, Apps Script staging deployment; chốt contract trước prod.
- `production`: Cloudflare deployed app + Worker, Script deployment, Telegram bot/webhook, private Sheet.

## Release checklist
1. `git status`, review diff, AGENTS rules; verify code/secret scan. `npm ci && npm run lint && npm test && npm run build` pass.
2. Backup Sheets/Apps Script deployment version; ghi schema version và deployment IDs.
3. Deploy Apps Script code bằng clasp + version/redeploy (sau check HMAC/auth); Worker staging; smoke test.
4. Deploy Worker production, Web UI, setWebhook Telegram nếu URL mới; Cron UTC; monitor first 24h.
5. Ghi `PROGRESS.md`: commit, version, checklist pass, rollback point; không dán secret/log sensitive.

## Backup
- Weekly export các tab Sheets sang CSV hoặc tạo private Drive copy; Apps Script version + code Git; lưu timestamp/version. Test restore hàng tháng.
- Backup phục hồi phải bao gồm `Words`, `Events`, `Reviews`, `Users`, `DailyDispatchLog` để không gửi reminder trùng.
- Không copy secrets trong backup sheets; keys nằm secrets manager/script props.

## Rollback
- **Worker:** về previous deployment version qua Cloudflare dashboard/Wrangler phiên bản đang dùng; test `/health`, auth, webhook.
- **Apps Script:** `clasp deployments` và `clasp redeploy <deploymentId> <previousVersion> 'rollback ...'`; verify Web App URL vẫn trỏ version đúng. Khi cần migrate schema ngược, phải có script rollback & backup.
- **Frontend:** deploy lại build trước trên Pages/Static Assets.
- **Telegram:** khi Worker URL mới, setWebhook lại, không dùng polling lẫn webhook.
- **Data:** restore từ bản backup có cùng schema/Events; không xóa toàn bộ logs mù quáng.

## Monitoring / SLO
- Worker health/API errors; Telegram getWebhookInfo last_error; Apps Script Executions failures; Google Sheets current row count/size; Gemini usage/rate limit; quota Cloudflare.
- Alert email/Telegram tự gửi **chỉ khi** failures/near limits; tránh recursive bot notification spam.
- Proactively disable voice token issuance khi quota exhausted, giữ review vocabulary vẫn chạy.

## Data retention / privacy
- Không ghi audio; source_excerpt tối thiểu; command `/export` và `/delete` cần triển khai M3/M4; backup có TTL và access control.

## Incident response
- Secret leak: revoke/rotate; service outage: show status; data corruption: pause writes, backup, restore/reconcile; Telegram spam: pause bot cron, dedupe and audit.
