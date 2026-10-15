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
      colorScheme?: string;
      onEvent?: (eventType: 'themeChanged', eventHandler: () => void) => void;
      offEvent?: (eventType: 'themeChanged', eventHandler: () => void) => void;
    };
  };
  matchMedia?: (query: string) => MediaQueryList;
}

export type ColorScheme = 'light' | 'dark';
export type ThemePreference = 'auto' | ColorScheme;

const THEME_PREFERENCE_STORAGE_KEY = 'voice-chat.theme-preference';

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

/**
 * Follows Telegram's live theme when available and falls back to the browser's color preference.
 */
export function subscribeColorScheme(
  onChange: (scheme: ColorScheme) => void,
  win: TelegramWebAppWindow = globalThis as unknown as TelegramWebAppWindow,
): () => void {
  const webApp = win.Telegram?.WebApp;
  const mediaQuery = win.matchMedia?.('(prefers-color-scheme: dark)');
  const applyTheme = () => {
    const telegramScheme = webApp?.colorScheme;
    onChange(
      telegramScheme === 'light' || telegramScheme === 'dark'
        ? telegramScheme
        : mediaQuery?.matches
          ? 'dark'
          : 'light',
    );
  };

  applyTheme();
  webApp?.onEvent?.('themeChanged', applyTheme);
  mediaQuery?.addEventListener('change', applyTheme);

  return () => {
    webApp?.offEvent?.('themeChanged', applyTheme);
    mediaQuery?.removeEventListener('change', applyTheme);
  };
}

/** Reads an optional local theme override; automatic Telegram/OS selection is the safe default. */
export function readThemePreference(storage?: Pick<Storage, 'getItem'>): ThemePreference {
  try {
    const target = storage ?? globalThis.localStorage;
    const value = target.getItem(THEME_PREFERENCE_STORAGE_KEY);
    return value === 'light' || value === 'dark' ? value : 'auto';
  } catch {
    // Theme persistence is optional and must not prevent the learning interface from opening.
    return 'auto';
  }
}

/** Persists a manual choice or the automatic-mode reset, when browser storage is available. */
export function writeThemePreference(
  preference: ThemePreference,
  storage?: Pick<Storage, 'setItem'>,
): boolean {
  try {
    const target = storage ?? globalThis.localStorage;
    target.setItem(THEME_PREFERENCE_STORAGE_KEY, preference);
    return true;
  } catch {
    // The theme still changes for this session even when a WebView blocks local storage.
    return false;
  }
}
