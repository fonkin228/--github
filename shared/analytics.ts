/**
 * Сводка по периодам: сколько пополнено, сколько ушло в налог,
 * сколько получилось заработка и что осталось.
 *
 * Источник — сохранённые расчёты. Даты берутся с самих пополнений,
 * а налог и заработок расчёта разносятся между ними пропорционально суммам.
 */
import { calcStages } from './calc';
import { round2 } from './money';
import type { HistoryEntry } from './types';

export type Granularity = 'week' | 'month';

export interface PeriodStat {
  key: string;
  label: string;
  /** Первый и последний день периода, YYYY-MM-DD */
  from: string;
  to: string;
  /** Сумма пополнений */
  deposits: number;
  /** Налог */
  tax: number;
  /** Заработок после трат */
  payout: number;
  /** Пополнения − налог − заработок */
  remainder: number;
  /** Сколько пополнений попало в период */
  count: number;
}

export interface AnalyticsResult {
  periods: PeriodStat[];
  totals: Omit<PeriodStat, 'key' | 'label' | 'from' | 'to'>;
}

const MONTHS = [
  'январь', 'февраль', 'март', 'апрель', 'май', 'июнь',
  'июль', 'август', 'сентябрь', 'октябрь', 'ноябрь', 'декабрь',
];
const MONTHS_SHORT = ['янв', 'фев', 'мар', 'апр', 'мая', 'июн', 'июл', 'авг', 'сен', 'окт', 'ноя', 'дек'];

const pad = (n: number): string => String(n).padStart(2, '0');
export const toISODate = (d: Date): string => `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;

/** Понедельник недели, в которую попадает дата. */
function weekStart(d: Date): Date {
  const copy = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const shift = (copy.getDay() + 6) % 7; // воскресенье = 6
  copy.setDate(copy.getDate() - shift);
  return copy;
}

function periodOf(dateStr: string, granularity: Granularity): { key: string; label: string; from: string; to: string } {
  const d = new Date(`${dateStr}T00:00:00`);
  if (Number.isNaN(d.getTime())) {
    return { key: 'unknown', label: 'без даты', from: '', to: '' };
  }

  if (granularity === 'month') {
    const from = new Date(d.getFullYear(), d.getMonth(), 1);
    const to = new Date(d.getFullYear(), d.getMonth() + 1, 0);
    return {
      key: `${d.getFullYear()}-${pad(d.getMonth() + 1)}`,
      label: `${MONTHS[d.getMonth()]} ${d.getFullYear()}`,
      from: toISODate(from),
      to: toISODate(to),
    };
  }

  const from = weekStart(d);
  const to = new Date(from);
  to.setDate(to.getDate() + 6);
  const sameMonth = from.getMonth() === to.getMonth();
  const label = sameMonth
    ? `${from.getDate()}–${to.getDate()} ${MONTHS_SHORT[to.getMonth()]}`
    : `${from.getDate()} ${MONTHS_SHORT[from.getMonth()]} – ${to.getDate()} ${MONTHS_SHORT[to.getMonth()]}`;
  return { key: `w${toISODate(from)}`, label, from: toISODate(from), to: toISODate(to) };
}

/** Дата, к которой относить строку: сначала своя, иначе день сохранения расчёта. */
const lineDate = (own: string | undefined, createdAt: string): string =>
  own && /^\d{4}-\d{2}-\d{2}$/.test(own) ? own : createdAt.slice(0, 10);

export function buildAnalytics(entries: HistoryEntry[], granularity: Granularity): AnalyticsResult {
  const buckets = new Map<string, PeriodStat>();

  const bump = (dateStr: string, deposits: number, tax: number, payout: number, count: number): void => {
    const p = periodOf(dateStr, granularity);
    const current = buckets.get(p.key) ?? {
      ...p,
      deposits: 0,
      tax: 0,
      payout: 0,
      remainder: 0,
      count: 0,
    };
    current.deposits += deposits;
    current.tax += tax;
    current.payout += payout;
    current.count += count;
    buckets.set(p.key, current);
  };

  for (const entry of entries) {
    if (entry.mode === 'stages' && entry.income?.length) {
      const stages = calcStages(entry.income, entry.expenses ?? [], entry.params);
      const total = stages.income.gross;
      stages.income.lines.forEach((line, i) => {
        if (!line.ok) return;
        const share = total > 0 ? line.gross! / total : 0;
        bump(
          lineDate(entry.income![i]?.date, entry.createdAt),
          line.gross!,
          (stages.row.part2 ?? 0) * share,
          stages.payout * share,
          1,
        );
      });
      continue;
    }
    // Расчёты из бота: своей даты у строк нет, относим к дню сохранения.
    bump(entry.createdAt.slice(0, 10), entry.totals.n, entry.totals.part2, entry.totals.part3, entry.totals.count);
  }

  const periods = [...buckets.values()]
    .map((p) => ({
      ...p,
      deposits: round2(p.deposits),
      tax: round2(p.tax),
      payout: round2(p.payout),
      remainder: round2(p.deposits - p.tax - p.payout),
    }))
    .sort((a, b) => (a.from < b.from ? 1 : a.from > b.from ? -1 : 0));

  const totals = periods.reduce(
    (acc, p) => ({
      deposits: round2(acc.deposits + p.deposits),
      tax: round2(acc.tax + p.tax),
      payout: round2(acc.payout + p.payout),
      remainder: round2(acc.remainder + p.remainder),
      count: acc.count + p.count,
    }),
    { deposits: 0, tax: 0, payout: 0, remainder: 0, count: 0 },
  );

  return { periods, totals };
}
