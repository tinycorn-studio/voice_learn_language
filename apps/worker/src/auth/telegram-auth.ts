import { AppError } from '../domain/env.js';

const encoder = new TextEncoder();

export interface VerifiedTelegramUser {
  id: number;
  userId: string;
  firstName?: string | undefined;
  username?: string | undefined;
  authDate: number;
}

export interface SessionClaims {
  sub: string;
  iat: number;
  exp: number;
}

/**
 * Constant-time string comparison to mitigate timing attacks on HMAC digests and secret headers.
 */
export function constantTimeEqual(a: string, b: string): boolean {
  if (a.length !== b.length || a.length === 0) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

function bytesToHex(bytes: Uint8Array): string {
  let out = '';
  for (const b of bytes) {
    out += b.toString(16).padStart(2, '0');
  }
  return out;
}

export function bytesToBase64Url(bytes: Uint8Array): string {
  let binary = '';
  for (const b of bytes) {
    binary += String.fromCharCode(b);
  }
  return btoa(binary).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

export function base64UrlToString(b64url: string): string {
  const padded = b64url.replace(/-/g, '+').replace(/_/g, '/');
  const padLen = (4 - (padded.length % 4)) % 4;
  return atob(padded + '='.repeat(padLen));
}

async function hmacSha256Raw(keyBytes: Uint8Array | string, message: string): Promise<Uint8Array> {
  const rawKey = typeof keyBytes === 'string' ? encoder.encode(keyBytes) : keyBytes;
  const cryptoKey = await crypto.subtle.importKey(
    'raw',
    rawKey as unknown as BufferSource,
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', cryptoKey, encoder.encode(message));
  return new Uint8Array(sig);
}

/**
 * Computes the Telegram WebApp `initData` HMAC-SHA256 hex signature according to official Telegram spec:
 * `secret_key = HMAC_SHA256(key="WebAppData", message=botToken)`
 * `hash = HEX(HMAC_SHA256(key=secret_key, message=dataCheckString))`
 */
export async function computeTelegramInitDataHash(
  dataCheckString: string,
  botToken: string,
): Promise<string> {
  const secretKey = await hmacSha256Raw('WebAppData', botToken);
  const digest = await hmacSha256Raw(secretKey, dataCheckString);
  return bytesToHex(digest);
}

/**
 * Parses the multi-user allowlist (`M9-02`) from `ALLOWED_TELEGRAM_IDS`.
 * Accepts comma/space/semicolon-separated numeric ids; the owner id is always included so a
 * misconfigured list can never lock the operator out. Invalid tokens are ignored.
 */
export function parseAllowedTelegramIds(params: {
  raw: string | undefined;
  ownerTelegramId: string;
}): number[] {
  const ids = new Set<number>();
  const owner = Number(params.ownerTelegramId.trim());
  if (Number.isInteger(owner) && owner > 0) {
    ids.add(owner);
  }
  for (const token of (params.raw ?? '').split(/[\s,;]+/)) {
    const candidate = Number(token.trim());
    if (Number.isInteger(candidate) && candidate > 0) {
      ids.add(candidate);
    }
  }
  return [...ids];
}

/**
 * Verifies raw Telegram Mini App `initData` string (`docs/07_TELEGRAM_SETUP.md`, `M2-02`, TC-08).
 * Enforces:
 * 1. Valid HMAC-SHA256 signature
 * 2. Fresh `auth_date` within `maxAgeSeconds` (default 3600s)
 * 3. `user.id` matches the allowlist (`M9-02`; single-owner list by default)
 */
export async function verifyTelegramInitData(params: {
  initData: string;
  botToken: string;
  allowedTelegramIds: readonly number[];
  nowEpochSeconds?: number;
  maxAgeSeconds?: number;
}): Promise<VerifiedTelegramUser> {
  const maxAge = params.maxAgeSeconds ?? 3600;
  const nowSec = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);

  const searchParams = new URLSearchParams(params.initData);
  const incomingHash = searchParams.get('hash')?.toLowerCase() ?? '';
  if (!/^[0-9a-f]{64}$/.test(incomingHash)) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Missing or malformed Telegram initData hash',
      status: 401,
    });
  }

  const pairs: string[] = [];
  searchParams.forEach((value, key) => {
    if (key !== 'hash') {
      pairs.push(`${key}=${value}`);
    }
  });
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const expectedHash = await computeTelegramInitDataHash(dataCheckString, params.botToken);
  if (!constantTimeEqual(incomingHash, expectedHash)) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Invalid Telegram initData signature',
      status: 401,
    });
  }

  const authDateRaw = Number(searchParams.get('auth_date') ?? '');
  if (
    !Number.isInteger(authDateRaw) ||
    authDateRaw <= 0 ||
    nowSec - authDateRaw > maxAge ||
    authDateRaw - nowSec > 60
  ) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Telegram initData has expired',
      status: 401,
    });
  }

  const userJson = searchParams.get('user');
  if (!userJson) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Telegram initData missing user payload',
      status: 401,
    });
  }

  let parsedUser: { id?: unknown; first_name?: unknown; username?: unknown };
  try {
    parsedUser = JSON.parse(userJson) as { id?: unknown; first_name?: unknown; username?: unknown };
  } catch {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Malformed Telegram user JSON',
      status: 401,
    });
  }

  if (typeof parsedUser.id !== 'number' || !Number.isInteger(parsedUser.id)) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Invalid Telegram user ID',
      status: 401,
    });
  }

  if (!params.allowedTelegramIds.includes(parsedUser.id)) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'User is not in the allowlist',
      status: 403,
    });
  }

  return {
    id: parsedUser.id,
    userId: `telegram:${parsedUser.id}`,
    firstName: typeof parsedUser.first_name === 'string' ? parsedUser.first_name : undefined,
    username: typeof parsedUser.username === 'string' ? parsedUser.username : undefined,
    authDate: authDateRaw,
  };
}

