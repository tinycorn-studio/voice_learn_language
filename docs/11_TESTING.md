# 11 — Testing & Quality Assurance

## Test pyramid

- Unit: `packages/shared`: `normalizeWord`, `makeWordKey`, `detectVocabularyIntent` (prompt outputs + deterministic cases), `scheduleNextFsrsReview` / `previewFsrsCard` (thư viện chính thức, no I/O), timezone `UTC ↔ +07`.
- Integration: mocked Gemini Live tool calls; Worker/GAS signed requests; Telegram Bot update and verified initData; Apps Script execution with fakes.
- E2E: mobile mic → AI → saving once → Sheets row → Telegram review → `due_at` update.

## Core test cases

| ID    | Input/action                                  | Expected                                                      |
| ----- | --------------------------------------------- | ------------------------------------------------------------- |
| TC-01 | What does overwhelmed mean?                   | save 1 word                                                   |
| TC-02 | What does that mean? after 1 clear antecedent | save that word                                                |
| TC-03 | What does that mean? with 2 candidates        | ask for clarification, do not save                            |
| TC-04 | I feel overwhelmed                            | no save                                                       |
| TC-05 | 3 retries with same event_id                  | exactly one Event + one counted ask                           |
| TC-06 | same word, different meaning                  | separate sense, no clobber                                    |
| TC-07 | HMAC wrong/expired payload                    | rejected, no Sheets modification                              |
| TC-08 | `initData` tampered/expired                   | 401, no live token                                            |
| TC-09 | webhook wrong secret/duplicate update         | rejected/dedup, no double review                              |
| TC-10 | Sheet text starts `=`, `+`, `-`, `@`          | stored as safe literal, not formula                           |
| TC-11 | user taps Stop / denies mic                   | tracks closed, no leaked stream                               |
| TC-12 | 08:00 +07 Cron; second run/retry              | one intended daily digest                                     |
| TC-13 | 2026-10-12 23:55+07 review due after midnight | correct UTC/day boundary                                      |
| TC-14 | Apps Script timeout                           | pending/error UI, never fake `saved`                          |
| TC-15 | free-tier 429 / quota exhausted               | user-facing graceful fallback                                 |
| TC-16 | FSRS Card creation on word save               | initial card in Cards tab (New, S=0, D=0, reps=0)             |
| TC-17 | FSRS Preview for 4 ratings                    | accurate interval/due calculation without mutating card       |
| TC-18 | FSRS Hard rating semantic                     | lapses preserved (0), stability > 0, recall not failed        |
| TC-19 | FSRS idempotent review replay                 | duplicate_event=true, snapshot preserved, version not changed |
| TC-20 | FSRS Schema v3 migration                      | Cards tab created, existing Words migrated idempotently       |

## Commands once monorepo bootstrapped

```powershell
# exact package scripts need to be created as part of M1/M2
npm ci
npm run typecheck
npm run lint
npm test
npm run build
```

Không báo 'test passed' nếu scripts chưa tồn tại/không được chạy. Save output summary/commit ID vào PROGRESS.

## Manual device matrix

- Chrome/Edge Windows: audio stream, mic/permission, background tab, reconnect.
- Android Chrome + Telegram Mini App: mic permission, audio focus, speaker/Bluetooth headset, screen lock.
- iOS Safari + Telegram: secure context, mic prompt, user-gesture audio play, keyboard/safe area, app switch, background session interruption.

## Latency/UX metrics

`connection_setup_ms`, `first_audio_ms`, `tool_call_to_persist_ms`, `review_update_ms`, error rates, quota 429. Đo thiết bị thật; lưu metrics aggregate, không raw audio.

## Quality/Definition of Done

- Lint/typecheck/test/build chạy thật; fixture tests cho contract; threat cases pass; docs cập nhật; manual tested trên môi trường phù hợp; PROGRESS+CHANGELOG commit chung.
