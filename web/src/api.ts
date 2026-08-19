import { localApi } from './apiLocal';
import { tg } from './telegram';
import type { CalcMode, CalcResult, HistoryEntry, IncomeItem, Params } from '@shared/types';

const BASE = import.meta.env.VITE_API_BASE ?? '';

/** Автономная сборка: всё считается и хранится в браузере, сервер не нужен. */
export const IS_STANDALONE = import.meta.env.VITE_STANDALONE === '1';

async function request<T>(path: string, init: RequestInit = {}): Promise<T> {
  const response = await fetch(`${BASE}${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      // Сервер проверяет подпись этой строки — без неё в проде будет 401.
      'X-Telegram-Init-Data': tg?.initData ?? '',
      ...(init.headers ?? {}),
    },
  });

  if (!response.ok) {
    let message = `Ошибка ${response.status}`;
    try {
      const body = (await response.json()) as { error?: string };
      if (body?.error) message = body.error;
    } catch {
      /* тело не JSON — оставляем код */
    }
    const error = new Error(message) as Error & { status?: number };
    error.status = response.status;
    throw error;
  }
  return (await response.json()) as T;
}

export interface CalcOptions {
  save?: boolean;
  title?: string;
  mode?: CalcMode;
  income?: IncomeItem[];
  expenses?: IncomeItem[];
}

export interface MeResponse {
  user: { id: number; first_name?: string; username?: string };
  devAuth: boolean;
  params: Params;
  botConfigured: boolean;
}

const serverApi = {
  me: () => request<MeResponse>('/api/me'),

  calc: (inputs: string[], params: Params, opts?: CalcOptions) =>
    request<CalcResult & { historyId: number | null }>('/api/calc', {
      method: 'POST',
      body: JSON.stringify({
        inputs,
        params,
        save: opts?.save ?? true,
        title: opts?.title,
        mode: opts?.mode,
        income: opts?.income,
        expenses: opts?.expenses,
      }),
    }),

  saveParams: (params: Params) =>
    request<{ params: Params }>('/api/settings', { method: 'PUT', body: JSON.stringify({ params }) }),

  history: () => request<{ items: HistoryEntry[] }>('/api/history'),

  historyItem: (id: number) => request<{ entry: HistoryEntry; result: CalcResult }>(`/api/history/${id}`),

  deleteHistoryItem: (id: number) => request<{ ok: true }>(`/api/history/${id}`, { method: 'DELETE' }),

  clearHistory: () => request<{ deleted: number }>('/api/history', { method: 'DELETE' }),

  sendDatabaseToChat: () => request<{ ok: true; count: number }>('/api/database/send', { method: 'POST' }),

  replaceHistory: (entries: HistoryEntry[]) =>
    request<{ saved: number }>('/api/history', { method: 'PUT', body: JSON.stringify({ entries }) }),

  /** Просит бота прислать файл в чат — надёжный путь доставки внутри Telegram. */
  exportToChat: (inputs: string[], params: Params, income?: IncomeItem[], expenses?: IncomeItem[]) =>
    request<{ ok: true }>('/api/export/telegram', {
      method: 'POST',
      body: JSON.stringify({ inputs, params, income, expenses }),
    }),

  /** Прямое скачивание. Работает в обычном браузере; внутри Telegram WebView — не всегда. */
  async download(inputs: string[], params: Params, income?: IncomeItem[], expenses?: IncomeItem[]): Promise<void> {
    const response = await fetch(`${BASE}/api/export`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-Telegram-Init-Data': tg?.initData ?? '' },
      body: JSON.stringify({ inputs, params, income, expenses }),
    });
    if (!response.ok) throw new Error(`Не удалось собрать файл (${response.status})`);

    const disposition = response.headers.get('Content-Disposition') ?? '';
    const match = /filename="([^"]+)"/.exec(disposition);
    const blob = await response.blob();
    const url = URL.createObjectURL(blob);
    const link = document.createElement('a');
    link.href = url;
    link.download = match?.[1] ?? 'raspredelenie.xlsx';
    document.body.appendChild(link);
    link.click();
    link.remove();
    setTimeout(() => URL.revokeObjectURL(url), 5000);
  },
};

export const api = IS_STANDALONE ? localApi : serverApi;
