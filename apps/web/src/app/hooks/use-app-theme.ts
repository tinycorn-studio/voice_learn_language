import { useCallback, useLayoutEffect, useState } from 'react';
import {
  readThemePreference,
  subscribeColorScheme,
  writeThemePreference,
  type ColorScheme,
  type ThemePreference,
} from '../../integrations/telegram/telegram-adapter.js';

export function useAppTheme() {
  const [environmentColorScheme, setEnvironmentColorScheme] = useState<ColorScheme>('light');
  const [themePreference, setThemePreferenceState] = useState<ThemePreference>(readThemePreference);

  useLayoutEffect(() => subscribeColorScheme(setEnvironmentColorScheme), []);

  const colorScheme = themePreference === 'auto' ? environmentColorScheme : themePreference;
  const changeThemePreference = useCallback((preference: ThemePreference) => {
    setThemePreferenceState(preference);
    writeThemePreference(preference);
  }, []);

  useLayoutEffect(() => {
    document.documentElement.dataset.theme = colorScheme;
    document
      .querySelector<HTMLMetaElement>('meta[name="theme-color"]')
      ?.setAttribute('content', colorScheme === 'dark' ? '#0d1523' : '#f4f7fc');
  }, [colorScheme]);

  return { colorScheme, themePreference, changeThemePreference } as const;
}
