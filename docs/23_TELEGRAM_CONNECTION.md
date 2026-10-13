# 23 — Chẩn đoán kết nối Telegram Mini App (M5-06 / M5-07 / M5-08)

## Phạm vi và kết quả

Kiểm tra ngày 12/10/2026, khoảng 22:01–22:15 (UTC+7), theo báo lỗi của người dùng bot `@learn_english_by_lamhd_bot`.

| Kiểm tra trực tiếp                                                                                                                       | Kết quả                                                                                                        |
| ---------------------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------- |
| Mini App `https://voice-chat-learn-language.pages.dev/?v=20261012c`                                                                      | HTTP 200; tải bundle `/assets/index-4hlyxbyP.js`                                                               |
| Worker `https://voice-chat-learn-language-worker.voice-chat-learn-language.workers.dev/health`                                           | HTTP 200; envelope `ok: true`, service `voice-chat-worker`                                                     |
| OPTIONS `/api/v1/auth/telegram`, Origin `https://voice-chat-learn-language.pages.dev`, request method POST, request headers content-type | HTTP 204; `Access-Control-Allow-Origin` đúng domain Mini App; cho phép content-type/authorization/x-request-id |
| POST `/api/v1/auth/telegram` với `{"init_data":""}`                                                                                      | HTTP 400 `INVALID_ARGUMENT`, JSON đúng envelope, có CORS đúng domain; không dùng token/initData thật           |
| URL API trong bundle đang public                                                                                                         | Đúng Worker nêu trên; không dùng `YOUR-WORKER`                                                                 |
| Cơ chế timeout trong bundle đang public                                                                                                  | Có `AbortSignal.timeout(2e4)` trong khối catch trả thông báo người dùng báo                                    |

Các kiểm tra này xác nhận frontend và route API có thể truy cập từ máy kiểm tra tại thời điểm đó. `/health` không kiểm tra Gemini, Google Sheets hay các secret backend. Chưa kiểm tra mạng và phiên đăng nhập trên thiết bị Telegram của người dùng.

## Lỗi đã tái hiện và bản sửa local

`LearningApiClient.send()` trước đây gọi `AbortSignal.timeout(20000)` ngay trong khối fetch. Khi WebView không có hàm này, JavaScript ném TypeError trước khi fetch được gọi; catch đổi lỗi thành “Không thể kết nối máy chủ. Hãy kiểm tra mạng và thử lại.” Đây là lỗi tương thích client đã tái hiện bằng regression test. Chưa có bằng chứng xác nhận thiết bị báo lỗi thực tế thiếu API này, nên đây là nguyên nhân có khả năng phù hợp, chưa phải kết luận chắc chắn cho phiên người dùng.

- Dùng `AbortController` + timer 20 giây, giữ deadline tới khi đọc xong body và luôn dọn timer. Phân biệt timeout với lỗi mạng; không hiển thị raw exception hay initData.
- Kiểm tra URL cấu hình trước khi gửi initData: chặn placeholder `YOUR-WORKER`, URL lỗi, scheme ngoài HTTP(S), credentials/query/hash và HTTP khi trang dùng HTTPS. Chuẩn hóa khoảng trắng/slash; base trống vẫn hỗ trợ API cùng origin.
- Thêm nút **Thử kết nối lại** sau khi đăng nhập thất bại; tiếp tục dùng xác thực Worker, không bỏ qua auth hay mở rộng CORS.
- Bổ sung workspace Worker còn thiếu trong `package-lock.json`. Trước sửa, `npm ci` dừng với thông báo lockfile thiếu `@voice-chat/worker`.

Evidence local: test WebView thiếu timeout và test retry đăng nhập thất bại trước sửa, pass sau sửa; tổng 68 tests/13 files, `npm run typecheck`, `npm run lint`, `npm test`, `npm run build` pass. Frontend mới: `apps/web/dist/assets/index-Ct3bC747.js`, build với `VITE_API_BASE_URL` là Worker đã kiểm tra. Đã deploy frontend trong M5-01 theo biên bản bên dưới; chưa nghiệm thu voice/Sheets trên Telegram thật.

Máy kiểm tra không hỗ trợ junction/symlink workspace và sandbox chặn spawn esbuild. Đã cài dependency bằng `npm ci --workspaces=false --cache .artifacts/npm-cache --no-audit --no-fund`, dùng bản sao nguyên trạng `packages/shared` trong `node_modules/@voice-chat/shared` để resolve package khi typecheck/build; Vitest alias đọc trực tiếp source shared. Đây là workaround local, không đổi cấu trúc package của repo. Tests/build chạy ngoài sandbox để có thể spawn esbuild. Không nâng version dependency.

## Kiểm tra khi lỗi xuất hiện lại

