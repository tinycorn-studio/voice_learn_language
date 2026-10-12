# 20 — Official References (reviewed 2026-10-12)

Tài liệu ngoài có thể thay đổi; các links chính thức ưu tiên hơn blog/AI output.

## Google Gemini
- Live overview: https://ai.google.dev/gemini-api/docs/live-api
- Capabilities & limitations: https://ai.google.dev/gemini-api/docs/live-api/capabilities
- Session/audio best practices: https://ai.google.dev/gemini-api/docs/live-api/best-practices
- Ephemeral tokens: https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- Pricing/free tier: https://ai.google.dev/gemini-api/docs/pricing
- Models: https://ai.google.dev/gemini-api/docs/models
- Deprecations: https://ai.google.dev/gemini-api/docs/deprecations/
- Rate limits dashboard: https://aistudio.google.com/rate-limit

## Google Apps Script
- clasp command line: https://developers.google.com/apps-script/guides/clasp
- Web App `doPost`: https://developers.google.com/apps-script/guides/web
- Quotas: https://developers.google.com/apps-script/guides/services/quotas
- LockService: https://developers.google.com/apps-script/reference/lock/lock-service
- PropertiesService: https://developers.google.com/apps-script/reference/properties/properties-service

## Cloudflare
- Workers getting started: https://developers.cloudflare.com/workers/get-started/guide/
- Cron UTC: https://developers.cloudflare.com/workers/configuration/cron-triggers/
- Workers limits: https://developers.cloudflare.com/workers/platform/limits/
- Wrangler configuration: https://developers.cloudflare.com/workers/wrangler/configuration/

## Telegram
- Bot API + setWebhook: https://core.telegram.org/bots/api
- Mini Apps + validate initData: https://core.telegram.org/bots/webapps

## Development
- TypeScript handbook: https://www.typescriptlang.org/docs/
- Vite guide: https://vite.dev/guide/
- Vitest guide: https://vitest.dev/guide/

## Verification notes
- Gemini `gemini-3.8-live` listed under Live API & Free Tier on pricing page as of review date. Free usage still limited and account-dependent.
- Google recommends clasp for local source management; `clasp push` + immutable versions/deployments.
- Cloudflare Cron runs UTC; Worker Free plan quotas are subject to change; do not assume cron is a precise clock.
- Telegram Bot webhook receives HTTPS POST and can validate secret-token header.
