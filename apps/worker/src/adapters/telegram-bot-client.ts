import { z } from 'zod';
import type { DueReviewCard } from '@voice-chat/shared';

const sendResultSchema = z.discriminatedUnion('ok', [
  z.object({ ok: z.literal(true), result: z.object({ message_id: z.number().int().positive() }) }),
  z.object({ ok: z.literal(false) }),
]);

export interface TelegramInlineButton {
  text: string;
  callback_data?: string;
  web_app?: { url: string };
}

export class TelegramBotClient {
  public constructor(
    private readonly botToken: string,
    private readonly fetchFn: typeof fetch = fetch,
  ) {}

  private endpoint(method: string): string {
    return `https://api.telegram.org/bot${this.botToken}/${method}`;
  }

  public async sendMessage(params: {
    chatId: string | number;
    text: string;
    inlineKeyboard?: TelegramInlineButton[][];
  }): Promise<{ ok: boolean; messageId?: number; outcome?: 'failed' | 'unknown' }> {
    let res: Response;
    try {
      // Native Workers fetch must keep the global receiver rather than this client instance.
      res = await this.fetchFn.call(globalThis, this.endpoint('sendMessage'), {
        method: 'POST',
        headers: { 'content-type': 'application/json; charset=utf-8' },
        body: JSON.stringify({
          chat_id: params.chatId,
          text: params.text,
          ...(params.inlineKeyboard
            ? { reply_markup: { inline_keyboard: params.inlineKeyboard } }
            : {}),
        }),
        signal: AbortSignal.timeout(10000),
      });
    } catch {
      return { ok: false, outcome: 'unknown' };
    }
    // A proxy error or malformed acknowledgement cannot prove whether Telegram sent it.
    const raw: unknown = await res.json().catch(() => null);
    const parsed = sendResultSchema.safeParse(raw);
    if (!parsed.success) return { ok: false, outcome: 'unknown' };
    if (!parsed.data.ok) return { ok: false, outcome: 'failed' };
    return { ok: true, messageId: parsed.data.result.message_id };
  }

  public async answerCallbackQuery(params: {
    callbackQueryId: string;
    text: string;
    timeoutMs?: number;
  }): Promise<boolean> {
    const res = await this.fetchFn.call(globalThis, this.endpoint('answerCallbackQuery'), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        callback_query_id: params.callbackQueryId,
        text: params.text,
        show_alert: false,
      }),
      signal: AbortSignal.timeout(params.timeoutMs ?? 10000),
    });
    const parsed = z.object({ ok: z.boolean() }).safeParse(await res.json().catch(() => null));
    return res.ok && parsed.success && parsed.data.ok;
  }

  /** Editing a known message is retryable without sending a second result message. */
  public async editReviewResult(chatId: number, messageId: number, text: string): Promise<boolean> {
    const res = await this.fetchFn.call(globalThis, this.endpoint('editMessageText'), {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        chat_id: chatId,
        message_id: messageId,
        text,
        reply_markup: { inline_keyboard: [] },
      }),
      signal: AbortSignal.timeout(2000),
    });
    const result = z
      .object({ ok: z.boolean(), description: z.string().optional() })
      .safeParse(await res.json().catch(() => null));
    return (
      result.success &&
      ((res.ok && result.data.ok) ||
        (res.status === 400 &&
          result.data.description?.includes('message is not modified') === true))
    );
  }

  /**
   * Formats a compact inline-keyboard review card for Telegram (`docs/07_TELEGRAM_SETUP.md` Section 4).
   * Includes the card version so pressing an old keyboard cannot score a newer card.
   */
  public static buildQuizKeyboard(wordId: string, version: number): TelegramInlineButton[][] {
    if (
      !/^[a-zA-Z0-9_-]+$/.test(wordId) ||
      !Number.isSafeInteger(version) ||
      version < 1 ||
      `r:${wordId}:again:${version}`.length > 64
    ) {
      throw new Error('Review callback exceeds Telegram constraints');
    }
    return [
      [
        { text: 'Again (quên)', callback_data: `r:${wordId}:again:${version}` },
        { text: 'Hard', callback_data: `r:${wordId}:hard:${version}` },
        { text: 'Good', callback_data: `r:${wordId}:good:${version}` },
        { text: 'Easy', callback_data: `r:${wordId}:easy:${version}` },
      ],
    ];
  }

  public static formatDigestMessage(localDate: string, dueCards: readonly DueReviewCard[]): string {
    const first = dueCards[0];
    if (!first) {
      return `🎉 Hôm nay (${localDate}) bạn không có từ vựng nào đến hạn ôn tập!`;
    }
    return [
      `📚 Nhắc ôn từ vựng ngày ${localDate} (${dueCards.length} từ đến hạn)`,
      '',
      `Từ đầu tiên: "${first.word}" (${first.part_of_speech})`,
      `Ngữ cảnh: ${first.source_excerpt || first.example || '—'}`,
      `Nghĩa gợi nhớ: ${first.meaning_vi}`,
      '',
      'Hãy tự đánh giá mức độ nhớ của bạn bên dưới:',
    ].join('\n');
  }
}
