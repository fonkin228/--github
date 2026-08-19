import type { ReactElement } from 'react';
import { THEMES, THEME_LABELS, type Theme } from '../theme';

const ICONS: Record<Theme, ReactElement> = {
  auto: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path d="M8 1.5a6.5 6.5 0 1 0 0 13z" fill="currentColor" />
      <circle cx="8" cy="8" r="6.5" fill="none" stroke="currentColor" strokeWidth="1.4" />
    </svg>
  ),
  light: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <circle cx="8" cy="8" r="3.1" fill="currentColor" />
      <g stroke="currentColor" strokeWidth="1.4" strokeLinecap="round">
        <path d="M8 1v1.8M8 13.2V15M1 8h1.8M13.2 8H15M3.1 3.1l1.3 1.3M11.6 11.6l1.3 1.3M12.9 3.1l-1.3 1.3M4.4 11.6l-1.3 1.3" />
      </g>
    </svg>
  ),
  dark: (
    <svg viewBox="0 0 16 16" aria-hidden="true">
      <path
        d="M13.4 9.6A5.8 5.8 0 0 1 6.4 2.6a5.9 5.9 0 1 0 7 7z"
        fill="currentColor"
      />
    </svg>
  ),
};

/** Компактная капсула с бегунком: авто / светлая / тёмная. */
export function ThemeSwitch({ value, onChange }: { value: Theme; onChange(theme: Theme): void }) {
  const index = THEMES.indexOf(value);
  return (
    <div className="theme" role="group" aria-label="Тема оформления">
      <span className="theme__thumb" style={{ transform: `translateX(${index * 100}%)` }} />
      {THEMES.map((theme) => (
        <button
          key={theme}
          type="button"
          className={`theme__btn ${value === theme ? 'is-active' : ''}`}
          onClick={() => onChange(theme)}
          title={THEME_LABELS[theme]}
          aria-label={THEME_LABELS[theme]}
          aria-pressed={value === theme}
        >
          {ICONS[theme]}
        </button>
      ))}
    </div>
  );
}
