import type { DueReviewCard } from '@voice-chat/shared';

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
  }): Promise<{ ok: boolean; messageId?: number }> {
    const res = await this.fetchFn(this.endpoint('sendMessage'), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        chat_id: params.chatId,
        text: params.text,
        ...(params.inlineKeyboard
          ? { reply_markup: { inline_keyboard: params.inlineKeyboard } }
          : {}),
      }),
    });
    if (!res.ok) {
      return { ok: false };
    }
    const json = (await res.json()) as { ok?: boolean; result?: { message_id?: number } };
    return {
      ok: Boolean(json.ok),
      ...(json.result?.message_id !== undefined ? { messageId: json.result.message_id } : {}),
    };
  }

  public async answerCallbackQuery(params: {
    callbackQueryId: string;
    text: string;
  }): Promise<boolean> {
    const res = await this.fetchFn(this.endpoint('answerCallbackQuery'), {
      method: 'POST',
      headers: { 'content-type': 'application/json; charset=utf-8' },
      body: JSON.stringify({
        callback_query_id: params.callbackQueryId,
        text: params.text,
        show_alert: false,
      }),
    });
    return res.ok;
  }

  /**
   * Formats a compact inline-keyboard review card for Telegram (`docs/07_TELEGRAM_SETUP.md` Section 4).
   * Callback data strictly fits Telegram's 64-byte limit: `r:<word_id>:<rating>`.
   */
  public static buildQuizKeyboard(wordId: string): TelegramInlineButton[][] {
    const shortId = wordId.slice(0, 40);
    return [
      [
        { text: 'Again (10m)', callback_data: `r:${shortId}:again` },
        { text: 'Hard', callback_data: `r:${shortId}:hard` },
        { text: 'Good', callback_data: `r:${shortId}:good` },
        { text: 'Easy', callback_data: `r:${shortId}:easy` },
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
