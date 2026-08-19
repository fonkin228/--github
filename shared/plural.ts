/** Русские числительные: plural(2, ['строка','строки','строк']) → 'строки' */
export function plural(count: number, forms: [string, string, string]): string {
  const n = Math.abs(Math.trunc(count));
  const mod10 = n % 10;
  const mod100 = n % 100;
  if (mod10 === 1 && mod100 !== 11) return forms[0];
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return forms[1];
  return forms[2];
}

export const ROWS: [string, string, string] = ['строка', 'строки', 'строк'];
export const ROWS_DAT: [string, string, string] = ['строке', 'строкам', 'строкам'];
export const SUMS: [string, string, string] = ['сумма', 'суммы', 'сумм'];
export const RECORDS: [string, string, string] = ['запись', 'записи', 'записей'];
export const DEPOSITS: [string, string, string] = ['пополнение', 'пополнения', 'пополнений'];
export const PERIODS: [string, string, string] = ['период', 'периода', 'периодов'];

/** «3 строки» */
export const withPlural = (count: number, forms: [string, string, string]): string =>
  `${count} ${plural(count, forms)}`;
