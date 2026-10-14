// Theme handling: user preference (auto / light / dark) + system detection.

export type ThemePref = 'auto' | 'light' | 'dark';
export type Theme = 'light' | 'dark';

export const THEME_LABEL: Record<ThemePref, string> = { auto: '自動', light: 'ライト', dark: 'ダーク' };
export const THEME_ICON: Record<ThemePref, string> = { auto: '◐', light: '☀', dark: '☾' };

export function resolveTheme(pref: ThemePref, systemDark: boolean): Theme {
  if (pref === 'auto') return systemDark ? 'dark' : 'light';
  return pref;
}

export function nextThemePref(p: ThemePref): ThemePref {
  return p === 'auto' ? 'light' : p === 'light' ? 'dark' : 'auto';
}

const META_COLOR: Record<Theme, string> = { light: '#f5f2ec', dark: '#14151a' };

/** Apply to <html data-theme> and the browser chrome color. Returns the resolved theme. */
export function applyTheme(pref: ThemePref): Theme {
  const systemDark = typeof matchMedia !== 'undefined' && matchMedia('(prefers-color-scheme: dark)').matches;
  const theme = resolveTheme(pref, systemDark);
  const root = document.documentElement;
  root.dataset.theme = theme;
  root.style.colorScheme = theme;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', META_COLOR[theme]);
  return theme;
}
