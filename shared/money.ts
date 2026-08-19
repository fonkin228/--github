/**
 * Денежная арифметика с защитой от плавающей точки.
 * Excel внутри тоже double, но он «подчищает» результат при отображении и в CEILING;
 * здесь мы делаем это явно, иначе 630000.0000000001 улетит в 631000.
 */

const EPS_REL = 1e-9;

/** Округление до N знаков, half-up (как у Excel ROUND), без 1.005 → 1.00 багов. */
export function round(value: number, decimals = 2): number {
  if (!Number.isFinite(value)) return value;
  const factor = Math.pow(10, decimals);
  // Сдвиг через экспоненциальную запись убирает классическую ошибку Math.round(1.005*100)
  const shifted = Number(`${Math.round(Number(`${value}e${decimals}`))}e-${decimals}`);
  return Number.isFinite(shifted) ? shifted : Math.round(value * factor) / factor;
}

export const round2 = (v: number): number => round(v, 2);

/**
 * Аналог Excel CEILING(value, step) для неотрицательных значений.
 * Если value уже кратно step в пределах погрешности — возвращаем как есть (добавка 0).
 */
export function ceilTo(value: number, step: number): number {
  if (!Number.isFinite(value)) return NaN;
  if (!Number.isFinite(step) || step <= 0) return value;
  const q = value / step;
  const nearest = Math.round(q);
  if (Math.abs(q - nearest) <= EPS_REL * Math.max(1, Math.abs(q))) {
    return round(nearest * step, 6);
  }
  return round(Math.ceil(q) * step, 6);
}

/** 1234567.5 → "1 234 567,50" (неразрывные пробелы, как в отчётах) */
export function formatMoney(value: number | null | undefined, decimals = 2): string {
  if (value === null || value === undefined || !Number.isFinite(value)) return '';
  return new Intl.NumberFormat('ru-RU', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(value);
}

/** 0.89 → "89%" */
export function formatPercent(fraction: number): string {
  return `${round(fraction * 100, 4)}%`;
}