1. Xác nhận URL Mini App/API đang dùng, kiểm tra `/health` và request OPTIONS với **Origin của trang Mini App**. URL query `?v=...` không thuộc Origin. HTTP 204 nhưng thiếu header allow-origin vẫn khiến trình duyệt chặn request.
2. Kiểm tra `VITE_API_BASE_URL` tại lúc build frontend và `ALLOWED_ORIGIN` của Worker đang deploy. Không dùng `*` để chữa lỗi CORS; không đưa bot token/Gemini key vào biến `VITE_*`.
3. Vite nạp `.env.local` tại root repo do `envDir: '../..'`. Thay biến môi trường cần restart dev server hoặc build/deploy lại frontend; chỉ đổi query URL không thay bundle đang public. Base trống chỉ hoạt động nếu host thực sự route `/api/v1/*` đến Worker; host static Pages hiện tại cần URL Worker đầy đủ.
4. Nếu API trả 401/403, kiểm tra auth_date/allowlist và mở bằng nút Mini App trong Telegram. Không copy raw initData, bearer token hoặc bot token vào chat/log.
5. Nếu vẫn báo lỗi kết nối sau bản vá, ghi platform/phiên bản Telegram, mã HTTP, request_id nếu có và việc request auth có xuất hiện trên network/Worker logs hay không. Không có request trước sửa có thể do thiếu timeout API; có request thì tiếp tục kiểm tra DNS/TLS/proxy/mạng trên thiết bị. Không log transcript/PII.

## Triển khai frontend M5-01 — 22:23 UTC+7, 12/10/2026

Người dùng đã xác nhận deploy frontend. Wrangler 4.149.0 đăng nhập OAuth với scope account:read/user:read/pages:write, xác định project có sẵn `voice-chat-learn-language` (Direct Upload) và nhánh production là `production`.

```powershell
node .artifacts/wrangler/node_modules/wrangler/bin/wrangler.js pages deploy apps/web/dist --project-name voice-chat-learn-language --branch production --commit-dirty=true --commit-message "M5-06: WebView-compatible API timeout and login retry; verified local artifact"
```

