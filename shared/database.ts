/**
 * «База» — вся история одним xlsx-файлом.
 * Файл можно править руками в Excel и загружать обратно: строки читаются
 * теми же правилами, что и ввод в приложении.
 */
import ExcelJS from 'exceljs';
import { calcStages, normalizeParams } from './calc';
import { parseAmount, parsePercent } from './parse';
import { DEPOSITS, withPlural } from './plural';
import {
  DEFAULT_PARAMS,
  P3_BASES,
  newIncomeItem,
  p3BaseLabel,
  type HistoryEntry,
  type IncomeItem,
  type P3Base,
  type Params,
} from './types';

const SHEET_DATA = 'База';
const SHEET_PARAMS = 'Параметры';

const TYPE_DEPOSIT = 'пополнение';
const TYPE_EXPENSE = 'трата';

const MONEY = '#,##0.00';
const TEXT = '@';
const PERCENT = '0.00%';

const HEADERS = ['Расчёт', 'Дата', 'Тип', 'Сумма', 'Комиссия'];
const PARAM_HEADERS = ['Расчёт', 'Доля 1', 'Налог', 'Заработок', 'Шаг округления', 'Комиссия', 'База заработка'];

const fill = (argb: string): ExcelJS.FillPattern => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });
const headerStyle = (cell: ExcelJS.Cell): void => {
  cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
  cell.fill = fill('FF4472C4');
  cell.alignment = { horizontal: 'center', wrapText: true };
};

