import { describe, expect, it } from 'vitest';
import {
  computeTelegramInitDataHash,
  issueSessionToken,
  parseAllowedTelegramIds,
  verifySessionToken,
  verifyTelegramInitData,
} from './telegram-auth.js';

const BOT_TOKEN = 'test_only_telegram_bot_token_for_unit_tests';
const SIGNING_SECRET = 'session_signing_secret_32_bytes_test_key_001';

async function buildSignedInitData(userId: number, authDate: number): Promise<string> {
  const userJson = JSON.stringify({ id: userId, first_name: 'Learner', username: 'learner_vn' });
  const entries: Array<[string, string]> = [
    ['auth_date', String(authDate)],
    ['query_id', 'AAHdF6IQAAAAAN0XohDhrOrc'],
    ['user', userJson],
  ];
  entries.sort(([a], [b]) => a.localeCompare(b));
  const hash = await computeTelegramInitDataHash(
    entries.map(([k, v]) => `${k}=${v}`).join('\n'),
    BOT_TOKEN,
  );
  const sp = new URLSearchParams();
  for (const [k, v] of entries) {
    sp.set(k, v);
  }
  sp.set('hash', hash);
  return sp.toString();
}

describe('M9-02 multi-user allowlist parsing', () => {
  it('parses comma/space/semicolon-separated ids, dedupes, and always includes the owner', () => {
    expect(
      parseAllowedTelegramIds({
        raw: '111, 222;333 111,not-a-number,-5,0',
        ownerTelegramId: '777888999',
      }),
    ).toEqual([777888999, 111, 222, 333]);
  });

  it('falls back to the owner-only list when the env list is missing or useless', () => {
    expect(parseAllowedTelegramIds({ raw: undefined, ownerTelegramId: '777888999' })).toEqual([
      777888999,
    ]);
    expect(parseAllowedTelegramIds({ raw: ' , ', ownerTelegramId: '777888999' })).toEqual([
      777888999,
    ]);
  });
});

describe('M9-02 allowlist enforcement in Telegram verification', () => {
  const nowSec = Math.floor(Date.parse('2026-10-19T02:00:00.000Z') / 1000);
  const allowed = [777888999, 111222333];

  it('verifies initData for every allowlisted user and rejects outsiders', async () => {
    const member = await verifyTelegramInitData({
      initData: await buildSignedInitData(111222333, nowSec - 10),
      botToken: BOT_TOKEN,
      allowedTelegramIds: allowed,
      nowEpochSeconds: nowSec,
    });
    expect(member.userId).toBe('telegram:111222333');

    await expect(
      verifyTelegramInitData({
        initData: await buildSignedInitData(555000111, nowSec - 10),
        botToken: BOT_TOKEN,
        allowedTelegramIds: allowed,
        nowEpochSeconds: nowSec,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });

  it('accepts session tokens only for allowlisted subjects', async () => {
    const memberSession = await issueSessionToken({
      userId: 'telegram:111222333',
      signingSecret: SIGNING_SECRET,
      nowEpochSeconds: nowSec,
    });
    await expect(
      verifySessionToken({
        authorizationHeader: `Bearer ${memberSession.token}`,
        signingSecret: SIGNING_SECRET,
        allowedTelegramIds: allowed,
        nowEpochSeconds: nowSec,
      }),
    ).resolves.toEqual({ userId: 'telegram:111222333' });

    const outsiderSession = await issueSessionToken({
      userId: 'telegram:555000111',
      signingSecret: SIGNING_SECRET,
      nowEpochSeconds: nowSec,
    });
    await expect(
      verifySessionToken({
        authorizationHeader: `Bearer ${outsiderSession.token}`,
        signingSecret: SIGNING_SECRET,
        allowedTelegramIds: allowed,
        nowEpochSeconds: nowSec,
      }),
    ).rejects.toMatchObject({ status: 403 });
  });
});
