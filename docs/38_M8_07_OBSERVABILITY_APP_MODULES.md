# M8-07 — Production latency observability và chia nhỏ app orchestration

## Mục tiêu

Cho phép xác định độ trễ theo API route, D1 action, Telegram callback và các mốc giao diện; đồng thời tách dần trách nhiệm trong `App.tsx` thành hook/component có thể kiểm thử độc lập mà không đổi hành vi.

## Phạm vi

- Bật Cloudflare Workers Logs trong Wrangler, lấy 100% sample cho Worker cá nhân và tắt invocation logs để tránh lưu URL/path nguyên bản. Dùng các sự kiện structured log hiện có (`api_request_complete`, repository operations, Telegram callback/delivery) làm dữ liệu Query Builder.
- Đổi logger sang gửi object JSON có field riêng sau khi redaction; chỉ log route template, action/status, duration và số lượng. Không gửi transcript, từ, nghĩa, token, initData, IP, user-agent hay message lỗi thô vào Workers Logs.
- Giữ timing frontend trong memory của phiên. Diagnostics tự tính p50/p95 từ các mẫu đã thu cho API, persistence capture và startup, giới hạn bởi các cửa sổ hiện tại; không gửi metric client hoặc nội dung học tới backend.
- Khi Telegram WebApp bridge nạp chậm, auth chờ tối đa 2.5 giây để đọc lại raw `initData` mỗi 100 ms trước khi ghi `MISSING_INIT_DATA`; chỉ chia sẻ một auth promise trong thời gian chờ.
- API p50/p95 loại attempt `phase=local` và `phase=configuration` vì chúng dừng trước fetch và không đo round-trip mạng. Lỗi từ `phase=fetch` trở đi vẫn được giữ trong latency client.
- Bổ sung runbook tạo query p50/p95 trong Cloudflare Query Builder, chỉ rõ sample count, cửa sổ/retention và giới hạn rằng số liệu client chỉ thuộc phiên hiện tại.
- Tách theme, capture queue/status và info dialog hoặc data orchestration khỏi `App.tsx` thành hook/component nhỏ; giữ state machine, thời điểm refresh, retry, UI, và API contract nguyên vẹn.

## Ngoài phạm vi

- Không tạo endpoint telemetry, D1 table, Logpush, third-party destination, dashboard trả phí hay alert có thể phát sinh chi phí.
- Không deploy Worker/Pages hoặc thay đổi secrets, D1, GAS, bot, quota.
- Không tự đặt ngưỡng latency/SLO trước khi có số đo production.

## Tiêu chí hoàn thành local

1. Structured logs có thể group theo route/action/event và tính p50/p95; invocation URL bị tắt; lỗi không ghi raw path/error/client message.
2. Regression tests chứng minh redaction/structured fields và percentile summaries, gồm mẫu rỗng, một mẫu, số lượng chẵn/lẻ và dữ liệu ngoài schema.
3. Diagnostics UI/export hiển thị rõ `sample_count`, p50, p95 và ghi đây là số liệu giới hạn theo phiên.
4. App hooks/components có tests hoặc được bao phủ bằng regression hiện hữu; full behavior không đổi.
5. Typecheck, lint, full tests, build, secret scan và `git diff --check` đều pass.
6. Production p50/p95 chỉ được ghi sau deploy và có đủ traffic thật; không đánh dấu là đã đo bằng benchmark local.
7. Regression chứng minh auth chờ Telegram `initData` raw đến trong khoảng giới hạn, timeout vẫn trả `MISSING_INIT_DATA`, và các auth gọi đồng thời dùng chung một attempt.
8. Regression chứng minh attempt `phase=local` và `phase=configuration` không làm sai sample count/p50/p95 của API.

## Deploy và xác minh production — 2026-10-16

- Theo yêu cầu người dùng, Worker production deployment `a74f24a2-9040-4ae7-9497-0bc8784a434c`, version `dcc1f421-212f-491d-8965-530b7570b61b`; rollback deployment `045c6229-f68c-4c90-ba8a-3ae04fdb371d`, version `b667f34c-6776-40db-b498-0bab921ebcb9`. D1/cron bindings giữ nguyên.
- Pages production branch `production`, build `M8-07-20261016`, deployment `e38f42b6-0661-4228-9b54-7c5fef3cd673`, source HEAD `f07253c` với working tree dirty; rollback M8-06 `802f523e-0af0-4918-b2af-6666b0c811c2`.
- Smoke: Worker `/health` HTTP 200; vocabulary chưa auth HTTP 401 JSON. Wrangler tail trên version mới thấy structured `api_request_complete`, route template `/health`, status/duration.
- Pages canonical và deployment URL HTTP 200. Entry JS `index-DQNbh5t8.js` SHA256 `62BBDDE9EFE24BA1F22A40FA43E1AA4FF2F24338FA7E5C2A1C50C76307882F52`; CSS `index-DtsbfbpB.css` SHA256 `85AFDA768B2B256AA559D93C4C4F1EF9BA2F3CB6092B5CF754F79A16726F2E8E`; Vocabulary chunk `VocabularyManagerPanel-B6jPZbYg.js` SHA256 `C83CFEC26C6853F16E491568525D68E173074B72C65CD20BC29931CA7425A48F`; Review chunk `FlashcardReviewPanel-LtSWAWNV.js` SHA256 `6FADBFE041DEF1E9E139F6A87DBDBB925934778A214D84458A729C8674362F29`. Public hashes match local build.
- Chưa có đủ production traffic để báo p50/p95 đại diện; smoke probe `/health` chỉ xác nhận log pipeline, không phải latency benchmark. Không thay D1 schema, secret hay GAS; chưa commit/push.

