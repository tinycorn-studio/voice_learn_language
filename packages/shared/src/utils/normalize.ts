/**
 * Pure normalization, spreadsheet formula-injection guard, and timezone utilities.
 * No Node or Cloudflare runtime imports are permitted in @voice-chat/shared.
 */

/**
 * Normalizes text for deterministic key comparison (NFKC, trim, collapse whitespace, lowercase).
 * Why: Prevents duplicate vocabulary rows caused by casing, full-width characters, or extra spaces.
 */
export function normalizeText(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/g, ' ').toLowerCase();
}

/**
 * Builds the deterministic identity key `user_id|normalized_lemma|pos|normalized_sense_key`
 * matching `apps-script/Code.gs` and `docs/09_DATA_SCHEMA.md`.
 */
export function makeWordKey(params: {
  userId: string;
  lemma: string;
  partOfSpeech: string;
  senseKey: string;
}): string {
  return [
    params.userId.trim(),
    normalizeText(params.lemma),
    normalizeText(params.partOfSpeech || 'unknown'),
    normalizeText(params.senseKey || 'default'),
  ].join('|');
}

/**
 * Prefixes a single quote if a string starts with `=`, `+`, `-`, or `@` (or leading tab/CR before them)
 * to prevent spreadsheet formula injection in Google Sheets (`docs/10_SECURITY.md`, TC-10).
 */
export function escapeSpreadsheetFormula(value: string): string {
  if (/^[\s]*[=+\-@]/.test(value)) {
    return `'${value}`;
  }
  return value;
}

/**
 * Converts a UTC Date or ISO-8601 string into `YYYY-MM-DD` in `Asia/Ho_Chi_Minh` (+07:00).
 * Why: Daily digest reminders and user streaks operate on Vietnam local day boundaries while
 * persisted timestamps remain strictly UTC ISO-8601 (`AGENTS.md` Section 2).
 */
export function formatLocalDateAsiaHoChiMinh(utcDateOrIso: Date | string): string {
  const date = typeof utcDateOrIso === 'string' ? new Date(utcDateOrIso) : utcDateOrIso;
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid UTC date input');
  }
  const formatter = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'Asia/Ho_Chi_Minh',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  });
  return formatter.format(date);
}

/**
 * Returns the hour (0-23) in `Asia/Ho_Chi_Minh` for a given UTC Date or ISO-8601 string.
 */
export function getLocalHourAsiaHoChiMinh(utcDateOrIso: Date | string): number {
  const date = typeof utcDateOrIso === 'string' ? new Date(utcDateOrIso) : utcDateOrIso;
  if (Number.isNaN(date.getTime())) {
    throw new Error('Invalid UTC date input');
  }
  const parts = new Intl.DateTimeFormat('en-US', {
    timeZone: 'Asia/Ho_Chi_Minh',
    hour: '2-digit',
    hour12: false,
  }).formatToParts(date);
  const hourPart = parts.find((p) => p.type === 'hour')?.value ?? '0';
  const parsed = Number.parseInt(hourPart, 10);
  return parsed === 24 ? 0 : parsed;
}
