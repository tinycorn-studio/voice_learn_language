# M5-06 — Review và sửa cơ chế FSRS mới

> 2026-10-12, UTC+7. Source đầu vào: working tree FSRS chưa commit sau d1b712f. Branch sửa: fix/M5-06-fsrs-review. Backup nguyên bản đầu vào trong .artifacts/fsrs-before-review/ (gitignored). Không deploy, không chạy migration trên Sheet thật.

## Kết luận

Bản FSRS đầu vào chưa đủ an toàn để release dù baseline 70/70 tests pass. Bộ hồi quy đầu tiên tái hiện 7 lỗi; đã sửa code và bổ sung coverage. Bộ cuối 85/85 tests trên 15 files pass, kèm typecheck/lint/build/Worker dry-run. Secret scan trên toàn bộ files đã stage (kể cả files mới) và cached diff check cũng PASS.

## Findings và sửa chữa

| ID  | Mức | Lỗi trước sửa và kết quả sửa                                                                                                                                            | Bằng chứng                                                                     |
| --- | --- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------ |
| F01 | P1  | Review Again tạo Relearning nhưng mirror legacy thành chuỗi không hợp lệ, API lỗi sau khi đã ghi. Nay mirror learning và giữ state FSRS Relearning.                     | fsrs-regressions: accepts official Relearning                                  |
| F02 | P1  | OCC chấp nhận Card version hoặc Word version, cho phép stale/nhầm Card. Nay chỉ Card.row_version, kiểm lại sau lock; Word CRUD độc lập.                                 | checks Card row_version; concurrent ratings; app-flow hai Cards                |
| F03 | P1  | Fingerprint bỏ expected_version; retry đọc Card trước replay nên fail sau delete/config đổi. Nay canonical client IDs/rating/versions và lookup replay trước đọc.       | changed expected_version; replay after deletion; app-flow mất ACK              |
| F04 | P1  | Dry-run migration vẫn tạo tabs/header, hướng dẫn gọi sai helper. Nay inspect trước write, wrapper public có lock, nâng đủ header v1/v2/v3.                              | dry-run real v1 không đổi rows/tabs/properties; header result_json/claim_token |
| F05 | P1  | Có Cards nhưng chưa migrate hết làm Words còn lại biến mất khỏi due. GET card còn tự append không lock. Nay fallback từng Word thiếu Card, GET read-only.               | partial migration + code getCard_; migration lặp                               |
| F06 | P1  | Settings tồn tại nhưng không được đọc/apply. Nay Card context kèm Settings, Zod validate config/weights và cùng config cho preview/submit.                              | retention đổi tác động lịch; config lỗi bị từ chối                             |
| F07 | P2  | Stats tính UTC day và vẫn đếm Card của Word deleted. Nay UTC+7, due đến cuối ngày, active filter và không preview Word deleted/suspended.                               | local day/deleted stats; schema giữ relearning_cards                           |
| F08 | P1  | UI lấy Words làm thẻ, submit Word version nên không ôn nhiều Cards độc lập. Nay due Cards + row_version, backend stats, reverse face và refresh queue.                  | app-flow 2 Cards cùng Word, Word edit, retry/remount                           |
| F09 | P2  | scheduled_days=0 hiển thị cùng nhãn dưới 10m cho cả 1m/10m. Nay nhãn từ next_due_at. Telegram xác nhận bằng ngày giờ UTC+7 thay vì 0 ngày.                              | panel minute badges; Telegram source                                           |
| F10 | P1  | Native log bị viết lại state/due, thiếu full snapshots/versions để audit. Nay giữ log nguyên thư viện và cột snapshot trước/sau, revision thực tế.                      | native audit fields + previous/next Card versions                              |
| F11 | P1  | Migration suy memory không hợp lệ từ SM-2, re-enable suspended. Nay cold start New/S=0/D=0, giữ due/counts/suspended và Word archive; thư viện khởi tạo ở rating thật.  | migration cold start/suspension; official next stability finite                |
| F12 | P1  | Review có nhưng Events thiếu snapshot vẫn được đoán replay từ Word hiện tại. Nay 409 yêu cầu đối chiếu, không tạo Review thứ hai.                                       | incomplete review requires reconciliation                                      |
| F13 | P1  | Telegram keyboard dùng Word ID/version; nhận diện Card bằng c_ làm Card ID khác tiền tố lỗi. Nay target Card ID/version, repository resolve alias cũ không dựa tiền tố. | Telegram independent Card reverse_bank; legacy callback regressions            |
| F14 | P2  | Thẻ kế tiếp hiện trong khi lần chấm trước còn xử lý, reveal mới có thể bị reset bởi ACK cũ. Nay khóa reveal khi busy, chờ hoàn tất trước thao tác tiếp.                 | app-flow toàn bộ suite tái hiện race và pass sau sửa                           |

Các file chính: packages/shared/src/srs/fsrs-engine.ts, packages/shared/src/contracts/api.ts, apps/worker/src/adapters/gas-client.ts, apps/worker/src/entry.ts, apps-script/Code.gs, apps/web/src/app/App.tsx và FlashcardReviewPanel.tsx.

## Xác minh đã chạy

| Gate                                                                                             | Kết quả                                                                             |
| ------------------------------------------------------------------------------------------------ | ----------------------------------------------------------------------------------- |
| npm test -- --reporter=dot                                                                       | 85 tests / 15 files PASS, 2026-10-12 13:58 +07; log local .artifacts/fsrs-tests.log |
| npm run typecheck                                                                                | PASS, gồm workspace và tsconfig.tests.json                                          |
| npm run lint                                                                                     | PASS, gồm workspace và tests                                                        |
| npm run build                                                                                    | PASS, Vite 58 modules; web JS 332.54 kB / gzip 99.37 kB                             |
| npx wrangler deploy --dry-run --config apps/worker/wrangler.toml --outdir .artifacts/worker-fsrs | PASS, bundle 248.96 KiB / gzip 47.21 KiB; không upload                              |
| Secret scan / git diff --check                                                                   | PASS: Check-Secrets.ps1 gồm files mới đã stage; cached diff sạch                    |

Library repeat/next đối chiếu [repository chính thức](https://github.com/open-spaced-repetition/ts-fsrs) và [TypeDoc](https://open-spaced-repetition.github.io/ts-fsrs/) ngày 2026-10-12; implementation dùng bản 5.4.2 trong lockfile, FSRSVersion export báo FSRS-6.0. Không đổi provider/model/quota trong task này.

## Giới hạn và việc tiếp theo

- Chưa Google Sheets/LockService thật, Telegram thật, Gemini thật hoặc PC/Android/iOS live QA. VM/OCC tests không chứng minh transaction ngoài dịch vụ.
- Sheets không ACID xuyên tabs. Crash giữa Card/Word/Reviews/Events cần đối chiếu; xử lý partial commit an toàn không thay thế storage có transaction.
- Phải backup và migrateSchemaV3(true/false) trước writers mới. Cold start memory legacy có chủ đích; Settings trống dùng defaults tập trung; daily limits trong Settings chưa thực thi vào queue.
- Events FSRS thử nghiệm cũ có fingerprint khác có thể conflict, không tự đổi event để chấm lại.
- UI pending chỉ giữ trong phiên; chưa API tạo/quản lý Card types hoặc audio listening/optimizer.
- Staging runbook: FSRS_MIGRATION.md; live checklist: FSRS_TEST_PLAN.md. M4-04/M4-FSRS giữ CODE_FIXED/pending live; M5-06 chỉ hoàn tất sửa và kiểm chứng local.
