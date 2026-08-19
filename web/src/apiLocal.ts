/**
 * Автономный режим: ни сервера, ни сети.
 * Расчёт, хранение параметров, история и сборка xlsx — всё в браузере.
 */
import { calcAll, calcStages, normalizeParams } from '@shared/calc';
import { buildFileName, buildStagesWorkbook, buildWorkbook } from '@shared/xlsx';
import { DEFAULT_PARAMS, type CalcResult, type HistoryEntry, type IncomeItem, type Params } from '@shared/types';
import { SUMS, withPlural } from '@shared/plural';
import type { CalcOptions, MeResponse } from './api';

const KEY_PARAMS = 'raspred:params';
const KEY_HISTORY = 'raspred:history';
const HISTORY_LIMIT = 100;

/** localStorage может быть недоступен (file:// в Chrome, приватный режим) — тогда живём в памяти. */
const memory = new Map<string, string>();

const store = {
  get(key: string): string | null {
    try {
      return window.localStorage.getItem(key);
    } catch {
      return memory.get(key) ?? null;
    }
  },
  set(key: string, value: string): void {
    try {
      window.localStorage.setItem(key, value);
    } catch {
      memory.set(key, value);
    }
  },
};

function readParams(): Params {
  const raw = store.get(KEY_PARAMS);
  if (!raw) return DEFAULT_PARAMS;
  try {
    return normalizeParams(JSON.parse(raw) as Partial<Params>);
  } catch {
    return DEFAULT_PARAMS;
  }
}

function readHistory(): HistoryEntry[] {
  const raw = store.get(KEY_HISTORY);
  if (!raw) return [];
  try {
    const items = JSON.parse(raw) as HistoryEntry[];
    return Array.isArray(items) ? items : [];
  } catch {
    return [];
  }
}

const writeHistory = (items: HistoryEntry[]): void =>
  store.set(KEY_HISTORY, JSON.stringify(items.slice(0, HISTORY_LIMIT)));

let nextId = Math.max(0, ...readHistory().map((h) => h.id)) + 1;

function saveToHistory(inputs: string[], params: Params, result: CalcResult, opts?: CalcOptions): number {
  const income = opts?.income?.length ? opts.income : undefined;
  const expenses = opts?.expenses?.length ? opts.expenses : undefined;
  const entry: HistoryEntry = {
    id: nextId++,
    createdAt: new Date().toISOString(),
    title:
      opts?.title?.trim() ||
      (income ? `Заработок ${inputs[0]}` : inputs.length === 1 ? inputs[0] : withPlural(inputs.length, SUMS)),
    params,
    mode: income ? 'stages' : 'batch',
    inputs,
    income,
    expenses,
    totals: result.totals,
  };
  writeHistory([entry, ...readHistory()]);
  return entry.id;
}

async function saveBlob(
  inputs: string[],
  params: Params,
  income?: IncomeItem[],
  expenses?: IncomeItem[],
): Promise<void> {
  let buffer: ArrayBuffer;
  if (income?.length) {
    buffer = await buildStagesWorkbook(calcStages(income, expenses ?? [], params));
  } else {
    buffer = await buildWorkbook(calcAll(inputs, params));
  }
  const blob = new Blob([buffer], {
    type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
  });
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = buildFileName();
  link.rel = 'noopener';
  document.body.appendChild(link);
  link.click();
  link.remove();
  setTimeout(() => URL.revokeObjectURL(url), 10000);
}

export const localApi = {
  async me(): Promise<MeResponse> {
    return {
      user: { id: 0, first_name: 'Локально' },
      devAuth: false,
      params: readParams(),
      botConfigured: false,
    };
  },

  async calc(inputs: string[], params: Params, opts?: CalcOptions) {
    const result = calcAll(inputs, params);
    const historyId = opts?.save === false ? null : saveToHistory(inputs, result.params, result, opts);
    return { ...result, historyId };
  },

  async saveParams(params: Params): Promise<{ params: Params }> {
    const normalized = normalizeParams(params);
    store.set(KEY_PARAMS, JSON.stringify(normalized));
    return { params: normalized };
  },

  async history(): Promise<{ items: HistoryEntry[] }> {
    return { items: readHistory() };
  },

  async historyItem(id: number): Promise<{ entry: HistoryEntry; result: CalcResult }> {
    const entry = readHistory().find((h) => h.id === id);
    if (!entry) throw new Error('Расчёт не найден');
    return { entry, result: calcAll(entry.inputs, entry.params) };
  },

  async deleteHistoryItem(id: number): Promise<{ ok: true }> {
    writeHistory(readHistory().filter((h) => h.id !== id));
    return { ok: true };
  },

  async sendDatabaseToChat(): Promise<{ ok: true; count: number }> {
    throw new Error('В автономном режиме база сохраняется на устройство, а не в чат');
  },

  async replaceHistory(entries: HistoryEntry[]): Promise<{ saved: number }> {
    const normalized = entries.slice(0, HISTORY_LIMIT).map((item, i) => ({ ...item, id: i + 1 }));
    writeHistory(normalized);
    nextId = normalized.length + 1;
    return { saved: normalized.length };
  },

  async clearHistory(): Promise<{ deleted: number }> {
    const count = readHistory().length;
    writeHistory([]);
    return { deleted: count };
  },

  async exportToChat(): Promise<{ ok: true }> {
    throw new Error('В автономном режиме файл сохраняется на устройство, а не в чат');
  },

  download: saveBlob,
};