/**
 * Issues a short-lived HMAC-signed Bearer session token for verified Mini App sessions.
 */
export async function issueSessionToken(params: {
  userId: string;
  signingSecret: string;
  nowEpochSeconds?: number;
  ttlSeconds?: number;
}): Promise<{ token: string; expiresAt: string }> {
  const nowSec = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  const ttl = params.ttlSeconds ?? 1800;
  const claims: SessionClaims = {
    sub: params.userId,
    iat: nowSec,
    exp: nowSec + ttl,
  };
  const payloadB64 = bytesToBase64Url(encoder.encode(JSON.stringify(claims)));
  const sigBytes = await hmacSha256Raw(params.signingSecret, payloadB64);
  const sigB64 = bytesToBase64Url(sigBytes);

  return {
    token: `${payloadB64}.${sigB64}`,
    expiresAt: new Date(claims.exp * 1000).toISOString(),
  };
}

/**
 * Verifies a Bearer session token and enforces expiration and allowlist membership (`M9-02`).
 */
export async function verifySessionToken(params: {
  authorizationHeader: string | null;
  signingSecret: string;
  allowedTelegramIds: readonly number[];
  nowEpochSeconds?: number;
}): Promise<{ userId: string }> {
  const header = params.authorizationHeader?.trim() ?? '';
  if (!header.startsWith('Bearer ')) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Missing Bearer session token',
      status: 401,
    });
  }

  const rawToken = header.slice('Bearer '.length).trim();
  const parts = rawToken.split('.');
  if (parts.length !== 2 || !parts[0] || !parts[1]) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Malformed session token',
      status: 401,
    });
  }

  const [payloadB64, incomingSig] = parts;
  const expectedSigBytes = await hmacSha256Raw(params.signingSecret, payloadB64);
  const expectedSig = bytesToBase64Url(expectedSigBytes);

  if (!constantTimeEqual(incomingSig, expectedSig)) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Invalid session token signature',
      status: 401,
    });
  }

  let claims: SessionClaims;
  try {
    claims = JSON.parse(base64UrlToString(payloadB64)) as SessionClaims;
  } catch {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Corrupted session claims',
      status: 401,
    });
  }

  const nowSec = params.nowEpochSeconds ?? Math.floor(Date.now() / 1000);
  if (typeof claims.exp !== 'number' || claims.exp <= nowSec) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Session token expired',
      status: 401,
    });
  }

  const subjectMatchesAllowlist = params.allowedTelegramIds.some(
    (id) => claims.sub === `telegram:${id}`,
  );
  if (!subjectMatchesAllowlist) {
    throw new AppError({
      code: 'FORBIDDEN',
      message: 'Session subject is not in the allowlist',
      status: 403,
    });
  }

  return { userId: claims.sub };
}

/**
 * Verifies the `X-Telegram-Bot-Api-Secret-Token` header on `/telegram/webhook` (`M2-02`, TC-09).
 */
export function verifyTelegramWebhookSecret(
  headerValue: string | null,
  expectedSecret: string,
): void {
  if (!headerValue || !expectedSecret || !constantTimeEqual(headerValue, expectedSecret)) {
    throw new AppError({
      code: 'UNAUTHENTICATED',
      message: 'Invalid Telegram webhook secret token',
      status: 401,
    });
  }
}
