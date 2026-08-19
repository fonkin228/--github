/** Тонкая типизированная обёртка над window.Telegram.WebApp. */

export interface TgWebApp {
  initData: string;
  initDataUnsafe: { user?: { id: number; first_name?: string; username?: string } };
  colorScheme: 'light' | 'dark';
  themeParams: Record<string, string>;
  version: string;
  platform: string;
  isExpanded: boolean;
  viewportStableHeight: number;
  ready(): void;
  expand(): void;
  close(): void;
  disableVerticalSwipes?(): void;
  setHeaderColor?(color: string): void;
  onEvent(event: string, cb: () => void): void;
  offEvent(event: string, cb: () => void): void;
  showAlert(message: string, cb?: () => void): void;
  showConfirm(message: string, cb: (ok: boolean) => void): void;
  HapticFeedback?: {
    impactOccurred(style: 'light' | 'medium' | 'heavy'): void;
    notificationOccurred(type: 'error' | 'success' | 'warning'): void;
  };
  MainButton: {
    text: string;
    isVisible: boolean;
    show(): void;
    hide(): void;
    setText(text: string): void;
    onClick(cb: () => void): void;
    offClick(cb: () => void): void;
    showProgress(leaveActive?: boolean): void;
    hideProgress(): void;
    enable(): void;
    disable(): void;
  };
}

declare global {
  interface Window {
    Telegram?: { WebApp?: TgWebApp };
  }
}

export const tg: TgWebApp | null = window.Telegram?.WebApp ?? null;

/** true, когда приложение реально открыто из Telegram (а не просто в браузере). */
export const isInsideTelegram = Boolean(tg?.initData);

export function initTelegram(): void {
  if (!tg) return;
  tg.ready();
  tg.expand();
  tg.disableVerticalSwipes?.();
  applyTheme();
  tg.onEvent('themeChanged', applyTheme);
}

function applyTheme(): void {
  if (!tg) return;
  const root = document.documentElement;
  root.dataset.scheme = tg.colorScheme;
  for (const [key, value] of Object.entries(tg.themeParams ?? {})) {
    root.style.setProperty(`--tg-theme-${key.replace(/_/g, '-')}`, value);
  }
}

export function haptic(type: 'success' | 'error' | 'warning' = 'success'): void {
  tg?.HapticFeedback?.notificationOccurred(type);
}

export function alertUser(message: string): void {
  if (tg?.showAlert) tg.showAlert(message);
  else window.alert(message);
}

export function confirmUser(message: string): Promise<boolean> {
  return new Promise((resolve) => {
    if (tg?.showConfirm) tg.showConfirm(message, resolve);
    else resolve(window.confirm(message));
  });
}
