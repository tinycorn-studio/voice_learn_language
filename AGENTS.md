# AGENTS.md — QUY TẮC BẮT BUỘC CHO MỌI CODING AGENT

> File này là authority của quy trình phát triển. Áp dụng cho AI coding agents, lập trình viên, reviewer và scripts trong repository.

## 0. ĐỌC TRƯỚC KHI CHỈNH SỬA

1. Mở `README.md`, `PROGRESS.md`, `docs/13_MILESTONES.md`, và file spec liên quan task.
2. Kiểm tra `git status --short`, giữ nguyên thay đổi chưa commit của người khác. Không ghi đè file đang sửa/chưa rõ nguồn.
3. Chọn **một Task ID** từ `PROGRESS.md` (`M0-01`, `M1-02`...). Nếu tạo công việc mới, thêm ID/task vào PROGRESS trước khi code.
4. Viết mô tả thay đổi và tiêu chí hoàn thành; không bắt đầu tính năng ngoài phạm vi task.
5. Không tuyên bố pass test/deploy nếu chưa thực sự chạy.

## 1. QUY TRÌNH MỖI TASK (KHÔNG ĐƯỢC BỎ QUA)

**Before:** đọc tiến trình → chọn task → xác minh tài liệu API/quota mới nhất → cập nhật trạng thái `IN_PROGRESS` và ghi chú nếu cần → tạo branch `feat/Mx-yy-topic` hoặc `fix/Mx-yy-topic`.

**During:** thay đổi nhỏ, thêm test, chạy check phù hợp, cập nhật docs/API/schema/migration và ADR nếu thay kiến trúc. Quyết định đổi công nghệ cần ghi `docs/14_DECISIONS.md`.

**After:** kiểm tra test/build, đối chiếu acceptance criteria, cập nhật `PROGRESS.md` **trong cùng commit** với code: đánh dấu `[x]` đúng ID, ghi bằng chứng và đường dẫn, thời điểm UTC+7, tiếp theo và blocker; bổ sung `CHANGELOG.md`. Nếu đang dở, để `[ ]`, cập nhật `IN_PROGRESS`/blocker/next command. Dùng script `scripts/Complete-Task.ps1` sau khi test pass; nếu script lỗi sửa tay và giữ cùng định dạng.

**Cuối phiên:** `PROGRESS.md` phải nói chính xác người tiếp theo phải làm gì. Một task chưa test không được đánh dấu hoàn thành; tài liệu chưa phải code chạy thật.

## 2. THIẾT KẾ / CẤU TRÚC

- Monorepo: `apps/web` UI, `apps/worker` API/Telegram/Cron, `packages/shared` schema/tokens, `apps-script` Google integration. Không import module Node hoặc Cloudflare vào web/shared.
- Dùng TypeScript `strict: true`, `noUncheckedIndexedAccess: true`, `exactOptionalPropertyTypes: true` khi tạo TSConfig. Không dùng `any` trừ khi có bình luận giải thích, ưu tiên `unknown` + schema runtime (Zod).
- Áp dụng SOLID vừa đủ, chức năng nhỏ, phụ thuộc qua interface, phân tách `domain/application/infrastructure/presentation`. Không over-engineer microservice/CQRS cho MVP.
- Dùng repository adapter `VocabularyRepository`, `ReviewRepository`; có thể thay Sheets bằng D1/Supabase mà không đổi domain.
- Boundary validation bắt buộc tại mọi API, webhook, function call, output AI và input Sheets. Không tin model-generated JSON là hợp lệ.
- Idempotency `event_id`, uniqueness `user_id + lemma + part_of_speech + sense_key`. Google Sheet cần `LockService.getScriptLock()` cho thao tác read-modify-write; không tin `appendRow` là atomic upsert.
- `UTC ISO8601` tại lớp dữ liệu, timezone `Asia/Ho_Chi_Minh` khi hiển thị và chọn lịch gửi thông báo. Cron Cloudflare dùng UTC.
- **Quy tắc FSRS Spaced Repetition**:
  - Nghiêm cấm tự viết lại công thức FSRS thủ công (stability, difficulty, retrievability, interval). Bắt buộc dùng thư viện chính thức `ts-fsrs` (`@open-spaced-repetition/ts-fsrs`).
  - Tính toán lịch ôn tập FSRS có thẩm quyền (authoritative scheduling) bắt buộc chạy ở backend tin cậy (`@voice-chat/shared` / Worker / Apps Script). Frontend chỉ gọi preview và submit, không tự tính toán để ghi đè lịch lên server.
  - Tách bạch thực thể từ vựng (`Words`) và trạng thái thẻ ôn (`Cards`). Một mục từ vựng có thể gắn với nhiều Card độc lập.
  - Lịch sử ôn tập (`Reviews`) là append-only, lưu đầy đủ snapshot trạng thái (`previous_state`, `next_state`, `due_at`, `stability`, `difficulty`, `review_log_json`). Không xem log là thông tin tạm thời.
  - Đảm bảo ngữ nghĩa đánh giá 4 nút FSRS: `Again` (quên), `Hard` (nhớ khó khăn — tuyệt đối không coi là fail), `Good` (nhớ bình thường), `Easy` (nhớ dễ dàng).
  - Cấu hình FSRS (`desired_retention = 0.90`, `maximum_interval`) phải tập trung tại một nguồn duy nhất (Single Source of Truth), validate cấu hình trước khi nạp vào scheduler.

