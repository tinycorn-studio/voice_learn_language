# 02 — Technology Stack / lý do chọn

| Layer                  | Chọn                                  | Version policy                                          | Lý do                                                                                                     | Đường nâng cấp                                     |
| ---------------------- | ------------------------------------- | ------------------------------------------------------- | --------------------------------------------------------------------------------------------------------- | -------------------------------------------------- |
| Frontend               | React + TypeScript strict + Vite      | Node LTS, pin package lock                              | Web mobile-friendly, SDK Web Audio, Telegram SDK                                                          | React Router/TanStack Query khi cần                |
| Voice                  | Google GenAI JS SDK / Gemini Live API | `gemini-3.8-live` **kiểm tra model/quota theo project** | Audio realtime, function calling, ephemeral token                                                         | model khác qua `LiveProvider`                      |
| Edge API               | Cloudflare Workers + Wrangler         | lock dependency                                         | Serverless webhook/auth/cron                                                                              | Queues + D1 cho nhiều người                        |
| Hosting                | Cloudflare Static Assets/Pages        | free tier                                               | HTTPS cần cho microphone, Telegram WebApp                                                                 | custom domain                                      |
| Store                  | Google Sheets + Apps Script           | quota                                                   | Dễ xem/chỉnh dữ liệu, setup nhanh                                                                         | D1 qua Repository adapter                          |
| Apps Script automation | `@google/clasp` + Git                 | pin phiên bản đang chạy                                 | AI agent sửa `.gs` tại repo và push/deploy                                                                | CI/CD có approval                                  |
| SRS                    | `ts-fsrs` (`^5.4.2`)                  | Official package                                        | FSRS chuẩn (stability/difficulty/retrievability), backend-authoritative trên Worker, tối ưu retention 90% | FSRS parameter optimization khi đủ lịch sử reviews |
| Validation             | Zod, typed contracts                  | pin version                                             | Không tin payload từ model/network                                                                        | OpenAPI generation                                 |
| Tests                  | Vitest, Playwright, Worker test       | pin version                                             | unit/integration/e2e                                                                                      | cloud smoke                                        |
| Observability          | Structured logs, request_id           | redact                                                  | Điều tra không lộ hội thoại                                                                               | Sentry optional                                    |

## Chính sách dependency

- Ưu tiên package chính thức (`@google/genai`, `wrangler`), ít dependency; kiểm tra license và security alerts.
- Không cố định version mẫu trong docs nếu có thể lỗi thời; lock tại `package-lock.json` khi khởi tạo.
- Không dùng `latest` trong production automation; CI pin Node LTS/CLI và chạy `npm ci`.
- Dựng chung `packages/shared` cho type/schema/event API, **không import Google/Telegram SDK trong domain**.

## Cấu trúc code target

```text
apps/web/src/
  app/          # bootstrap, router, providers
  features/voice/{components,hooks,services}/
  features/vocabulary/{components,services}/
  features/review/{components,services}/
  integrations/telegram/
  ui/           # generic reusable components
apps/worker/src/
  entry.ts      # fetch/scheduled
  routes/       # token/vocab/review/telegram
  auth/         # initData, webhooks, allowlist
  adapters/     # gemini token, GAS signer, telegram API
  application/  # use-cases
  domain/       # interfaces and business rules
packages/shared/src/
  contracts/    # Zod payload/version
  srs/          # Pure engine
  utils/        # normalize/time
apps-script/
  Code.gs       # Starter; chỉ `vocabulary.upsert` demo; hoàn thiện M3
  appsscript.json
```

## Config phân cấp

- `VITE_*` là cấu hình công khai: Worker URL, environment.
- Worker secrets: `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `TELEGRAM_WEBHOOK_SECRET`, `GAS_SHARED_SECRET`, `GAS_EXEC_URL`, `OWNER_TELEGRAM_ID` (ID không phải bí mật nhưng backend phải kiểm soát).
- Apps Script Script Properties: `SHEET_ID`, `GAS_SHARED_SECRET`, `MAX_EVENT_AGE_SECONDS`.
- `GEMINI_MODEL` là Worker `vars`, có thể đổi qua config nhưng luôn verify availability/quota trước.

## Phương án không chọn

- Không n8n: nhu cầu xử lý ít, Worker+GAS đủ, tự code dễ versioning.
- Không dùng Telegram messages làm kho chính: không có schema/atomic query.
- Không dùng AnkiConnect làm lõi: phụ thuộc Anki Desktop local.
- Không thêm PostgreSQL từ đầu: overhead setup, Google Sheets đủ cho một người.
