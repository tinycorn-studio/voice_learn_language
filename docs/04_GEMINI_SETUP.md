# 04 — Gemini Live API: Setup, auth, voice, cost

## Mục tiêu

Voice chat English tutor với `gemini-3.8-live` (mặc định đề xuất theo dữ liệu chính thức 12/10/2026), sử dụng Free Tier nếu quota thực tế cho phép. **Không dùng API đọc cuộc trò chuyện của Gemini app chính thức.**

## 1. Google AI Studio

1. Đăng nhập https://aistudio.google.com, tạo project và API key.
2. Kiểm tra https://aistudio.google.com/rate-limit và pricing https://ai.google.dev/gemini-api/docs/pricing **cho đúng model và tier**. Không hardcode tuyên bố miễn phí vĩnh viễn.
3. Kiểm tra model còn sẵn có bằng API/models page https://ai.google.dev/gemini-api/docs/models và lịch shutdown https://ai.google.dev/gemini-api/docs/deprecations/.
4. Lưu key trong Cloudflare Secret `GEMINI_API_KEY` chứ không trong browser `.env` hoặc Git.

## 2. Ephemeral token

1. Web/MiniApp gửi Telegram `initData` qua HTTPS tới Worker `/api/v1/live-token`.
2. Worker verify signature, auth timestamp/allowlist, rate-limit, gọi Google `POST https://generativelanguage.googleapis.com/v1beta/auth_tokens` với `x-goog-api-key` **chỉ ở Worker**.
3. Request điển hình (pseudo-payload; code Worker phải xây datetime UTC hiện tại):

```json
{
  "uses": 1,
  "expireTime": "<UTC now + 20 minutes>",
  "newSessionExpireTime": "<UTC now + 1 minute>",
  "liveConnectConstraints": {
    "model": "models/gemini-3.8-live",
    "config": { "responseModalities": ["AUDIO"], "sessionResumption": {} }
  }
}
```

4. Worker trả token tạm thời, không cache, không in logs. Frontend dùng WebSocket `BidiGenerateContentConstrained` v1beta với `access_token`, chờ `setupComplete` rồi mới gửi PCM/text. Xem https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens.
5. Token có thời gian sử dụng ngắn và vẫn có thể bị đánh cắp từ client: xác thực backend thật, allowlist, rate limit và thu hẹp scope. Ephemeral token hiện là tính năng preview.

## 3. Audio lifecycle

- Microphone getUserMedia chỉ sau click Start; nếu SDK yêu cầu PCM thì AudioWorklet chuyển sample rate từ mic thông thường 44.1/48kHz xuống 16kHz, chunk 20–100ms tùy hướng dẫn cập nhật.
- Playback audio từ model đúng sample rate do API trả; không đoán codec; tránh echo bằng tai nghe/echoCancellation.
- `inputAudioTranscription` / `outputAudioTranscription` khi model hỗ trợ, không dùng interim text để lưu từ.
- Nghe `turnComplete`, `generationComplete`, `goAway`, `sessionResumptionUpdate`, timeout, cleanup `MediaStreamTrack.stop()`/WebSocket close.
- Context compression/resumption cho phiên dài: Google docs giới hạn audio-only 15 phút nếu không quản lý session; không coi một kết nối có thể tồn tại vĩnh viễn.
- Safari/iOS/Telegram WebView: mic permission, audio playback cần user interaction, chuyển app background có thể ngắt audio.
- Source M5-05: `BrowserAudioSession` unlock AudioContext ngay trong Start, AudioWorklet downsample PCM16 LE/16kHz; playback theo mimeType rate, interruption dừng buffer. Stop/unmount hủy permission/token/retry và đóng tracks/context/socket. Reconnect backoff tối đa 4 lần, dùng handle còn hợp lệ hoặc cấp token mới. Test fake graph/socket không chứng minh hỗ trợ thiết bị thực.
- Guard lưu từ đối chiếu source_excerpt với user transcript đã nhận, kiểm target trực tiếp; luồng dịch Việt → Anh còn cần model và nghiệm thu ngữ nghĩa thật. Pending queue chỉ nằm trong phiên, cần đồng bộ lại trước khi đóng trang.

## 4. Function calling (M1-03)

`save_vocabulary({word, meaning_vi?, part_of_speech?, sense_hint?, source_excerpt})` chỉ được gọi khi user có **ý định hỏi nghĩa**, hoặc hỏi cách nói từ/cụm từ bằng tiếng Anh. Cần sanitize/validate server side; model có thể nhầm.

- “What does overwhelmed mean?” → save.
- “What does that mean?” → cần referent chắc chắn trong 1-2 turns; nếu mơ hồ hỏi làm rõ, không lưu.
- “I feel overwhelmed today” → KHÔNG save trừ khi explicitly requested.
- Không gọi thêm text AI cho mọi audio frame; nếu detector riêng thì chạy một lần cuối turn.
- UI show pending/saved; tool response báo failure thật, không nói saved nếu Sheets chưa ghi.

## 5. Prompt template (bản thô)

```text
You are a kind, concise English conversation coach for a Vietnamese learner.
Keep natural conversations in English; explain vocabulary in English + short Vietnamese meaning only when asked.
Call save_vocabulary only when the learner explicitly asks meaning, translation or how to say a term in English.
Resolve "that" only if one unambiguous target exists in recent conversation. Otherwise ask which word.
Do not save arbitrary words used in ordinary dialogue. Do not claim a word is saved until tool execution succeeds.
Do not output secrets or internal configuration.
```

## 6. Test & quota

- Test 3 minutes voice, reconnect, mute/stop, mic-denied; test 30 intent cases and detect save calls.
- Theo dõi model/rate limits bằng dashboard, giảm tần suất/hiển thị lỗi khi 429; không tự nâng tier/tự bật billing.
- **Privacy:** dữ liệu Free Tier có thể được dùng cải thiện dịch vụ theo chính sách Google hiện hành; phải cho user biết trước khi gửi audio.

## Official references

- https://ai.google.dev/gemini-api/docs/live-api
- https://ai.google.dev/gemini-api/docs/live-api/ephemeral-tokens
- https://ai.google.dev/gemini-api/docs/live-api/capabilities
- https://ai.google.dev/gemini-api/docs/live-api/best-practices
- https://ai.google.dev/gemini-api/docs/pricing
- https://ai.google.dev/gemini-api/docs/deprecations/