## 3. QUY CHUẨN ĐẶT TÊN / FORMAT

- Tên file TS `kebab-case.ts[x]`, component React `PascalCase`, function/variable `camelCase`, type/interface `PascalCase`, constant `SCREAMING_SNAKE_CASE`, route `/api/v1/kebab-case`.
- `.editorconfig`: LF, UTF-8, 2 spaces JS/TS/JSON/YAML, 4 cho PowerShell nếu cấu hình riêng, final newline; dùng Prettier.
- Import: external -> shared -> internal; không import xuyên tầng ngược; không circular dependency.
- Ưu tiên pure functions cho normalize, classify, SRS. Không nhét business logic vào React component hoặc HTTP handler.
- Comment giải thích **tại sao**, không chỉ mô tả dòng code; public contract có JSDoc. Viết docs bằng tiếng Việt, source symbols bằng tiếng Anh.

## 4. AN TOÀN / BẢO MẬT

- **KHÔNG** commit/sao chép API keys, bot tokens, Telegram initData, nội dung voice riêng tư, `.clasprc.json`, `.dev.vars`, `.env.local`, `.clasp.json` tài khoản cá nhân.
- Chỉ `apps/worker` giữ `GEMINI_API_KEY`, `TELEGRAM_BOT_TOKEN`, `GAS_SHARED_SECRET`; dùng `wrangler secret put`, không có secret ở frontend.
- Chỉ cấp ephemeral token cho user được xác thực; `uses:1`, model/scope ràng buộc, TTL ngắn, rate limit/throttle.
- Telegram Bot webhook: bắt buộc kiểm tra `X-Telegram-Bot-Api-Secret-Token`; Telegram Mini App `initData` phải xác minh HMAC ở Worker, kiểm tra `auth_date` và user allowlist; `initDataUnsafe` chỉ để hiển thị, **không dùng xác thực**.
- Worker → Apps Script: ký HMAC-SHA256 trên raw `payload`, timestamp + nonce/event ID; Apps Script kiểm chứng chữ ký trước khi ghi; chống replay bằng timestamp+event table.
- Chặn formula injection vào Google Sheets; giới hạn độ dài từ, ví dụ, tổng body; không log toàn bộ transcript, raw token hoặc PII; lỗi công khai không có stacktrace.
- Hành động deploy/thay quyền/ngân sách có yêu cầu xác nhận; không tự động tạo tài nguyên tính phí.

## 5. HIỆU NĂNG / CHI PHÍ