## Chẩn đoán follow-up từ log Telegram — 2026-10-17

- Log lúc 13:52 +07 ghi lần đầu `MISSING_INIT_DATA` ở `phase=local`, `http_status=null`, `server_request_id=null`, `duration_ms=0`; đây là guard phía trình duyệt, không có request nào tới Worker. Lần auth sau trả HTTP 200 trong 287 ms; `auth_ready` và `voice_ready` lần lượt ở 2.720/2.722 giây sau mount. Phiên đã đăng nhập thành công.
- Latency API trong log gồm hai mẫu `[0, 287]`, nên p50 144 và p95 273 ms bị kéo xuống bởi validation local; chúng không đại diện cho round-trip API.
- Follow-up frontend đợi Telegram bridge hữu hạn trước khi ghi lỗi, vẫn chỉ dùng raw signed `initData`; thống kê API bỏ mẫu local và cấu hình bị chặn trước fetch. Đây là sửa source local, không gửi dữ liệu telemetry mới và không đổi API/backend.
- Log được cung cấp ghi build `M8-09-20261016`, nhưng repository có source mới nhất ở commit `2a259f7` (`M8-07`). Cloudflare dashboard gắn deployment `5056740a-b910-489c-a55f-877ca26ee871` với commit label M8-07; về sau kiểm tra runtime trên đúng deployment này đã xác nhận bundle thật là `M8-09-20261016`, có chủ đề hội thoại và thống kê. Đây là lý do không được suy phiên bản bundle từ commit label.
- Verification local trên branch `fix/M8-07-auth-startup-diagnostics`: full suite 218/218 tests (36 files), workspace + test TypeScript checks, workspace + test/script ESLint, workspace build và `git diff --check` pass. Git grep theo các pattern secret của `Check-Secrets.ps1` và danh sách file tracked không tìm thấy secret/credential; PowerShell không có trong môi trường nên wrapper script chưa chạy. Ở mốc ghi nhận này artifact chưa được deploy; follow-up phát hành theo yêu cầu ngày 17/10 được ghi bên dưới.

## Phát hành auth-startup follow-up — 2026-10-17

- Theo yêu cầu deploy riêng của người dùng, build frontend `M8-07-AUTHFIX-20261017` được upload qua Cloudflare Pages vào Production: deployment `cf3b57ac-104f-4059-b0ab-6de069c06cb6`; unique URL `https://cf3b57ac.voice-chat-learn-language.pages.dev`. Canonical mở được entry `/assets/index-BT0f-O0E.js` khớp artifact local; ngoài Telegram, `MISSING_INIT_DATA` xuất hiện sau 2505 ms như giới hạn chờ đã đặt.
- Người dùng phát hiện bản này mất chủ đề nói chuyện và thống kê. Ngày 2026-10-17 20:24 +07, Production đã rollback về `5056740a-b910-489c-a55f-877ca26ee871`. Xác minh trên canonical Pages: log build `M8-09-20261016`, có “Hội thoại hôm nay”, lựa chọn tình huống và “Luyện từ đến hạn”. Đây là xác nhận bundle trước đó không phải M8-07 cũ như nhãn deployment gợi ý. Màn thống kê yêu cầu đăng nhập Telegram nên chưa xác minh trong browser thường.
- Source M8-09 chưa có trong folder local hoặc các nhánh GitHub hiện có; auth-startup fix còn trong working tree và chưa có trong Production. Cần tìm source M8-09, tích hợp fix rồi phát hành trên đúng codebase. Worker, D1, GAS, secrets và Telegram bot không đổi.
- Gates source trước lần upload: 218/218 tests/36 files, workspace/test typecheck, lint, Vite build và `git diff --check` pass. Chưa đủ production traffic để báo p50/p95 đại diện.

## Runbook Cloudflare sau deploy

1. Mở Workers & Pages → Worker `voice-chat-learn-language-worker` → Observability → Query Builder.
2. Lọc `event = api_request_complete`, group theo `route`, thêm P50 và P95 của `duration_ms`; giữ `http_status` để tách response lỗi.
3. Lọc `event = repository_operation_complete` hoặc `repository_preflight_complete`, group theo `backend` và `action`, thêm P50/P95 `duration_ms`.
4. Lọc `event = telegram_callback_ack` hoặc `telegram_review_committed`, thêm P50/P95 `duration_ms`. `telegram_delivery_result` là delivery outcome, không phải callback latency.
5. Ghi khoảng thời gian và số mẫu cạnh mỗi kết quả; so route API (Worker + storage) với local client timing để tách server time khỏi network/device. Kiểm tra Worker CPU ở Metrics/Analytics riêng; `duration_ms` không phải CPU time.

Cloudflare docs được đối chiếu ngày 2026-10-16: [Workers Logs](https://developers.cloudflare.com/workers/observability/logs/workers-logs/), [Query Builder](https://developers.cloudflare.com/workers/observability/query-builder/), [Observability pricing](https://developers.cloudflare.com/observability/pricing/). Tại ngày kiểm tra, Workers Free Logs nêu giới hạn 200,000 log events/ngày và 3 ngày retention. Cloudflare công bố đổi pricing từ 2026-12-01; trước khi deploy và theo dõi sau đó cần xem Billable Usage theo plan thật. Query/dashboard không phát sinh phí riêng; không suy ra toàn bộ tài khoản đang dùng Free chỉ từ giới hạn dịch vụ.
