import { ceilTo, round2 } from './money';
import { parseAmount } from './parse';
import {
  DEFAULT_PARAMS,
  P3_BASES,
  type CalcResult,
  type CalcRow,
  type CalcTotals,
  type ExpenseResult,
  type IncomeItem,
  type IncomeLine,
  type IncomeResult,
  type P3Base,
  type Params,
} from './types';

/** Приводит произвольный объект к валидным параметрам, подставляя дефолты. */
export function normalizeParams(input?: Partial<Params> | null): Params {
  const p = { ...DEFAULT_PARAMS, ...(input ?? {}) };
  const clampFraction = (v: unknown, fallback: number): number => {
    const n = typeof v === 'number' ? v : Number(v);
    if (!Number.isFinite(n) || n < 0 || n > 1) return fallback;
    return n;
  };
  const step = Number(p.step);
  return {
    p1: clampFraction(p.p1, DEFAULT_PARAMS.p1),
    p2: clampFraction(p.p2, DEFAULT_PARAMS.p2),
    p3: clampFraction(p.p3, DEFAULT_PARAMS.p3),
    step: Number.isFinite(step) && step > 0 ? step : DEFAULT_PARAMS.step,
    commissionRate: clampFraction(p.commissionRate, DEFAULT_PARAMS.commissionRate),
    p3Base: P3_BASES.includes(p.p3Base as P3Base) ? (p.p3Base as P3Base) : DEFAULT_PARAMS.p3Base,
  };
}

/**
 * Расчёт одной строки.
 * `commission` — удержания за пополнение: они уменьшают ТОЛЬКО базу третьей доли
 * («Заработок»), на долю 1 и налог не влияют.
 */
export function calcRow(
  input: string | number,
  index: number,
  params: Params,
  commission = 0,
): CalcRow {
  const raw = typeof input === 'number' ? String(input) : String(input ?? '');
  const parsed = parseAmount(input);

  const empty: CalcRow = {
    index,
    input: raw,
    ok: false,
    error: parsed.ok ? null : parsed.error,
    n: null,
    raw1: null,
    part1: null,
    roundUp: null,
    part2: null,
    part3: null,
    total: null,
    diff: null,
    refP3OfN: null,
    base3: null,
    commission,
  };
  if (!parsed.ok) return empty;

  const n = parsed.value;
  const raw1 = round2(n * params.p1);                       // C
  const part1 = ceilTo(n * params.p1, params.step);         // D  = CEILING(N*p1; step)
  const roundUp = round2(part1 - raw1);                     // E
  const part2 = round2(n * params.p2);                      // F
  // База для п.3: из суммы вычитается добавка округления и удержанная комиссия.
  const rawBase3 = params.p3Base === 'n' ? n : params.p3Base === 'part1' ? part1 : round2(n - roundUp);
  const base3 = round2(rawBase3 - commission);
  const part3 = round2(base3 * params.p3);                  // G
  const total = round2(part1 + part2 + part3);              // H
  const diff = round2(total - n);                           // I
  const refP3OfN = round2(n * params.p3);                   // J

  return {
    index,
    input: raw,
    ok: true,
    error: null,
    n,
    raw1,
    part1,
    roundUp,
    part2,
    part3,
    total,
    diff,
    refP3OfN,
    base3,
    commission,
  };
}

/** Пакетный расчёт со сводкой по всем валидным строкам. */
export function calcAll(inputs: Array<string | number>, paramsInput?: Partial<Params> | null): CalcResult {
  const params = normalizeParams(paramsInput);
  const rows = inputs.map((value, i) => calcRow(value, i + 1, params));

  const totals: CalcTotals = { count: 0, invalid: 0, n: 0, part1: 0, part2: 0, part3: 0, total: 0, diff: 0, roundUp: 0 };
  for (const row of rows) {
    if (!row.ok) {
      totals.invalid += 1;
      continue;
    }
    totals.count += 1;
    totals.n += row.n!;
    totals.part1 += row.part1!;
    totals.part2 += row.part2!;
    totals.part3 += row.part3!;
    totals.total += row.total!;
    totals.diff += row.diff!;
    totals.roundUp += row.roundUp!;
  }
  for (const key of ['n', 'part1', 'part2', 'part3', 'total', 'diff', 'roundUp'] as const) {
    totals[key] = round2(totals[key]);
  }

  return { params, rows, totals };
}

export { DEFAULT_PARAMS };
export type { CalcResult, CalcRow, CalcTotals, ExpenseResult, IncomeItem, IncomeResult, Params };

// ---------------------------------------------------------------------------
// Этап 1. Заработок из поступлений
// ---------------------------------------------------------------------------

/**
 * Складывает поступления в заработок.
 * Отмеченные галочкой строки уменьшаются на комиссию за пополнение.
 */
export function calcIncome(items: IncomeItem[], paramsInput?: Partial<Params> | null): IncomeResult {
  const params = normalizeParams(paramsInput);
  const lines: IncomeLine[] = [];
  let gross = 0;
  let commission = 0;
  let validCount = 0;
  let invalidCount = 0;

  items.forEach((item, i) => {
    const raw = String(item.amount ?? '');
    const parsed = parseAmount(raw);

    if (!parsed.ok) {
      // Пустая строка — не ошибка, её просто ещё не заполнили
      const isBlank = raw.trim() === '';
      if (!isBlank) invalidCount += 1;
      lines.push({
        index: i + 1,
        id: item.id,
        input: raw,
        ok: false,
        error: isBlank ? null : parsed.error,
        gross: null,
        commission: null,
        net: null,
        hasCommission: Boolean(item.commission),
      });
      return;
    }

    const value = parsed.value;
    const fee = item.commission ? round2(value * params.commissionRate) : 0;
    const net = round2(value - fee);

    gross = round2(gross + value);
    commission = round2(commission + fee);
    validCount += 1;

    lines.push({
      index: i + 1,
      id: item.id,
      input: raw,
      ok: true,
      error: null,
      gross: value,
      commission: fee,
      net,
      hasCommission: Boolean(item.commission),
    });
  });

  return { lines, gross, commission, net: round2(gross - commission), validCount, invalidCount };
}

/** Суммирует траты. Комиссия к ним не применяется — это просто список сумм. */
export function calcExpenses(items: IncomeItem[]): ExpenseResult {
  const plain = calcIncome(
    items.map((item) => ({ ...item, commission: false })),
    { commissionRate: 0 },
  );
  return {
    lines: plain.lines,
    total: plain.gross,
    validCount: plain.validCount,
    invalidCount: plain.invalidCount,
  };
}

export interface StagesResult {
  params: Params;
  income: IncomeResult;
  expenses: ExpenseResult;
  row: CalcRow;
  /** Заработок после вычета трат — итоговая сумма к переводу себе */
  payout: number;
}

/**
 * Полный пошаговый расчёт.
 * База для доли 1 и налога — вся сумма пополнений.
 * Комиссия уменьшает базу «Заработка», траты вычитаются уже из самого заработка.
 */
export function calcStages(
  items: IncomeItem[],
  expenseItems: IncomeItem[] = [],
  paramsInput?: Partial<Params> | null,
): StagesResult {
  const params = normalizeParams(paramsInput);
  const income = calcIncome(items, params);
  const expenses = calcExpenses(expenseItems);
  const row = calcRow(income.gross, 1, params, income.commission);
  const payout = row.ok ? round2((row.part3 ?? 0) - expenses.total) : 0;
  return { params, income, expenses, row, payout };
}