- Deployment: `e3229c61-7573-49a1-a05a-c957e6bfa16f`, environment Production, [deployment URL](https://e3229c61.voice-chat-learn-language.pages.dev/).
- Domain production và URL menu `https://voice-chat-learn-language.pages.dev/?v=20261012c` đều trả HTTP 200, tải `/assets/index-Ct3bC747.js`; index cache-control `public, must-revalidate, max-age=0`.
- SHA256 bundle tải từ production: `79D65ED0A2E14A5AC137070030BBA6150ACC29D7B3B4EFEB011975EDAAE30B7A`, khớp byte với artifact local đã build. Không có `AbortSignal.timeout`, có nút retry và URL API đúng. Gói local `.artifacts/M5-06-frontend.zip` có SHA256 `74A44D83892BD4DF604B709AD536670B1597BD1F9BA822CF60BB0DBE8C808C31`.
- Sau deploy: Worker `/health` 200, OPTIONS auth 204 và allow-origin đúng domain Mini App.
- Rollback đã kiểm tra trước deploy: `21f513cc-5946-4e45-96f0-75cdbbe0dce1`; [deployment cũ](https://21f513cc.voice-chat-learn-language.pages.dev/) phục vụ cùng bundle `index-4hlyxbyP.js` với domain production trước cập nhật. Có thể chọn rollback deployment này trong Pages dashboard nếu cần.
- Cloudflare ghi source `d1b712f` (commit gốc) với `commit-dirty=true`; code deploy gồm staged fixes M5-06, chưa có commit riêng vì người dùng yêu cầu chưa cần email/commit. Dùng SHA256 artifact để xác định chính xác bytes đã triển khai.

## Bước tiếp theo

Ảnh iOS người dùng gửi sau M5-06 vẫn báo lỗi kết nối và đã có nút retry, xác nhận bản mới đã tới thiết bị. Nguyên nhân thực tế chưa được xác định; không kết luận do thiếu AbortSignal.timeout. M5-07 bổ sung evidence phía client theo quy trình bên dưới. Dùng domain production khi thử trong Telegram; deployment URL phụ có origin khác allowlist API. M5-02 tiếp tục pending tới khi kiểm chứng trên thiết bị thật; M5-01 toàn bộ chưa hoàn thành vì Worker/GAS/secrets/schema chưa được nghiệm thu trong task frontend này.

Build lại từ root trước khi triển khai:

```powershell
$env:VITE_API_BASE_URL = 'https://voice-chat-learn-language-worker.voice-chat-learn-language.workers.dev'
$env:VITE_APP_VERSION = 'M5-08-20261012'
npm run build
```

Xác nhận deploy theo `AGENTS.md` mục 4 đã được người dùng cấp và thực hiện. Giữ staged changes theo yêu cầu chưa commit của người dùng.

Nguồn đối chiếu: [Vite environment variables](https://vite.dev/guide/env-and-mode), [Telegram Mini Apps](https://core.telegram.org/bots/webapps), [Cloudflare local environment variables](https://developers.cloudflare.com/workers/local-development/environment-variables/).

## M5-07 — Log từng lần gọi API trên thiết bị

Log được ghi tự động tại `LearningApiClient`, gồm cả attempt thành công, timeout, network failure, lỗi HTTP/API/schema và thiếu initData/cấu hình trước fetch. Mỗi attempt thực có mã client mới; concurrent login dùng chung một request chỉ ghi một lần. Không tạo request mới chỉ để gửi log lỗi.

- Metadata: thời điểm UTC, client/server request ID, method, route template, code, phase, HTTP status (null nếu chưa nhận response), duration, exception name từ whitelist, `navigator.onLine`, origin app/API, Telegram platform từ whitelist và build ID public. `online=true` chỉ là gợi ý, không chứng minh Internet hay API hoạt động.
- Chỉ giữ 30 attempts gần nhất trong memory, mất khi reload/đóng Mini App; không ghi localStorage/IndexedDB. Failure còn có một dòng console `mini_app_api_failure` với metadata tương tự. Không đưa raw Error/message/stack, request/response body, headers, tokens/initData, username/user ID, word/event ID, query/fragment, transcript/audio hay full user-agent vào log. Server ID chỉ chấp nhận UUID hoặc mã `web-<24 hex>`.
- API request gửi `x-request-id`, Worker public đã kiểm tra echo đúng mã với request auth rỗng (400 `INVALID_ARGUMENT`). Preflight có `content-type,x-request-id` trả 204 và allow-origin đúng domain Pages. Worker `/health` trả 200 với CORS. Không thay code/deploy Worker trong M5-07.

Khi gặp lỗi trên iPhone:

1. Giữ Mini App đang mở, bấm **Log chẩn đoán → Kiểm tra kết nối**. Probe gọi `/health` không auth, không custom headers; kết quả được ghi cùng lịch sử lỗi auth.
2. Bấm **Thử kết nối lại** để có thêm một attempt auth, nếu muốn đối chiếu retry.
3. Bấm **Sao chép log** và gửi báo cáo trước khi đóng cửa sổ. Nếu clipboard bị chặn, chạm ô log để chọn tất cả rồi sao chép thủ công. Mã lỗi/request ID gần nhất luôn hiện ngoài phần thu gọn để chụp ảnh.

| Code / phase                                       | Ý nghĩa để tiếp tục điều tra                                                                                                            |
| -------------------------------------------------- | --------------------------------------------------------------------------------------------------------------------------------------- |
| `NETWORK_ERROR` / fetch, HTTP null                 | Trình duyệt không trả response cho JavaScript. Có thể DNS/TLS/mạng/CORS/chặn WebView; chưa đủ evidence xác định riêng nguyên nhân.      |
| `TIMEOUT` / fetch hoặc json                        | Quá deadline 20 giây; phase/json + HTTP cho biết đã nhận headers nhưng chưa đọc xong body.                                              |
| `RESPONSE_READ_ERROR` / json                       | Luồng đọc body lỗi, tách khỏi JSON sai cú pháp.                                                                                         |
| `INVALID_JSON`, `INVALID_ENVELOPE`, `INVALID_DATA` | Có response nhưng body/envelope/schema không đúng; xem status và đối chiếu Worker. Không log nội dung response.                         |
| `UNAUTHENTICATED`, `FORBIDDEN`, các API codes      | Đã đọc được envelope lỗi; đối chiếu server request ID và mã/status với `api_error`.                                                     |
| `MISSING_INIT_DATA` / local                        | Chưa fetch; cần mở lại qua nút Mini App trong Telegram.                                                                                 |
| `INVALID_CONFIG` / configuration                   | URL cấu hình bị từ chối trước fetch; kiểm build/env.                                                                                    |
| `/health` OK nhưng auth fetch lỗi                  | GET đơn giản hoạt động trên thiết bị, chưa chứng minh POST/preflight/auth hoạt động. Kiểm request auth và CORS với đúng origin/headers. |

Worker hiện đã có structured `api_error` với request_id/code/status. Đối chiếu mã client trong Cloudflare Workers → Worker → Logs khi stream log đang mở hoặc lịch sử đã được bật. Không tìm thấy log **không** chứng minh request chưa tới Worker: thành công không ghi `api_error`, OPTIONS trả sớm, stream có thể chưa mở và lưu lịch sử chưa được xác minh. `wrangler.toml` hiện không bật `[observability]`; M5-07 không bật logging trả phí/lưu lịch sử hay xin thêm OAuth scope. Nếu cần lưu log tập trung, đánh giá retention/quota và xin xác nhận thay cấu hình riêng.

Giới hạn nền tảng đối chiếu: [MDN CORS errors](https://developer.mozilla.org/en-US/docs/Web/HTTP/Guides/CORS/Errors) giải thích JavaScript không nhận chi tiết nguyên nhân CORS; [Cloudflare Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/) mô tả cấu hình lưu log. Không kết luận lỗi trên mạng iPhone từ health check của máy phát triển.

## Triển khai frontend M5-07 — 22:38 UTC+7, 12/10/2026

- Local gates: typecheck/lint/build PASS, 82 tests/14 files PASS, secret scan sau khi stage file mới và `git diff --cached --check` PASS. Regression kiểm network/timeout khi fetch và đọc body, stream lỗi/JSON sai/envelope/schema/API errors, whitelist và bounded 30 attempts, correlation, clipboard bị thiếu/từ chối và probe không bypass auth.
- Production deployment: `2883e8b3-e60e-4498-8a29-d0f033bf1051`, project/branch giữ nguyên `voice-chat-learn-language` / `production`; [deployment URL](https://2883e8b3.voice-chat-learn-language.pages.dev/). Build ID `M5-07-20261012`; deploy theo xác nhận frontend đã được cấp trong cùng incident, không xin thêm quyền Worker.
- Domain production và URL menu gốc đều HTTP 200, tải `/assets/index-CiqVpn3F.js`, cache-control `public, must-revalidate, max-age=0`. SHA256 public `3FC3D15885D56C7781E2A85019F1A073D0B0B483D82EA08EA8F9432906B16C5B` khớp artifact local byte-for-byte. Có marker logger/nút copy/build/API URL, không có AbortSignal.timeout hay secret patterns trong bundle.
- Package `.artifacts/M5-07-frontend.zip`, SHA256 `BD27B03B182913EE2E59931846C54B4840A2D4A32B9591A25A8CC355FD5535F6`; kiểm public `.artifacts/M5-07-public-evidence.json`. Rollback frontend về `e3229c61-7573-49a1-a05a-c957e6bfa16f` (bản M5-06 đã kiểm trước đó).
- Source trên Pages là baseline `d1b712f` với `commit-dirty=true`, chưa commit theo yêu cầu người dùng. Code/docs/tests M5-06 + M5-07 giữ staged trên branch `fix/M5-07-api-diagnostics`.
- Chưa chứng minh lỗi kết nối iPhone đã hết. Bước tiếp theo: mở lại từ menu bot để nhận bản log, gặp lỗi thì kiểm tra kết nối và sao chép log trong cùng phiên; dùng mã request/phase/status để điều tra. M5-02 và nghiệm thu Worker/GAS/secrets/schema vẫn pending.

## M5-08 — Native fetch nhận sai receiver

Người dùng gửi hai attempts Telegram Desktop (`tdesktop`), build `M5-07-20261012`, POST auth: `NETWORK_ERROR`, phase fetch, HTTP null, TypeError, duration 0–1 ms. Không có attempt `/health` trong báo cáo đó. `online=true` không chứng minh kết nối API. Các dấu hiệu này ưu tiên kiểm tra lỗi JavaScript trước request; chưa đủ từ riêng log để phân biệt mạng/CORS/receiver.

Tái hiện ngày 12/10/2026 khoảng 22:44–22:46 UTC+7:

1. Browser thật mở domain production M5-07 ngoài Telegram: local auth bị chặn đúng (`MISSING_INIT_DATA`); bấm health probe thì `NETWORK_ERROR`/TypeError/HTTP null trong 1 ms. Không gửi credential.
2. Fixture local `.artifacts/M5-08-native-fetch-qa.cjs` so sánh native `fetch` tới cùng data URL public, không mock fetch và không mạng bên ngoài: `client.fetchFn(url)` ném `Failed to execute 'fetch' on 'Window': Illegal invocation` trong 0 ms; `client.fetchFn.call(globalThis, url)` trả HTTP 200/JSON ok trong 3 ms.
3. Source mặc định lưu `fetch` vào instance rồi gọi `this.fetchFn(...)`. JavaScript truyền client instance làm receiver; Window.fetch yêu cầu receiver phù hợp với global Window. Node/jsdom fetch và arrow-function mocks trước đây không bắt ràng buộc Web API này.
4. Hai regression default/injected fetch mô phỏng receiver check thất bại trước sửa (NETWORK_ERROR, cùng phase/status/timing), pass sau sửa. Fix một chỗ gọi bằng `.call(globalThis, ...)`; giữ nguyên auth/CORS/deadline/headers và error sanitization.

Đây là lỗi source đã được chứng minh trên browser, phù hợp pattern báo cáo người dùng; chưa có raw exception hoặc phiên đăng nhập từ Telegram để coi là bằng chứng tất cả lỗi trên mọi thiết bị đều cùng nguyên nhân. Sau deploy cần kiểm health probe từ production và người dùng thử auth lại; không thay Worker/secrets hay bỏ qua xác thực.

## Triển khai frontend M5-08 — 22:48 UTC+7, 12/10/2026

- Deployment Production `1a4f0e48-f02e-4bbe-9ec6-e8e03852a739`, [deployment URL](https://1a4f0e48.voice-chat-learn-language.pages.dev/), project/branch `voice-chat-learn-language` / `production`, theo quyền frontend đã cấp trong cùng incident. Không deploy Worker/GAS hay thay quyền/secrets.
- 84 tests/14 files PASS; typecheck/lint/build/secret scan và diff check PASS. Hai regression receiver fail trước sửa/pass sau sửa. Build ID `M5-08-20261012`.
- Root domain và URL menu gốc đều HTTP 200 với `/assets/index-uo6JRpSE.js`; SHA256 public `D967E9628CCB539002E9E152552341E7EEB4EEA4470C49019013A02D6798D1E4` khớp local. Package `.artifacts/M5-08-frontend.zip`, SHA256 `D1595B6CEDB2A8BCC05312849E470DDFBEFE5BC1218E89479B914FA4CB7B912C`.
- **Browser native production trước/sau:** M5-07 health TypeError/fetch/HTTP null 1 ms; M5-08 GET `/health` OK/complete/HTTP 200 trong 283 ms, có server UUID, vẫn giữ MISSING_INIT_DATA khi mở ngoài Telegram. Không bỏ qua auth. Evidence `.artifacts/M5-08-production-health.json`, `.artifacts/M5-08-public-evidence.json`, `.artifacts/M5-08-native-receiver.jpg`.
- Browser đang mở ban đầu vẫn tải script M5-07 sau reload. HTTP kiểm ngoài browser đã thấy bundle mới; điều hướng một lần tới `https://voice-chat-learn-language.pages.dev/?v=M5-08-20261012` nhận đúng M5-08 và health pass. Chưa xác định lớp cache nào giữ bản cũ. Không dùng URL preview để thử API vì origin khác allowlist; người dùng mở lại Mini App và xác nhận build trong log là M5-08 trước khi đối chiếu.
- Rollback về M5-07: `2883e8b3-e60e-4498-8a29-d0f033bf1051`. Source baseline `d1b712f` + staged M5-06/07/08 (`commit-dirty=true`) trên branch `fix/M5-08-fetch-receiver`; chưa commit theo yêu cầu người dùng.
- Bước tiếp theo: người dùng thử đăng nhập lại trong Telegram Desktop/iOS, nếu lỗi thì gửi log mới có build M5-08 và cả attempt `/health`; xử lý code HTTP/API tiếp theo nếu có. Chưa nghiệm thu real Telegram auth, Gemini hoặc Sheets qua browser health test.

## M5-09 — Auth thật OK, tải từ vựng 503 (LOCAL FIX READY, chưa deploy Worker)

Log người dùng lúc 22:53 UTC+7 xác nhận build M5-08 trên Telegram Desktop: POST auth `OK`, HTTP 200/284 ms, client/server request ID trùng; bốn GET vocabulary `UNAVAILABLE`, HTTP 503/106–204 ms, phase api. Đây là evidence real auth đã thành công và CORS/read envelope hoạt động. Chưa nghiệm thu tải dữ liệu, Sheets, Gemini hoặc iOS.

Trong source production trước hotfix M5-09, 503 UNAVAILABLE của vocabulary được tạo khi `GasRepositoryAdapter.callGas` catch exception của fetch; lỗi JSON/schema/GAS business error thường map 502/403/409/404. Adapter GAS gọi `this.fetchFn(...)`; Telegram sendMessage/answerCallbackQuery có cùng vấn đề receiver. Source repo đã sửa; production còn lỗi này được xác minh lại ngày 13/10 bên dưới. Không suy ra từ riêng mã 503 rằng URL/secret production đã đúng.

Evidence local ngày 12/10/2026 khoảng 22:56–23:00 UTC+7:

- Wrangler 4.149.0 `dev --local`, compatibility_date 2026-10-01 chạy workerd native. GAS mock HTTP localhost trả vocabulary page rỗng; chỉ synthetic HMAC/session/owner, không gọi Google/Telegram thật.
- Trước sửa: fetch native qua instance ném `Illegal invocation: function called with incorrect this reference`; global receiver trả 200. Adapter GAS thật trả `UNAVAILABLE` 503; route vocabulary thật (session synthetic ký/verify bởi source Worker) cũng trả 503. Evidence `.artifacts/M5-09/runtime-before.json`.
- Sửa ba chỗ gọi ở `gas-client.ts` và `telegram-bot-client.ts` bằng `.call(globalThis, ...)`. Sau sửa, cùng runtime/config/mock: adapter list OK và route vocabulary thật HTTP 200/ok true. Evidence `.artifacts/M5-09/runtime-after.json`.
- Bốn regression receiver default/injected fetch fail trước sửa, pass sau sửa. Thêm bốn privacy/category tests cho `gas_fetch_failed`; tổng 92 tests/15 files, typecheck/lint/build PASS, Wrangler deploy --dry-run PASS. Sau stage file mới: secret scan không có forbidden file/secret pattern, diff thường và cached --check PASS. Đây là build local, không phải deployment hoặc real Sheets E2E.
- Log mới không giữ URL GAS, body/signature/HMAC, user ID, transcript hay raw exception; chỉ correlation/action/phase/reason whitelist/name/duration/status. Cloudflare đã mô tả lỗi this reference trong [Workers errors](https://developers.cloudflare.com/workers/observability/errors/#illegal-invocation-errors); runtime local xác minh trực tiếp trường hợp của source này.
- Gói review local `.artifacts/M5-09-worker-local.zip`, SHA256 `348C2DEF8D89E0141E2BC2AB4B9797816FAAB71E6831B5BBBDC92F702FE12B7C`; Worker entry SHA256 `744C267C2B431147493D6A9E97038D2D595FFF107AD7D2519CD874D926909DA5`. Chỉ là output dry-run local; chưa đủ điều kiện dùng làm artifact production trước khi đối chiếu source/version đang chạy theo bước bên dưới.

Quyền truy cập và bước production:

1. OAuth Wrangler hiện có account:read/user:read/pages:write. `wrangler secret list --config apps/worker/wrangler.toml` bị Cloudflare trả “No access to the specified resource”; không phải lỗi approval reviewer. Lệnh chỉ xin tên bindings, không đọc giá trị. Local không có .dev.vars hoặc apps-script/.clasp.json; chưa xác định GAS_EXEC_URL/Script Properties/schema deployment thật.
2. Chưa được cấp quyền deploy Worker. `AGENTS.md` mục 4 yêu cầu xác nhận deploy/thay quyền. Chuẩn bị bản sửa local để review trước khi xin OAuth Workers (`workers:write`, `workers_tail:read`) và hotfix riêng cho Worker hiện có.
3. Sau xác nhận: đọc version/source/binding names của Worker đang chạy, giữ rollback version; đối chiếu local với production trước khi chọn artifact hotfix. Source local M5-05 có schema v2/Cron thay đổi chưa nghiệm thu, nên bundle dry-run toàn bộ chưa được coi là artifact được phép đè lên production khi chưa diff. Hotfix cần giới hạn receiver/log để giữ hành vi/schema đang chạy; phần khác phải được đối chiếu trước.
4. Sau hotfix mới nhờ người dùng thử tải vocabulary, đối chiếu request ID và log backend. Không tạo tài nguyên tính phí, không thay bot token, Apps Script deployment, quyền Sheet hoặc migration trong task này khi chưa có xác nhận.

## Kiểm tra lại ngày 13/10/2026 — M5-09 chưa lên Worker production

Log mới của người dùng lúc **08:53–08:54 UTC+7** vẫn là build frontend M5-08: auth 200, vocabulary 503 UNAVAILABLE. Build frontend không xác định version Worker; cần đọc deployment backend riêng.

Kết quả read-only lúc khoảng 08:55–09:03 UTC+7:

- GET /health: HTTP 200, service voice-chat-worker, version public 0.1.0 (không phải Cloudflare deployment ID).
- GET /api/v1/diag: HTTP 200, gas_configured=true, gas_status=connected, gas_latency_ms=1798. Probe này là GET; không chứng minh GAS POST/HMAC/Sheets hoạt động.
- Wrangler deployments list: active deployment **b06864e7-da1e-45f7-b694-91f91a3a950e**, 100% version **dc9f92a9-91e2-4b7c-b8ca-95aca1e809ba**, tạo 12/10 lúc 18:33 UTC+7. Không có Worker version mới chứa M5-09.
- Versions view và Wrangler init --from-dash --no-delegate-c3 đã đọc source/config thành công. Đây là tải Worker hiện có vào backup local, không tạo/deploy Worker. Blocker thiếu quyền đọc ngày 12/10 đã hết; không xin thêm OAuth.
- Backup: .artifacts/M5-09-current/voice-chat-learn-language-worker/. Trong src/entry.js production, dòng 6871 vẫn gọi this.fetchFn(this.gasExecUrl, ...); Telegram còn hai calls tương tự. Native fetch kiểm receiver khiến exception trước outbound và adapter trả 503.

### Tái hiện bằng chính bundle tải từ production

Fixture .artifacts/M5-09-current/compare-runtime.cjs dùng Miniflare/workerd đang cài; auth Telegram, HMAC, session và GAS đều synthetic, không dùng credentials production hoặc gọi Google/Telegram thật.

| Bundle                                     | Auth | GET vocabulary  | Số GAS requests |
| ------------------------------------------ | ---- | --------------- | --------------- |
| Source active production tải từ Cloudflare | 200  | 503 UNAVAILABLE | 0               |
| Candidate local sau sửa M5-09              | 200  | 200 OK          | 1               |

Evidence JSON: .artifacts/M5-09-current/runtime-comparison.json. Kết quả chứng minh một lỗi cụ thể của bundle active trước khi gọi GAS. Sau deploy vẫn cần real Mini App QA để phát hiện vấn đề upstream tiếp theo nếu có.

### Gói đã chuẩn bị để xin xác nhận

- Worker source repo đã có fix từ 9af53aa và merge 626cbe0; phiên kiểm tra này không cần thêm feature code.
- Diff bundle production/candidate: **31 dòng thêm, 13 dòng xóa**, gồm receivers GAS/Telegram, log lỗi GAS có whitelist, receiver probe GET và khôi phục CORS allowlist ALLOWED_ORIGIN như source repo. Diff đầy đủ: .artifacts/M5-09-current/worker.diff.
- Đã đối chiếu config download: compatibility_date 2026-10-01, Cron 0-5 1 * * *, public vars/Worker name khớp repo. Secret binding names hiện hữu đủ, không đọc giá trị secrets.
- Sau merge: **122 tests/18 files PASS**, npm run typecheck, npm run lint, npm run build, Wrangler deploy --dry-run và Check-Secrets.ps1 PASS. Test log: .artifacts/M5-09-current-tests.log.
- Package: .artifacts/M5-09-current/M5-09-review-package.zip, gồm entry.js, wrangler.toml và manifest.json.
- SHA256 source backup: 41552AD4502ADB8C1B3CFD3E9C8F3CB63E912057DA9F827E6A6148D901F51958.
- SHA256 candidate: B478807CFC7AA665003F408C4359D86411EFB2D54925B8E531ED61C47E164E26.
- SHA256 package: 76E14AE2E56D985A808133906F5CBEE2AEF4F8DDE2D39D1D9AF9508D79C74D21.
- Rollback version đã ghi: dc9f92a9-91e2-4b7c-b8ca-95aca1e809ba. Trước deploy đọc lại active version để không ghi đè thay đổi mới của người khác.

**Trạng thái lúc review trước deploy:** Chưa deploy, chờ xác nhận theo AGENTS.md mục 4. Người dùng đã xác nhận sau đó; kết quả triển khai bên dưới thay thế blocker này. M5-09 vẫn IN_PROGRESS đến khi nghiệm thu vocabulary thật.

## Triển khai Worker M5-09 — 09:08 UTC+7, 13/10/2026

Người dùng xác nhận "deploy cho tôi nhé". Trước deploy, đọc lại active deployment vẫn là b06864e7 / version dc9f92a9 phục vụ 100%; không có thay đổi production mới so với backup đã review. Deploy đúng bundle candidate đã qua 122 tests/18 files, typecheck/lint/build, Worker dry-run và secret scan; không có thay đổi source sau các gates này.

```powershell
npx wrangler deploy --config .artifacts/M5-09-current/candidate/wrangler.toml --no-bundle --message 'M5-09: preserve native fetch receiver for GAS and Telegram; sanitized GAS diagnostics' --tag M5-09
```

- Wrangler 4.149.0 thành công; version **cc64a401-df62-4363-a790-94a5c265361b** (number 12), deployment **1d8816b9-13a8-4d3f-837f-50d2bf48ca97**, tạo 2026-10-13T02:08:18.573289Z, phục vụ **100%**.
- Tải lại source bằng Wrangler from-dash vào `.artifacts/M5-09-current/post-deploy/`; SHA256 entry.js **B478807CFC7AA665003F408C4359D86411EFB2D54925B8E531ED61C47E164E26**, khớp chính xác candidate được duyệt.
- Đối chiếu binding names: đủ sáu secret bindings như trước deploy, không đọc giá trị. Public vars, compatibility_date 2026-10-01 và Cron `0-5 1 * * *` khớp backup; không tạo tài nguyên mới.
- `/health`: HTTP 200/ok true, request ID `c9af1b3e-1bfb-4599-b18a-77b8b3d896da`.
- `/api/v1/diag`: HTTP 200, worker healthy, GAS configured/GET connected, 1813 ms; request ID `2a5703af-4f2f-426e-85ca-da93aa05f92c`.
- OPTIONS vocabulary từ origin Mini App: 204 và allow-origin chính xác `https://voice-chat-learn-language.pages.dev`; origin lạ: 204 nhưng không có allow-origin, trình duyệt không được cấp CORS.
- Evidence local: `.artifacts/M5-09-current/deployment-evidence.json`, `post-deploy-deployment.json`, `post-deploy-probes.json`. Giữ nguyên review ZIP/manifest trước deploy và backup production cũ; chưa commit docs theo trạng thái phiên hiện tại.

Rollback đã giữ version **dc9f92a9-91e2-4b7c-b8ca-95aca1e809ba** và source backup riêng. Chỉ dùng nếu cần xử lý sự cố; không thực hiện rollback trong phiên này.

**Nghiệm thu còn lại:** đóng/mở lại Mini App từ bot, thử tải vocabulary và sao chép log mới nếu lỗi. Frontend vẫn có build M5-08-20261012 vì hotfix nằm ở Worker. Probe diag chỉ thử GET Apps Script, chưa xác minh POST HMAC/Sheets; native comparison dùng GAS mock, không thay thế luồng Telegram thật. Giữ M5-09 IN_PROGRESS / DEPLOYED_WAITING_TELEGRAM_QA; chưa chạy Complete-Task.

## Log iOS 09:40 UTC+7, 13/10 — vocabulary OK, live-token Google HTTP 400 (M5-10)

Người dùng gửi log iOS build M5-08-20261012 sau deploy M5-09:

| Route | Kết quả | Thời gian | Request ID |
| --- | --- | --- | --- |
| POST auth/telegram | 200 OK | 565 ms | web-5c3c2664fd3eb9af82ca3d27 |
| GET vocabulary | 200 OK | 4099 ms | web-cdb6ac91020e7b5642016f0b |
| POST live-token | 502 UPSTREAM_ERROR | 415 ms | web-ea7bdefbf8fb2d5ca5fdbc4e |

Người dùng bổ sung thông báo UI: **HTTP 400** phía Gemini. Auth/vocabulary thật đã qua; M5-09 được đóng bằng Complete-Task với 122 tests/gates trước deploy và evidence iOS này. Chưa coi toàn bộ voice/CRUD/FSRS đã nghiệm thu.

### Nguyên nhân được tái hiện

Token issuer gửi trực tiếp `liveConnectConstraints: { model, config }`. [REST AuthToken reference](https://ai.google.dev/api/generate-content#AuthToken) và [Google Discovery v1beta](https://generativelanguage.googleapis.com/$discovery/rest?version=v1beta) dùng `bidiGenerateContentSetup`, với `generationConfig.responseModalities`.

Probe Google bằng key giả (không dùng secrets hoặc tạo token thật):

- Payload cũ: HTTP 400 INVALID_ARGUMENT, **Unknown name "liveConnectConstraints" at 'auth_token': Cannot find field.** Lỗi binding xảy ra trước kiểm key.
- Payload sửa và mask: qua bước binding field, trả HTTP 400 với reason API_KEY_INVALID như mong đợi với key giả; không còn unknown-field. Đây không phải test key/project thật và không chứng minh việc mint sẽ thành công trên production.
- Evidence: `.artifacts/M5-10/google-auth-token-schema.json`, `invalid-key-payload-probes.json`, `candidate-invalid-key-probe.json`. Hướng dẫn ephemeral tại thời điểm đọc vẫn có ví dụ REST dạng SDK không khớp API thực tế; dùng reference/Discovery/response thật để quyết định fix.

### Bản sửa local và xác minh

- `gemini-token-issuer.ts`: dùng `bidiGenerateContentSetup`/`generationConfig`; `fieldMask: "model,generationConfig.responseModalities"` khóa model/audio. Nếu không có mask, Google lấy toàn bộ setup lúc mint và bỏ setup của client, làm mất instructions/tools/transcription/resumption handle. Giữ uses 1 và TTL 20 phút/new-session 1 phút.
- `gemini-token-issuer.test.ts`: hai regression (model có/không prefix), fail trước sửa/pass sau sửa, kiểm REST contract/mask/TTL/single-use và không lộ key trong kết quả.
- **124 tests/19 files PASS**, typecheck/lint/build, Worker dry-run 252.43 KiB/gzip 48.08 KiB, secret scan và git diff --check PASS. Logs `.artifacts/M5-10/`.
- Candidate so với source production cc64a401: **6 dòng thêm, 5 dòng xóa**, chỉ payload cấp token. Không đổi public API, frontend, secrets/model/tier, GAS/schema hay Cron.
- Package `.artifacts/M5-10/M5-10-review-package.zip`, SHA256 **353DD567FB7C4A9E1202DCE148FAA9EE29A02A125E387B610182B1C802E16C4E**.
- Candidate entry.js SHA256 **F551D88B71C3AF0DDE7A17BD1795637F8F680000386BE5158CC0CF0B9F993746**; diff `.artifacts/M5-10/worker.diff`.
- Read-only active deployment lúc chuẩn bị: vẫn **1d8816b9 / cc64a401-df62-4363-a790-94a5c265361b, 100%**. Backup source `.artifacts/M5-09-current/post-deploy/`; dùng version cc64a401 làm rollback cho M5-10.

**Trạng thái trước xác nhận riêng:** Automatic approval review từ chối deploy vì coi M5-10 là thay đổi payload Gemini khác bản M5-09 đã được phê duyệt và chưa có xác nhận rõ riêng. Lệnh không chạy; không thử workaround. Người dùng sau đó xác nhận "deploy cho tôi nhé"; kết quả triển khai bên dưới thay thế blocker này.

## Triển khai Worker M5-10 — 10:43 UTC+7, 13/10/2026

Người dùng xác nhận riêng M5-10 sau báo cáo payload/124 tests và lần auto-review từ chối. Trước deploy đọc lại active deployment vẫn 1d8816b9 / cc64a401 phục vụ 100%, SHA256 candidate/ZIP khớp gói đã review; không có thay đổi source sau gates (chỉ format file test bằng Prettier và hai regression vẫn pass).

```powershell
npx wrangler deploy --config .artifacts/M5-10/candidate/wrangler.toml --no-bundle --message 'M5-10: fix AuthToken REST setup fields; lock model/audio and preserve client session config' --tag M5-10
```

- Wrangler 4.149.0 upload/triggers thành công, startup 11 ms; version **e07a24e2-5aeb-4aae-93cb-c6be6a79aa1d** (number 13), deployment **63ab0051-18f1-41cc-9f06-27902cae6280**, tạo **2026-10-13T03:43:26.4223Z**, phục vụ **100%**.
- Download source/config mới bằng from-dash vào `.artifacts/M5-10/post-deploy/`; SHA256 entry.js **F551D88B71C3AF0DDE7A17BD1795637F8F680000386BE5158CC0CF0B9F993746**, khớp chính xác artifact đã duyệt.
- Đối chiếu với backup cc64a401: tên sáu secret bindings giữ nguyên, không đọc giá trị; public vars, compatibility_date, workers_dev/preview_urls và Cron giữ nguyên. Không đổi frontend, key/model/tier hoặc GAS/schema.
- `/health`: HTTP 200/ok true, request ID `ffcc087e-d918-4e89-b82e-3d6afb36f782`.
- `/api/v1/diag`: HTTP 200, Worker healthy, GAS GET connected 1725 ms; request ID `f61d4b83-5c3f-4e32-9745-246ee38812a9`.
- OPTIONS live-token: origin Mini App nhận 204 và allow-origin đúng `https://voice-chat-learn-language.pages.dev`; origin lạ không có allow-origin.
- Evidence: `.artifacts/M5-10/deployment-evidence.json`, `post-deploy-deployment.json`, `post-deploy-probes.json`; review ZIP/manifest trước deploy được giữ nguyên.
- Rollback: **cc64a401-df62-4363-a790-94a5c265361b**, source backup `.artifacts/M5-09-current/post-deploy/`. Không thực hiện rollback trong phiên này.

**Nghiệm thu còn lại:** mở lại Mini App, bấm Start và kiểm live-token 200/kết nối voice thật. Nếu còn lỗi, nhận log mới và HTTP phía Google hiển thị trên UI, đối chiếu request ID. Frontend build vẫn M5-08-20261012 là bình thường; health/diag không thử Gemini và schema probe dùng key giả không chứng minh project key/quota/model hợp lệ. Giữ M5-10 IN_PROGRESS / DEPLOYED_WAITING_LIVE_QA, chưa chạy Complete-Task/chưa commit.

## Xác nhận người dùng sau M5-10 — 13/10/2026

Người dùng xác nhận **"đã hoạt động"**, yêu cầu **commit/push toàn bộ lên Git và merge main**. Đây là bằng chứng nghiệm thu hotfix sau deploy e07a24e2; không nhận thêm log chi tiết để ghi status/latency riêng của voice. M5-10 được đóng bằng Complete-Task lúc 12:43 UTC+7, cùng evidence 124 tests/19 files/gates và source production khớp artifact. Trạng thái chờ live QA của hotfix ở phần trước là lịch sử; QA đầy đủ thiết bị/FSRS, quota và backup/restore tiếp tục các task riêng.

Git delivery bao gồm toàn bộ thay đổi source/docs/regression hiện tại cùng lịch sử FSRS/online staging/M5-09 đã merge trên nhánh fix/M5-10-gemini-token-diagnostics. Remote default branch main không được bảo vệ tại thời điểm kiểm tra; không đổi branch protection. Artifacts/credentials vẫn được gitignore, không đưa vào commit.
