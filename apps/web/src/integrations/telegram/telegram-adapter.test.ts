import { describe, expect, it, vi } from 'vitest';
import { subscribeColorScheme, type TelegramWebAppWindow } from './telegram-adapter.js';

describe('subscribeColorScheme', () => {
  it('uses Telegram theme and responds to themeChanged', () => {
    let themeListener: (() => void) | undefined;
    const offEvent = vi.fn();
    const webApp = {
      colorScheme: 'light',
      onEvent: (_eventType: 'themeChanged', listener: () => void) => {
        themeListener = listener;
      },
      offEvent,
    };
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const win = {
      Telegram: { WebApp: webApp },
      matchMedia: vi.fn(() => mediaQuery),
    } as unknown as TelegramWebAppWindow;
    const onChange = vi.fn();

    const unsubscribe = subscribeColorScheme(onChange, win);
    expect(onChange).toHaveBeenNthCalledWith(1, 'light');
    expect(win.matchMedia).toHaveBeenCalledWith('(prefers-color-scheme: dark)');

    webApp.colorScheme = 'dark';
    themeListener?.();
    expect(onChange).toHaveBeenLastCalledWith('dark');

    unsubscribe();
    expect(offEvent).toHaveBeenCalledWith('themeChanged', themeListener);
  });

  it('falls back to the operating-system color scheme outside Telegram', () => {
    const mediaQuery = {
      matches: true,
      addEventListener: vi.fn(),
      removeEventListener: vi.fn(),
    } as unknown as MediaQueryList;
    const win = { matchMedia: () => mediaQuery } as unknown as TelegramWebAppWindow;
    const onChange = vi.fn();

    subscribeColorScheme(onChange, win);

    expect(onChange).toHaveBeenCalledWith('dark');
  });
});
