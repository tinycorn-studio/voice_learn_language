import { describe, expect, it } from 'vitest';
import { readThemePreference, writeThemePreference } from './telegram-adapter.js';

describe('theme preference persistence', () => {
  it('defaults to automatic mode and stores a manual choice', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    expect(readThemePreference(storage)).toBe('auto');
    expect(writeThemePreference('dark', storage)).toBe(true);
    expect(readThemePreference(storage)).toBe('dark');
  });

  it('can restore automatic mode and ignores invalid stored values', () => {
    const values = new Map<string, string>();
    const storage = {
      getItem: (key: string) => values.get(key) ?? null,
      setItem: (key: string, value: string) => values.set(key, value),
    };

    writeThemePreference('light', storage);
    writeThemePreference('auto', storage);
    expect(readThemePreference(storage)).toBe('auto');
    values.set('voice-chat.theme-preference', 'sepia');
    expect(readThemePreference(storage)).toBe('auto');
  });

  it('falls back to automatic mode when browser storage is unavailable', () => {
    const storage = {
      getItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
      setItem: () => {
        throw new DOMException('blocked', 'SecurityError');
      },
    };

    expect(readThemePreference(storage)).toBe('auto');
    expect(writeThemePreference('dark', storage)).toBe(false);
  });
});
