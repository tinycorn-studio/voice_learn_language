/**
 * Adapter for Telegram Mini App WebApp environment (`docs/07_TELEGRAM_SETUP.md`).
 * Never trusts `initDataUnsafe` for authentication; only returns raw signed `initData`
 * to be verified by the Cloudflare Worker via HMAC-SHA256.
 */

export interface TelegramWebAppWindow {
  Telegram?: {
    WebApp?: {
      initData?: string;
      initDataUnsafe?: {
        user?: {
          id?: number;
          first_name?: string;
          username?: string;
        };
      };
      ready?: () => void;
      expand?: () => void;
      platform?: string;
    };
  };
}

export interface TelegramEnvironmentInfo {
  isTelegramMiniApp: boolean;
  rawInitData: string;
  displayFirstName: string | null;
  platform: string;
}

/**
 * Initializes the Telegram WebApp SDK if present (`ready()` and `expand()`)
 * and extracts the raw `initData` string for backend verification.
 */
export function initTelegramEnvironment(
  win: TelegramWebAppWindow = globalThis as unknown as TelegramWebAppWindow,
): TelegramEnvironmentInfo {
  const webApp = win.Telegram?.WebApp;
  const rawInitData = typeof webApp?.initData === 'string' ? webApp.initData.trim() : '';

  if (webApp && rawInitData.length > 0) {
    webApp.ready?.();
    webApp.expand?.();
  }

  // initDataUnsafe is used strictly for cosmetic greeting in UI, NEVER for authorization (`AGENTS.md` Section 4).
  const displayFirstName = webApp?.initDataUnsafe?.user?.first_name ?? null;
  const platform = webApp?.platform ?? 'browser';

  return {
    isTelegramMiniApp: rawInitData.length > 0,
    rawInitData,
    displayFirstName,
    platform,
  };
}
