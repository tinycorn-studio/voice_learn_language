# 17 — Free tier, chi phí, quota & cảnh báo

> Snapshot nghiên cứu: 12/10/2026. **Không cam kết miễn phí vô hạn**; phải xác nhận trực tiếp trong tài khoản/project và trang giá ngay trước deploy.

| Thành phần | Chi phí cơ bản | Điều kiện/rủi ro | Tham khảo chính thức |
|---|---|---|---|
| Gemini 3.8 Live | Free Tier có liệt kê tại thời điểm lập plan | Giới hạn rate/model/region/project; nếu vượt quota có thể 429; paid usage khi bật billing | https://ai.google.dev/gemini-api/docs/pricing |
| Cloudflare Workers | Free Tier | 100k requests/day, CPU 10ms/request, max 5 cron triggers/account (số liệu tại thời điểm viết), bị thay đổi theo plan | https://developers.cloudflare.com/workers/platform/limits/ |
| Cloudflare Pages/Static assets | Free Tier | Build/deploy/bandwidth constraints, review tại thời điểm deploy | https://developers.cloudflare.com/pages/platform/limits/ |
| Google Sheets/Apps Script | free trong quota | Apps Script execution time, UrlFetch, calls; Spreadsheet quota; Workspace policy | https://developers.google.com/apps-script/guides/services/quotas |
| Telegram Bot API | Miễn phí cho nhu cầu bot bình thường | Rate limits/anti-spam; user phải start bot | https://core.telegram.org/bots/api |
| n8n | Không dùng | Không cần self-hosting/cloud subscription | — |
| Anki | Không cần MVP | Optional local PC sync, AnkiMobile iOS là paid app | https://apps.ankiweb.net/ |
| DNS/domain riêng | Không bắt buộc | Cloudflare `workers.dev`/`pages.dev` đủ thử nghiệm | — |

## Giới hạn ước tính/cost guards
- Worker chỉ cấp Gemini token nếu authenticated & allowlisted, áp `max sessions/day` và cooldown.
- Cho phép sử dụng tối đa cấu hình 20–30 phút voice mỗi ngày trước khi xem dashboard; đây là **ngưỡng app tự đề xuất**, không phải quota Google công bố.
- Khi Gemini trả 429/quota exhausted: ngừng cấp token, UI giải thích, không tự bật Paid Tier hay fallback model paid.
- Không ghi API key vào client, không stream qua Worker để tiết kiệm CPU.
- Apps Script sử dụng bulk reads/writes; Sheets không nên làm transactional DB lớn.

## Dashboard cần kiểm trước release
- https://aistudio.google.com/rate-limit
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/deprecations/
- https://dash.cloudflare.com
- https://developers.google.com/apps-script/guides/services/quotas

## Data privacy
Gemini API Free Tier có chính sách dùng nội dung để cải thiện sản phẩm theo trang giá; chỉ gửi audio khi user biết/đồng ý. Không lưu audio tại backend theo mặc định.
