/**
 * Разбор суммы, введённой человеком.
 * Повторяет (и расширяет) логику скрытого столбца L исходного файла:
 * SUBSTITUTE(...CHAR(160)...) + VALUE + отсев отрицательных.
 */

export type ParseResult =
  | { ok: true; value: number }
  | { ok: false; value: null; error: string };

/** Все виды пробелов, которые реально прилетают из Excel / 1С / копипасты. */
const SPACES = /[\s  -​  　  ﻿]/g;
/** Валюты и «хвосты», которые люди дописывают к сумме. */
const CURRENCY = /(₽|руб(лей|ля|\.)?|р\.|rub|usd|eur|\$|€)/gi;
/** Апостроф как разделитель разрядов (швейцарский стиль) и лишние кавычки. */
const QUOTES = /['’`"]/g;

const ERR_NOT_A_NUMBER = 'Не распознано как неотрицательное число — проверьте символы';
const ERR_NEGATIVE = 'Отрицательная сумма не поддерживается';

/**
 * Правила:
 *  - пробелы любых видов и валютные хвосты удаляются;
 *  - если есть и «,» и «.» — десятичным считается ПОСЛЕДНИЙ, второй считается разрядным;
 *  - если разделитель один, но встречается несколько раз (1.234.567) — это разряды;
 *  - одиночная «,» или «.» — десятичный разделитель.
 */
export function parseAmount(raw: string | number | null | undefined): ParseResult {
  if (raw === null || raw === undefined) return { ok: false, value: null, error: ERR_NOT_A_NUMBER };
  if (typeof raw === 'number') {
    if (!Number.isFinite(raw)) return { ok: false, value: null, error: ERR_NOT_A_NUMBER };
    if (raw < 0) return { ok: false, value: null, error: ERR_NEGATIVE };
    return { ok: true, value: raw };
  }

  let s = String(raw).trim();
  if (s === '') return { ok: false, value: null, error: ERR_NOT_A_NUMBER };

  s = s.replace(SPACES, '').replace(CURRENCY, '').replace(QUOTES, '');
  if (s === '') return { ok: false, value: null, error: ERR_NOT_A_NUMBER };

  let negative = false;
  if (s.startsWith('+')) s = s.slice(1);
  else if (s.startsWith('-') || s.startsWith('−')) {
    negative = true;
    s = s.slice(1);
  }

  const hasComma = s.includes(',');
  const hasDot = s.includes('.');

  if (hasComma && hasDot) {
    const decimalSep = s.lastIndexOf(',') > s.lastIndexOf('.') ? ',' : '.';
    const groupSep = decimalSep === ',' ? '.' : ',';
    s = s.split(groupSep).join('');
    const parts = s.split(decimalSep);
    if (parts.length !== 2) return { ok: false, value: null, error: ERR_NOT_A_NUMBER };
    s = `${parts[0]}.${parts[1]}`;
  } else if (hasComma || hasDot) {
    const sep = hasComma ? ',' : '.';
    const parts = s.split(sep);
    // 1.234.567 → разряды; 1234,56 → дробная часть
    s = parts.length > 2 ? parts.join('') : parts.join('.');
  }

  if (!/^\d+(\.\d+)?$/.test(s)) return { ok: false, value: null, error: ERR_NOT_A_NUMBER };

  const value = Number(s);
  if (!Number.isFinite(value)) return { ok: false, value: null, error: ERR_NOT_A_NUMBER };
  if (negative && value !== 0) return { ok: false, value: null, error: ERR_NEGATIVE };

  return { ok: true, value };
}

/**
 * Разбор процента: принимает 89, "89", "89%", 0.89, "0,89".
 * Значения > 1 трактуются как проценты, ≤ 1 — как доля.
 */
export function parsePercent(raw: string | number | null | undefined): ParseResult {
  const asString = typeof raw === 'string' ? raw.trim() : raw;
  const looksPercent = typeof asString === 'string' && asString.includes('%');
  const parsed = parseAmount(typeof asString === 'string' ? asString.replace('%', '') : asString);
  if (!parsed.ok) return parsed;
  const value = looksPercent || parsed.value > 1 ? parsed.value / 100 : parsed.value;
  if (value > 1) return { ok: false, value: null, error: 'Доля не может быть больше 100%' };
  return { ok: true, value };
}

/** Разбивает «многострочный» ввод на отдельные суммы: перевод строки, ; или таб. */
export function splitAmounts(text: string): string[] {
  return String(text ?? '')
    .split(/[\n\r;\t]+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0);
}
