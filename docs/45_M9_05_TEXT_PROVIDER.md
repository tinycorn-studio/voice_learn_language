# M9-05 — Text provider switch (OpenAI-compatible, fallback Gemini)

**Trạng thái:** DONE LOCAL — mặc định vẫn Gemini (hành vi production chưa đổi); chờ người dùng lấy API key để kích hoạt + deploy
**Task ID:** M9-05
**Branch:** `feat/M9-02-multi-user` (làm tiếp trên nhánh M9)
**Ngày mở:** 2026-10-19 (UTC+7)

## Bối cảnh

- Người dùng lo quota Gemini free tier sẽ bị giới hạn và hỏi có dùng DeepSeek V4.1 Flash / GLM 5.3 Flash free thay được không, lấy API free ở đâu.
- Xác minh 2026-10-19: API chính thức DeepSeek **không** có free tier (`deepseek-flash` là trả phí rẻ ~$0.15–1.2/1M token); Z.AI có free tier thật cho `glm-4.7-flash`/`glm-4.6v-flash`/`glm-4.5-flash` ($0); GLM-5.3-Flash bản thân là trả phí; các chỗ rao "free GLM 5.3" là bên thứ ba (không dùng cho production).
- Kiến trúc: 2 route text (`/api/v1/translate`, `/api/v1/chat-turn`) là request/response một chiều → thay provider được. Gemini Live (audio realtime 2 chiều qua ephemeral token) **không thể** thay bằng chat API → giữ nguyên + daily caps M9-03.

## Phạm vi

1. `adapters/openai-chat.ts` (mới): client OpenAI-compatible tối giản `POST {baseUrl}/chat/completions` (Bearer auth, system + messages, temperature, `max_tokens`, `stream:false`; timeout 8s; validate base URL HTTPS + model id; map 429/timeout/5xx/kết quả rỗng|quá dài|`content_filter`|JSON hỏng thành `AppError` sanitize).
2. `adapters/text-ai.ts` (mới): façade chọn provider + fallback:
   - `TEXT_AI_PROVIDER` mặc định `gemini` — không cấu hình gì thì hành vi y như trước (URL/prompt/timeout Gemini giữ nguyên).
   - `TEXT_AI_PROVIDER=openai` + đủ `TEXT_AI_BASE_URL`/`TEXT_AI_MODEL`/`TEXT_AI_API_KEY` → primary là endpoint OpenAI-compatible; lỗi provider (trừ `TIMEOUT`) → log `text_ai_fallback` (chỉ provider + code) + tự chạy lại bằng Gemini. `TIMEOUT` không fallback vì budget 8s đã hết (client timeout 20s).
   - Thiếu cấu hình khi provider=openai → log `text_ai_config_incomplete` + dùng Gemini; giá trị provider lạ → log `text_ai_provider_unknown` + Gemini.
3. `adapters/text-prompts.ts` (mới): tách 2 system instruction dùng chung cho cả 2 provider (giữ nguyên văn bản đang chạy).
4. `entry.ts`: 2 route text gọi qua façade; không đổi request/response schema; caps M9-03 vẫn enforce trước khi gọi provider (fallback không tiêu thêm lượt).
5. `env.ts`: thêm `TEXT_AI_PROVIDER?`, `TEXT_AI_BASE_URL?`, `TEXT_AI_MODEL?`, `TEXT_AI_API_KEY?`.

## Không thuộc phạm vi

- Gemini Live realtime voice (`/api/v1/live-token`, `gemini-3.8-live`) — không có API free nào thay được audio 2 chiều.
- Không đổi frontend/API contract/DB; chưa kích hoạt provider mới trong phiên này (chờ key + xác nhận deploy).

## Cấu hình (khi kích hoạt)

| Biến               | Ví dụ Z.AI (free)              | Ghi chú                                                             |
| ------------------ | ------------------------------ | ------------------------------------------------------------------- |
| `TEXT_AI_PROVIDER` | `openai`                       | Bỏ trống/`gemini` = giữ Gemini như cũ                               |
| `TEXT_AI_BASE_URL` | `https://api.z.ai/api/paas/v4` | HTTPS, không credentials/query; adapter tự thêm `/chat/completions` |
| `TEXT_AI_MODEL`    | `glm-4.7-flash`                | Model id không tiền tố `models/`                                    |
| `TEXT_AI_API_KEY`  | (secret)                       | Chỉ nằm ở Worker, đặt bằng `wrangler secret put`                    |

