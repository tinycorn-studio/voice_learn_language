import type { WorkerEnv } from './env.js';
import type { DailyUsageKind } from './repositories.js';

export interface DailyCaps {
  chat_turn: number;
  translation: number;
  live_session: number;
}

/**
 * Single source of truth for per-user daily free-tier caps (`M9-03`, `AGENTS.md` Section 2).
 * Defaults fit one person's realistic daily use; operators can raise or lower them via env vars.
 * A cap of `0` disables that feature for everyone for the current local day.
 */
const DEFAULT_DAILY_CAPS: DailyCaps = {
  chat_turn: 30,
  translation: 30,
  live_session: 5,
};

function parseCap(raw: string | undefined, fallback: number): number {
  if (raw === undefined || raw.trim() === '') return fallback;
  const parsed = Number(raw.trim());
  if (!Number.isInteger(parsed) || parsed < 0) return fallback;
  return parsed;
}

export function resolveDailyCaps(env: WorkerEnv): DailyCaps {
  return {
    chat_turn: parseCap(env.DAILY_CHAT_TURNS_CAP, DEFAULT_DAILY_CAPS.chat_turn),
    translation: parseCap(env.DAILY_TRANSLATIONS_CAP, DEFAULT_DAILY_CAPS.translation),
    live_session: parseCap(env.DAILY_LIVE_SESSIONS_CAP, DEFAULT_DAILY_CAPS.live_session),
  };
}

/** Learner-facing Vietnamese message for exhausted caps; caps reset at local midnight. */
export function dailyCapMessage(kind: DailyUsageKind, cap: number): string {
  const label =
    kind === 'chat_turn'
      ? 'lượt trò chuyện chế độ nhẹ'
      : kind === 'translation'
        ? 'lượt dịch câu'
        : 'phiên luyện nói';
  return `Bạn đã dùng hết ${cap} ${label} hôm nay. Giới hạn sẽ đặt lại vào 0:00 (giờ Việt Nam).`;
}