- Không proxy luồng âm thanh qua Worker nếu frontend có thể kết nối trực tiếp Gemini bằng ephemeral token; tránh overhead/CPU/bandwidth.
- Không gọi AI text cho mỗi audio chunk; dùng Function Calling hoặc detector sau `turn_complete`. Chặn trùng bằng `event_id`.
- Cache an toàn cấu hình/chức năng công khai; không cache token riêng của user. Retry network bằng exponential backoff + jitter **chỉ** cho lỗi transient và idempotent.
- Apps Script/GSheets dùng batch reads/writes, không loop 1 HTTP request mỗi row; khi tần suất lớn đổi repository sang D1.
- Không lưu toàn bộ audio mặc định; không bật recording analytics không cần thiết.

## 6. TEST / QA (GATE BẮT BUỘC)

- Unit test cho normalization, detector intent, SRS, timezone, payload validation, deduplication.
- Integration test cho Worker ↔ Apps Script mock, Telegram webhook/signature, Gemini function-call mock.
- E2E smoke: voice hỏi 1 từ → có 1 row; retry không sinh thêm row; Telegram nhắc và trả lời → next_review đổi.
- CI chạy `typecheck`, `lint`, `test`, `build`; chỉ deploy sau khi pass. Nếu env thiếu khiến chưa test được, giữ task ở `BLOCKED`/`IN_PROGRESS`.
- Error handling: typed errors, sanitized logs với `request_id`, timeouts, retry budget; không swallow exceptions.

## 7. TỰ ĐỘNG HÓA GOOGLE APPS SCRIPT

- **Nguồn code chuẩn là `apps-script/` trong Git.** AI agent sửa file tại đây, kiểm thử rồi `clasp push`, tạo version và `clasp redeploy` khi được phép.
- Trước `clasp push` vào project có thể đã có code trên web editor: chạy `clasp pull` trong nơi backup riêng và diff; `push --force` bị cấm trừ khi đã review và có backup.
- `clasp push` chưa có nghĩa bản Web App đang public đã đổi; phải update/redeploy deployment phù hợp. Quy trình chi tiết `docs/05_APPS_SCRIPT_SETUP.md`.
- Không đưa OAuth refresh token `~/.clasprc.json` vào Git. CI/CD chỉ được phép sau khi thiết kế secret storage và branch protection.

## 8. TÀI LIỆU / TIẾN ĐỘ BẮT BUỘC

- `PROGRESS.md`: trạng thái chính xác, Task ID, mức ưu tiên, checklist, latest result, next action, blocker, test/deploy evidence.
- `CHANGELOG.md`: thay đổi hướng người sử dụng và thay đổi hệ thống.
- `docs/14_DECISIONS.md`: mọi decision kiến trúc mang tính dài hạn.
- Khi thêm API: cập nhật `docs/08_API_CONTRACTS.md`; khi đổi schema: cập nhật `docs/09_DATA_SCHEMA.md`; khi đổi setup: cập nhật docs setup tương ứng.
- **Mỗi lần deploy bắt buộc cập nhật doc task tương ứng (`docs/NN_*.md`) trong cùng commit**: ghi version Worker/Pages (kèm rollback), migration đã apply, smoke test, cấu hình/secret cần set và thay đổi hành vi người dùng thấy. Mỗi đợt bổ sung/sửa đổi sau đó phải cập nhật dần chính doc đó (không để doc lệch hành vi thật); UI/hành vi người dùng thấy phải được mô tả kèm file/dòng nếu có thể.
- Không tự đánh dấu milestone hoàn thành chỉ vì các file tài liệu đã tồn tại; acceptance criteria kỹ thuật mới quyết định hoàn thành.

## 9. LỆNH KẾT THÚC MỖI PHIÊN

```powershell
.\scripts\Start-Session.ps1
# ... triển khai, chạy lint/test/build ...
.\scripts\Complete-Task.ps1 -TaskId M0-01 -Evidence 'Đã làm x, kiểm chứng bằng y' -Next 'Tiếp tục M0-02'
git diff --check
git status --short
```

Nếu task chưa xong, không dùng `Complete-Task.ps1`; chỉnh trực tiếp mục `Đang thực hiện` và `Next action` trong `PROGRESS.md`.