Các bước kích hoạt:

1. Tạo API key tại Z.AI (API Keys page của `z.ai`); chọn model free `glm-4.7-flash` tại trang pricing ở thời điểm tạo key.
2. `npx wrangler secret put TEXT_AI_API_KEY` (paste key; secret put tự publish version mới, không cần deploy code).
3. `npx wrangler secret put TEXT_AI_PROVIDER` → `openai`; làm tương tự cho `TEXT_AI_BASE_URL` → `https://api.z.ai/api/paas/v4` và `TEXT_AI_MODEL` → `glm-4.7-flash`.
4. Smoke: `/health` 200; thử 1 lượt chế độ nhẹ + 1 lượt dịch trong Mini App; `npx wrangler tail` quan sát có `text_ai_fallback`/`text_ai_config_incomplete` bất thường không.
5. Tắt về Gemini bất kỳ lúc nào: `npx wrangler secret put TEXT_AI_PROVIDER` → `gemini`.

Ví dụ DeepSeek (bản trả phí, cùng cơ chế): base `https://api.deepseek.com`, model `deepseek-flash` — không có free tier chính thức.

## Tiêu chí nghiệm thu

- Mặc định (không set `TEXT_AI_*`): toàn bộ test cũ pass; URL gọi vẫn là `generativelanguage.googleapis.com`; response schema/ràng buộc không đổi.
- provider=openai: cả chat-turn và translate gọi `{base}/chat/completions` với Bearer key + system prompt đúng; reply/translation vẫn qua validate độ dài như cũ.
- Lỗi provider (429/5xx/network/response hỏng) → tự fallback Gemini, kết quả trả về bình thường; log `text_ai_fallback` chỉ chứa provider + mã lỗi (không có nội dung/secret).
- Timeout provider → 504 (không fallback); config sai/thiếu → Gemini + warn; key không bao giờ xuất hiện trong response/log.

## Kết quả local

- `apps/worker/src/adapters/openai-chat.test.ts` (mới): 8/8 PASS — payload/URL/auth đúng, trim content, 429 → `RATE_LIMITED`, 5xx vs 4xx retryability, network → `UNAVAILABLE`, timeout 8s → `TIMEOUT`, kết quả rỗng/quá dài/`content_filter`/JSON hỏng → `UPSTREAM_ERROR`, validate config (HTTPS, credentials, query/hash, model id, key trống).
- `apps/worker/src/adapters/text-ai.test.ts` (mới): 7/7 PASS — mặc định Gemini không đụng `TEXT_AI_*`; provider=openai cho tutor + translation với prompt đúng; fallback khi 429 + log sanitize; không fallback khi timeout; config thiếu → Gemini + warn; provider lạ → Gemini + warn.
- `apps/worker/src/entry.test.ts`: +2 test M9-05 PASS — route thật qua provider (URL `api.z.ai`, Bearer key, không leak key vào body) và fallback cấp route khi provider 500.
- Full suite/gates: xem mục Deploy.

## Rủi ro / chưa làm

- Chưa đo chất lượng/độ trễ `glm-4.7-flash` cho tiếng Việt (chưa có key) — khi kích hoạt nên thử vài lượt thật; fallback giảm rủi ro nhưng thêm 1 nhịp lỗi mỗi lượt khi provider chết.
- Privacy: khi bật provider ngoài, nội dung hội thoại/dịch (text) đi tới Z.AI thay vì Google — cần cập nhật privacy copy trong Info dialog + ghi chú docs/10 khi kích hoạt thật (default hiện vẫn Gemini nên chưa đổi).
- Z.AI free tier không công bố rate limit đầy đủ; chưa có circuit breaker (mỗi request vẫn thử provider trước khi fallback) — cân nhắc thêm nếu lỗi liên tục.
- Model id free tier có thể đổi theo thời gian — đối chiếu trang pricing khi tạo key; đổi model chỉ cần `wrangler secret put TEXT_AI_MODEL`.

## Deploy

- Local gates: full suite 286/286 tests/46 files (serial), typecheck/lint/build/secret scan/Prettier/diff check PASS.
- Chưa deploy. Bản M9-05 có thể deploy ngay mà không đổi hành vi (mặc định `gemini`), nhưng sẽ deploy cùng lúc khi người dùng có key + xác nhận, để smoke thật provider mới trong 1 lượt.
