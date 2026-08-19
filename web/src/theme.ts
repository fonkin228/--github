/** Тема оформления: следовать окружению или зафиксировать светлую/тёмную. */
export type Theme = 'auto' | 'light' | 'dark';

const KEY = 'raspred:theme';

export const THEMES: Theme[] = ['auto', 'light', 'dark'];

export const THEME_LABELS: Record<Theme, string> = {
  auto: 'Как в системе',
  light: 'Светлая',
  dark: 'Тёмная',
};

export function readTheme(): Theme {
  try {
    const saved = window.localStorage.getItem(KEY);
    return THEMES.includes(saved as Theme) ? (saved as Theme) : 'auto';
  } catch {
    return 'auto';
  }
}

export function applyTheme(theme: Theme): void {
  const root = document.documentElement;
  if (theme === 'auto') delete root.dataset.theme;
  else root.dataset.theme = theme;
  try {
    window.localStorage.setItem(KEY, theme);
  } catch {
    /* приватный режим — просто не запоминаем */
  }
}
