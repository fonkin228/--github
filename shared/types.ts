/** Параметры распределения. Полностью повторяют ячейки B5:B8 исходного Excel-файла. */
export interface Params {
  /** Доля 1 — % от N, округляется ВВЕРХ до `step` (B5, по умолчанию 0.89) */
  p1: number;
  /** Доля 2 — % от ИСХОДНОЙ N, без округления (B6, по умолчанию 0.07) */
  p2: number;
  /** Доля 3 — % от базы, заданной `p3Base` (B7, по умолчанию 0.04) */
  p3: number;
  /** Шаг округления вверх для п.1 (B8, по умолчанию 1000) */
  step: number;
  /** Комиссия за пополнение: вычитается из отмеченных поступлений (по умолчанию 0.01) */
  commissionRate: number;
  /**
   * От чего считается п.3:
   *  'nMinusRoundUp' — от (N − добавка округления). Рабочий вариант.
   *  'n'             — просто от исходной N.
   *  'part1'         — от округлённого результата п.1 (так было в первой версии таблицы).
   */
  p3Base: P3Base;
}

export type P3Base = 'nMinusRoundUp' | 'n' | 'part1';

export const P3_BASES: P3Base[] = ['nMinusRoundUp', 'n', 'part1'];

/** Подпись базы для интерфейса, бота и Excel. */
export const p3BaseLabel = (base: P3Base): string =>
  base === 'n' ? 'пополнения' : base === 'part1' ? 'доля 1' : 'пополнения − округление';

/** Короткая подпись для переключателя. */
export const p3BaseShortLabel = (base: P3Base): string =>
  base === 'n' ? 'пополнения' : base === 'part1' ? 'доля 1' : 'без округл.';

export const DEFAULT_PARAMS: Params = {
  p1: 0.89,
  p2: 0.07,
  p3: 0.04,
  step: 1000,
  commissionRate: 0.01,
  p3Base: 'nMinusRoundUp',
};

// ---------------------------------------------------------------------------
// Этап 1. Заработок складывается из отдельных поступлений.
// ---------------------------------------------------------------------------

/** Одно пополнение, как его ввёл пользователь. */
export interface IncomeItem {
  id: string;
  /** Сумма пополнения в свободной форме */
  amount: string;
  /** Удержана ли комиссия с этой строки */
  commission: boolean;
  /** Дата пополнения, YYYY-MM-DD. Проставляется автоматически, но её можно поправить. */
  date?: string;
}

export const newIncomeItem = (id: string, amount = '', commission = false, date?: string): IncomeItem => ({
  id,
  amount,
  commission,
  date,
});

/** Разобранная строка поступления. */
export interface IncomeLine {
  index: number;
  id: string;
  input: string;
  ok: boolean;
  error: string | null;
  /** Введённая сумма до удержания */
  gross: number | null;
  /** Сколько удержано комиссией */
  commission: number | null;
  /** Что пошло в заработок */
  net: number | null;
  hasCommission: boolean;
}

/** Итог этапа 1. */
export interface IncomeResult {
  lines: IncomeLine[];
  /**
   * Сумма пополнений. Именно она — база для доли 1 и налога:
   * комиссия из неё НЕ вычитается.
   */
  gross: number;
  /** Всего удержано комиссией. Влияет только на этап «Заработок». */
  commission: number;
  /** Пополнения за вычетом комиссии — справочно */
  net: number;
  validCount: number;
  invalidCount: number;
}

/** Одна строка расчёта. Поля названы по столбцам исходного файла. */
export interface CalcRow {
  /** № строки (столбец A) */
  index: number;
  /** То, что ввёл пользователь, как есть (столбец B) */
  input: string;
  ok: boolean;
  /** Текст ошибки для столбца K, если ввод не распознан */
  error: string | null;
  /** Очищенное число (скрытый столбец L) */
  n: number | null;
  /** C — p1 от N без округления */
  raw1: number | null;
  /** D — п.1, округлено вверх до step */
  part1: number | null;
  /** E — лог: сколько добавлено округлением (D − C) */
  roundUp: number | null;
  /** F — п.2 */
  part2: number | null;
  /** G — п.3 */
  part3: number | null;
  /** H — итого (D + F + G) */
  total: number | null;
  /** I — Δ итого − N */
  diff: number | null;
  /** J — справка: p3 от исходной N */
  refP3OfN: number | null;
  /** База, от которой фактически посчитан п.3 */
  base3: number | null;
  /** Комиссия, вычтенная из базы п.3 */
  commission: number;
}

export interface CalcTotals {
  count: number;
  invalid: number;
  n: number;
  part1: number;
  part2: number;
  part3: number;
  total: number;
  diff: number;
  roundUp: number;
}

export interface CalcResult {
  params: Params;
  rows: CalcRow[];
  totals: CalcTotals;
}

/** Итог блока трат на этапе 4. */
export interface ExpenseResult {
  lines: IncomeLine[];
  total: number;
  validCount: number;
  invalidCount: number;
}

export type CalcMode = 'stages' | 'batch';

export interface HistoryEntry {
  id: number;
  createdAt: string;
  title: string;
  params: Params;
  /** 'stages' — один расчёт по этапам, 'batch' — список независимых сумм */
  mode: CalcMode;
  /** Для пакетного режима */
  inputs: string[];
  /** Для пошагового режима */
  income?: IncomeItem[];
  /** Траты, вычитаемые из заработка на этапе 4 */
  expenses?: IncomeItem[];
  /** Кто сохранил расчёт — при общей базе видно всем */
  author?: string;
  totals: CalcTotals;
}