/** Собирает всю историю в один файл. */
export async function buildDatabaseWorkbook(entries: HistoryEntry[]): Promise<ArrayBuffer> {
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Распределение пополнений';
  wb.created = new Date();

  const ws = wb.addWorksheet(SHEET_DATA);
  ws.getCell('A1').value = 'База расчётов. Можно править руками и загружать обратно в приложение.';
  ws.getCell('A1').font = { bold: true, size: 12 };
  ws.mergeCells('A1:E1');
  ws.getCell('A2').value =
    'Одна строка — одно пополнение или трата. Строки с одинаковым номером в столбце «Расчёт» — это один расчёт. ' +
    'Чтобы добавить новый расчёт, поставьте следующий свободный номер. Комиссия отмечается словом «да».';
  ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  ws.mergeCells('A2:E2');
  ws.getRow(2).height = 30;

  HEADERS.forEach((title, i) => {
    const cell = ws.getCell(4, i + 1);
    cell.value = title;
    headerStyle(cell);
  });
  [10, 14, 16, 16, 12].forEach((w, i) => {
    ws.getColumn(i + 1).width = w;
  });

  let r = 5;
  entries.forEach((entry, index) => {
    const group = index + 1;
    const push = (date: string, type: string, amount: number, commission: boolean): void => {
      ws.getCell(r, 1).value = group;
      const dateCell = ws.getCell(r, 2);
      dateCell.value = date;
      dateCell.numFmt = TEXT; // текстом, чтобы Excel не превращал дату в число
      ws.getCell(r, 3).value = type;
      const money = ws.getCell(r, 4);
      money.value = amount;
      money.numFmt = MONEY;
      ws.getCell(r, 5).value = commission ? 'да' : '';
      ws.getCell(r, 5).alignment = { horizontal: 'center' };
      r += 1;
    };

    const fallbackDate = entry.createdAt.slice(0, 10);
    for (const item of entry.income ?? []) {
      const parsed = parseAmount(item.amount);
      if (!parsed.ok) continue;
      push(item.date || fallbackDate, TYPE_DEPOSIT, parsed.value, Boolean(item.commission));
    }
    for (const item of entry.expenses ?? []) {
      const parsed = parseAmount(item.amount);
      if (!parsed.ok) continue;
      push('', TYPE_EXPENSE, parsed.value, false);
    }
  });

  // --- Лист параметров ---------------------------------------------------
  const ps = wb.addWorksheet(SHEET_PARAMS);
  ps.getCell('A1').value = 'Параметры каждого расчёта. Если строки нет — возьмутся текущие настройки приложения.';
  ps.getCell('A1').font = { italic: true, color: { argb: 'FF808080' } };
  ps.mergeCells('A1:G1');
  PARAM_HEADERS.forEach((title, i) => {
    const cell = ps.getCell(3, i + 1);
    cell.value = title;
    headerStyle(cell);
  });
  [10, 12, 12, 14, 16, 13, 22].forEach((w, i) => {
    ps.getColumn(i + 1).width = w;
  });

  entries.forEach((entry, index) => {
    const row = 4 + index;
    const p = entry.params;
    ps.getCell(row, 1).value = index + 1;
    // Проценты пишем долями в процентном формате: в Excel видно «89,00%»,
    // а при чтении не путается 1% с единицей.
    ([
      [2, p.p1],
      [3, p.p2],
      [4, p.p3],
      [6, p.commissionRate],
    ] as Array<[number, number]>).forEach(([col, value]) => {
      const cell = ps.getCell(row, col);
      cell.value = value;
      cell.numFmt = PERCENT;
    });
    ps.getCell(row, 5).value = p.step;
    ps.getCell(row, 5).numFmt = '#,##0';
    ps.getCell(row, 7).value = p3BaseLabel(p.p3Base);
  });

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

const cellText = (cell: ExcelJS.Cell | undefined): string => {
  const v = cell?.value;
  if (v === null || v === undefined) return '';
  if (v instanceof Date) {
    const pad = (n: number): string => String(n).padStart(2, '0');
    return `${v.getFullYear()}-${pad(v.getMonth() + 1)}-${pad(v.getDate())}`;
  }
  if (typeof v === 'object' && 'result' in v) return String((v as { result?: unknown }).result ?? '');
  if (typeof v === 'object' && 'text' in v) return String((v as { text?: unknown }).text ?? '');
  return String(v);
};

const readP3Base = (text: string): P3Base | null => {
  const normalized = text.trim().toLowerCase();
  const found = P3_BASES.find((base) => p3BaseLabel(base).toLowerCase() === normalized);
  return found ?? null;
};

export interface ImportResult {
  entries: HistoryEntry[];
  /** Строки, которые не удалось прочитать: номер строки в файле и причина */
  skipped: Array<{ row: number; reason: string }>;
}

/**
 * Читает файл базы обратно в записи истории.
 * `fallbackParams` используется для расчётов, которых нет на листе «Параметры».
 */
export async function parseDatabaseWorkbook(
  data: ArrayBuffer,
  fallbackParams: Params = DEFAULT_PARAMS,
): Promise<ImportResult> {
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(data as never);

  const ws = wb.getWorksheet(SHEET_DATA) ?? wb.worksheets[0];
  if (!ws) throw new Error('В файле нет листа с данными');

  // --- параметры по расчётам --------------------------------------------
  const paramsByGroup = new Map<string, Params>();
  const ps = wb.getWorksheet(SHEET_PARAMS);
  if (ps) {
    ps.eachRow((row, rowNumber) => {
      if (rowNumber < 4) return;
      const group = cellText(row.getCell(1)).trim();
      if (!group) return;
      const p1 = parsePercent(cellText(row.getCell(2)));
      const p2 = parsePercent(cellText(row.getCell(3)));
      const p3 = parsePercent(cellText(row.getCell(4)));
      const step = parseAmount(cellText(row.getCell(5)));
      const fee = parsePercent(cellText(row.getCell(6)));
      const base = readP3Base(cellText(row.getCell(7)));
      paramsByGroup.set(
        group,
        normalizeParams({
          p1: p1.ok ? p1.value : fallbackParams.p1,
          p2: p2.ok ? p2.value : fallbackParams.p2,
          p3: p3.ok ? p3.value : fallbackParams.p3,
          step: step.ok && step.value > 0 ? step.value : fallbackParams.step,
          commissionRate: fee.ok ? fee.value : fallbackParams.commissionRate,
          p3Base: base ?? fallbackParams.p3Base,
        }),
      );
    });
  }

  // --- строки -------------------------------------------------------------
  interface Group {
    income: IncomeItem[];
    expenses: IncomeItem[];
    dates: string[];
  }
  const groups = new Map<string, Group>();
  const order: string[] = [];
  const skipped: ImportResult['skipped'] = [];
  let seq = 0;

  ws.eachRow((row, rowNumber) => {
    if (rowNumber <= 4) return; // заголовок и шапка
    const group = cellText(row.getCell(1)).trim();
    const dateRaw = cellText(row.getCell(2)).trim();
    const typeRaw = cellText(row.getCell(3)).trim().toLowerCase();
    const amountRaw = cellText(row.getCell(4)).trim();
    const feeRaw = cellText(row.getCell(5)).trim().toLowerCase();

    if (!group && !amountRaw) return; // пустая строка
    if (!group) {
      skipped.push({ row: rowNumber, reason: 'не указан номер расчёта' });
      return;
    }
    const parsed = parseAmount(amountRaw);
    if (!parsed.ok) {
      skipped.push({ row: rowNumber, reason: `сумма «${amountRaw}» не распознана` });
      return;
    }

    if (!groups.has(group)) {
      groups.set(group, { income: [], expenses: [], dates: [] });
      order.push(group);
    }
    const bucket = groups.get(group)!;
    const isExpense = typeRaw.startsWith('т') || typeRaw.startsWith('р');
    const item = newIncomeItem(
      `imp-${group}-${seq++}`,
      String(parsed.value),
      !isExpense && ['да', 'yes', '1', 'true', '+', 'х', 'x'].includes(feeRaw),
      isExpense ? undefined : /^\d{4}-\d{2}-\d{2}$/.test(dateRaw) ? dateRaw : undefined,
    );
    if (isExpense) bucket.expenses.push(item);
    else {
      bucket.income.push(item);
      if (item.date) bucket.dates.push(item.date);
    }
  });

  const entries: HistoryEntry[] = order.map((group, index) => {
    const bucket = groups.get(group)!;
    const params = paramsByGroup.get(group) ?? normalizeParams(fallbackParams);
    const stages = calcStages(bucket.income, bucket.expenses, params);
    const latest = bucket.dates.slice().sort().pop();
    const createdAt = latest ? `${latest}T12:00:00.000Z` : new Date().toISOString();

    return {
      id: index + 1,
      createdAt,
      title:
        bucket.income.length === 1
          ? bucket.income[0].amount
          : withPlural(bucket.income.length, DEPOSITS),
      params,
      mode: 'stages',
      inputs: [String(stages.income.gross)],
      income: bucket.income,
      expenses: bucket.expenses,
      totals: {
        count: stages.income.validCount,
        invalid: stages.income.invalidCount,
        n: stages.income.gross,
        part1: stages.row.part1 ?? 0,
        part2: stages.row.part2 ?? 0,
        part3: stages.row.part3 ?? 0,
        total: stages.row.total ?? 0,
        diff: stages.row.diff ?? 0,
        roundUp: stages.row.roundUp ?? 0,
      },
    };
  });

  return { entries, skipped };
}

export const DATABASE_FILE_NAME = 'baza-raschetov.xlsx';
