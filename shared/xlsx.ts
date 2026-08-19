import ExcelJS from 'exceljs';
import { formatMoney, formatPercent } from './money';
import {
  p3BaseLabel,
  type CalcResult,
  type CalcRow,
  type ExpenseResult,
  type IncomeResult,
  type Params,
} from './types';

const HEADER_ROW = 11;
const FIRST_DATA_ROW = 12;

const YELLOW = 'FFFFF2CC'; // ввод
const GREEN = 'FFE2EFDA';  // ключевой результат (п.1 и лог округления)
const GREY = 'FFF2F2F2';   // служебное
const BLUE = 'FFDDEBF7';   // итоги

const MONEY = '#,##0.00';
const PERCENT = '0.00%';

const fill = (argb: string): ExcelJS.FillPattern => ({ type: 'pattern', pattern: 'solid', fgColor: { argb } });

const thin: Partial<ExcelJS.Borders> = {
  top: { style: 'thin', color: { argb: 'FFD0D0D0' } },
  left: { style: 'thin', color: { argb: 'FFD0D0D0' } },
  bottom: { style: 'thin', color: { argb: 'FFD0D0D0' } },
  right: { style: 'thin', color: { argb: 'FFD0D0D0' } },
};

/**
 * Формула скрытого столбца L — очистка ввода, 1:1 из исходного файла.
 * Внутри намеренно живут неразрывный (U+00A0) и узкий неразрывный (U+202F) пробелы.
 */
function cleanNumberFormula(row: number): string {
  const clean = `SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(SUBSTITUTE(B${row},CHAR(160),"")," ","")," ","")," ","")`;
  return `IF(B${row}="","",IFERROR(IF(VALUE(${clean})<0,"",VALUE(${clean})),""))`;
}

const HEADERS: Array<{ key: string; title: string; width: number }> = [
  { key: 'A', title: '№', width: 6 },
  { key: 'B', title: 'Пополнение', width: 16 },
  { key: 'C', title: '% доли 1 (без округления)', width: 18 },
  { key: 'D', title: 'Доля 1 — округлено вверх', width: 18 },
  { key: 'E', title: 'Лог: добавлено округлением', width: 16 },
  { key: 'F', title: 'Налог', width: 14 },
  { key: 'G', title: 'Заработок', width: 15 },
  { key: 'H', title: 'Итого (П.1+П.2+П.3)', width: 16 },
  { key: 'I', title: 'Δ Итого − пополнение', width: 15 },
  { key: 'J', title: 'Справка: % от пополнения', width: 15 },
  { key: 'K', title: 'Статус ввода', width: 38 },
  { key: 'L', title: 'Пополнение — служебный', width: 12 },
];

/**
 * Собирает «живую» книгу: значения посчитаны, но формулы на месте и пересчитываются в Excel.
 * Работает и в Node, и в браузере — ExcelJS сам подставляет нужную сборку.
 */
export async function buildWorkbook(
  result: CalcResult,
  meta?: { title?: string; author?: string },
): Promise<ArrayBuffer> {
  const { params, rows, totals } = result;
  const wb = new ExcelJS.Workbook();
  wb.creator = meta?.author ?? 'Telegram Mini App «Распределение суммы»';
  wb.created = new Date();
  const ws = wb.addWorksheet('Расчёт', {
    views: [{ state: 'frozen', ySplit: HEADER_ROW, xSplit: 2 }],
  });

  // --- Шапка -------------------------------------------------------------
  ws.getCell('A1').value =
    meta?.title ?? `Распределение пополнений (${formatPercent(params.p1)} / ${formatPercent(params.p2)} / ${formatPercent(params.p3)})`;
  ws.getCell('A1').font = { bold: true, size: 14 };
  ws.mergeCells('A1:L1');

  ws.getCell('A2').value =
    'Заполняйте только жёлтые ячейки: параметры в B5:B8 и пополнения в столбце B, начиная со строки 12. ' +
    'Сумму можно вводить как угодно — 678945, 678 945 или 678 945,50: пробелы убираются автоматически.';
  ws.getCell('A2').alignment = { wrapText: true, vertical: 'top' };
  ws.mergeCells('A2:L2');
  ws.getRow(2).height = 30;

  // --- Параметры ---------------------------------------------------------
  ws.getCell('A4').value = 'ПАРАМЕТРЫ';
  ws.getCell('A4').font = { bold: true };

  const paramRows: Array<[string, number, string]> = [
    ['Доля 1 — % от пополнения (округляется вверх)', params.p1, '← проценты меняются здесь, формулы ссылаются на эти ячейки'],
    ['Налог — % от пополнения', params.p2, ''],
    [`Доля 3 — % от «${p3BaseLabel(params.p3Base)}»`, params.p3, ''],
  ];
  paramRows.forEach(([label, value, hint], i) => {
    const r = 5 + i;
    ws.getCell(`A${r}`).value = label;
    const cell = ws.getCell(`B${r}`);
    cell.value = value;
    cell.numFmt = PERCENT;
    cell.fill = fill(YELLOW);
    cell.border = thin;
    if (hint) {
      ws.getCell(`C${r}`).value = hint;
      ws.getCell(`C${r}`).font = { italic: true, color: { argb: 'FF808080' } };
    }
  });
  ws.getCell('A8').value = 'Шаг округления вверх';
  const stepCell = ws.getCell('B8');
  stepCell.value = params.step;
  stepCell.numFmt = '#,##0';
  stepCell.fill = fill(YELLOW);
  stepCell.border = thin;

  // --- Заголовки таблицы -------------------------------------------------
  HEADERS.forEach(({ key, title, width }) => {
    ws.getColumn(key).width = width;
    const cell = ws.getCell(`${key}${HEADER_ROW}`);
    cell.value = title;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill('FF4472C4');
    cell.alignment = { wrapText: true, vertical: 'middle', horizontal: 'center' };
    cell.border = thin;
  });
  ws.getRow(HEADER_ROW).height = 46;

  // --- Строки данных -----------------------------------------------------
  rows.forEach((row, i) => {
    writeDataRow(ws, FIRST_DATA_ROW + i, row, params);
  });

  // Несколько пустых строк «про запас» — формулы уже протянуты.
  const spare = 10;
  for (let i = 0; i < spare; i += 1) {
    writeDataRow(ws, FIRST_DATA_ROW + rows.length + i, null, params);
  }

  // --- Итоги -------------------------------------------------------------
  const lastDataRow = FIRST_DATA_ROW + rows.length + spare - 1;
  const totalRow = lastDataRow + 1;
  ws.getCell(`A${totalRow}`).value = 'ИТОГО';
  ws.getCell(`A${totalRow}`).font = { bold: true };
  const totalsMap: Record<string, number> = {
    B: totals.n,
    D: totals.part1,
    E: totals.roundUp,
    F: totals.part2,
    G: totals.part3,
    H: totals.total,
    I: totals.diff,
  };
  for (const [col, value] of Object.entries(totalsMap)) {
    const cell = ws.getCell(`${col}${totalRow}`);
    const sumCol = col === 'B' ? 'L' : col;
    cell.value = { formula: `SUM(${sumCol}${FIRST_DATA_ROW}:${sumCol}${lastDataRow})`, result: value };
    cell.numFmt = MONEY;
    cell.font = { bold: true };
    cell.fill = fill(BLUE);
    cell.border = thin;
  }

  // --- Пояснения ---------------------------------------------------------
  const notes = [
    'КАК ЭТО РАБОТАЕТ',
    '• Жёлтые ячейки — ввод (проценты, шаг округления, пополнения). Всё остальное — формулы, их трогать не нужно.',
    '• Сумму можно вводить с пробелами (678 945) или без (678945). Дробную часть — через запятую.',
    '• Если ввод не распознан как неотрицательное число, в столбце K появится предупреждение, а расчётные ячейки останутся пустыми.',
    '• Столбец C — п.1 без округления (промежуточный расчёт).',
    '• Столбец D (п.1) — то же значение, округлённое ВВЕРХ до ближайшей кратности шага: =CEILING(заработок*доля1; шаг).',
    '• Столбец E — лог: сколько именно добавлено для достижения кратности (D − C).',
    '• Столбец F (п.2) — % от заработка, без округления.',
    params.p3Base === 'n'
      ? '• Столбец G (п.3) — % от заработка (режим «от заработка»).'
      : params.p3Base === 'part1'
        ? '• Столбец G (п.3) — % от результата п.1, то есть от округлённой суммы (D × доля3).'
        : '• Столбец G (п.3) — % от заработка БЕЗ добавки округления: (заработок − E) × доля3.',
    '• Столбец H — сумма трёх частей; столбец I — насколько она отличается от заработка.',
    '• Столбец J — справочный: доля 3 от заработка.',
    '• Столбец L скрыт: в нём очищенный заработок, от которого идут все расчёты. Не удаляйте его.',
    '• Шаг округления в B8 можно поменять на 100, 500, 5000 — логика сохранится.',
  ];
  notes.forEach((text, i) => {
    const r = totalRow + 2 + i;
    ws.getCell(`A${r}`).value = text;
    if (i === 0) ws.getCell(`A${r}`).font = { bold: true };
  });

  ws.getColumn('L').hidden = true;
  ws.getColumn('A').width = 6;

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}

function writeDataRow(ws: ExcelJS.Worksheet, r: number, row: CalcRow | null, params: Params): void {
  // База для п.3: N минус добавка округления / просто N / округлённый п.1
  const p3Ref =
    params.p3Base === 'n' ? `$L${r}` : params.p3Base === 'part1' ? `D${r}` : `($L${r}-E${r})`;
  // ROUND(...;2) держит файл копейка-в-копейку с расчётом в приложении.
  const guard = (formula: string): string => `IF($L${r}="","",ROUND(${formula},2))`;

  // B — то, что ввёл пользователь. Валидное число пишем числом, мусор — как есть, текстом.
  const bCell = ws.getCell(`B${r}`);
  if (row) bCell.value = row.ok ? row.n : row.input;
  bCell.numFmt = MONEY;
  bCell.fill = fill(YELLOW);
  bCell.border = thin;

  const cells: Array<{ col: string; formula: string; result: number | string; numFmt?: string; bg?: string }> = [
    { col: 'A', formula: `IF(B${r}="","",ROW()-${HEADER_ROW})`, result: row?.ok ? row.index : '', numFmt: '0' },
    { col: 'C', formula: guard(`$L${r}*$B$5`), result: row?.raw1 ?? '' },
    {
      col: 'D',
      formula: `IF($L${r}="","",CEILING($L${r}*$B$5,$B$8))`,
      result: row?.part1 ?? '',
      bg: GREEN,
    },
    { col: 'E', formula: guard(`D${r}-C${r}`), result: row?.roundUp ?? '', bg: GREEN },
    { col: 'F', formula: guard(`$L${r}*$B$6`), result: row?.part2 ?? '' },
    { col: 'G', formula: guard(`${p3Ref}*$B$7`), result: row?.part3 ?? '' },
    { col: 'H', formula: guard(`D${r}+F${r}+G${r}`), result: row?.total ?? '' },
    { col: 'I', formula: guard(`H${r}-$L${r}`), result: row?.diff ?? '' },
    { col: 'J', formula: guard(`$L${r}*$B$7`), result: row?.refP3OfN ?? '' },
    {
      col: 'K',
      formula: `IF(B${r}="","",IF($L${r}="","Не распознано как неотрицательное число — проверьте символы",""))`,
      result: row && !row.ok ? (row.error ?? '') : '',
      numFmt: 'General',
    },
    { col: 'L', formula: cleanNumberFormula(r), result: row?.n ?? '', bg: GREY },
  ];

  for (const { col, formula, result, numFmt, bg } of cells) {
    const cell = ws.getCell(`${col}${r}`);
    cell.value = { formula, result: result as ExcelJS.CellValue } as ExcelJS.CellFormulaValue;
    cell.numFmt = numFmt ?? MONEY;
    cell.border = thin;
    if (bg) cell.fill = fill(bg);
    if (col === 'K') cell.font = { color: { argb: 'FFC00000' }, bold: true };
    if (col === 'H') cell.font = { bold: true };
  }
}

/** Имя файла вида «raspredelenie-2026-08-18-1432.xlsx» */
export function buildFileName(prefix = 'raspredelenie'): string {
  const d = new Date();
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${prefix}-${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}-${pad(d.getHours())}${pad(d.getMinutes())}.xlsx`;
}

// ---------------------------------------------------------------------------
// Пошаговая книга: тот же расчёт, что на экране, разложенный по этапам.
// ---------------------------------------------------------------------------

/** Собирает книгу для пошагового режима: заработок из поступлений + пять этапов. */
export async function buildStagesWorkbook(stages: {
  income: IncomeResult;
  expenses: ExpenseResult;
  row: CalcRow;
  params: Params;
  payout: number;
}): Promise<ArrayBuffer> {
  const { income, expenses, row, params, payout } = stages;
  const wb = new ExcelJS.Workbook();
  wb.creator = 'Калькулятор распределения заработка';
  wb.created = new Date();
  const ws = wb.addWorksheet('Расчёт');

  ws.getColumn('A').width = 6;
  ws.getColumn('B').width = 34;
  ws.getColumn('C').width = 18;
  ws.getColumn('D').width = 18;
  ws.getColumn('E').width = 18;

  const title = (cell: string, text: string, size = 14): void => {
    ws.getCell(cell).value = text;
    ws.getCell(cell).font = { bold: true, size };
  };

  const sectionHeader = (r: number, text: string, hint: string): void => {
    ws.getCell(`A${r}`).value = text;
    ws.getCell(`A${r}`).font = { bold: true, size: 12, color: { argb: 'FF1F4E79' } };
    ws.mergeCells(`A${r}:E${r}`);
    ws.getCell(`A${r + 1}`).value = hint;
    ws.getCell(`A${r + 1}`).font = { italic: true, size: 9, color: { argb: 'FF808080' } };
    ws.getCell(`A${r + 1}`).alignment = { wrapText: true, vertical: 'top' };
    ws.mergeCells(`A${r + 1}:E${r + 1}`);
    ws.getRow(r + 1).height = 26;
  };

  /** Строка «пояснение — значение». `strong` выделяет главный результат этапа. */
  const valueRow = (r: number, label: string, formula: string, result: number, strong = false): void => {
    ws.getCell(`B${r}`).value = label;
    if (strong) ws.getCell(`B${r}`).font = { bold: true };
    const cell = ws.getCell(`C${r}`);
    cell.value = { formula, result } as ExcelJS.CellFormulaValue;
    cell.numFmt = MONEY;
    cell.border = thin;
    if (strong) {
      cell.font = { bold: true };
      cell.fill = fill(GREEN);
    }
  };

  title('A1', 'Распределение заработка — расчёт по этапам');
  ws.mergeCells('A1:E1');

  // --- Параметры ---------------------------------------------------------
  sectionHeader(3, 'ПАРАМЕТРЫ', 'Жёлтые ячейки можно менять — весь расчёт ниже пересчитается сам.');
  const paramRows: Array<[string, number, string]> = [
    ['Доля 1 — % от пополнения (округляется вверх)', params.p1, PERCENT],
    ['Налог — % от пополнения', params.p2, PERCENT],
    [`Доля 3 — % от «${p3BaseLabel(params.p3Base)}»`, params.p3, PERCENT],
    ['Шаг округления вверх', params.step, '#,##0'],
    ['Комиссия за пополнение, %', params.commissionRate, PERCENT],
  ];
  const P_FIRST = 5;
  paramRows.forEach(([label, value, fmt], i) => {
    const r = P_FIRST + i;
    ws.getCell(`B${r}`).value = label;
    const cell = ws.getCell(`C${r}`);
    cell.value = value;
    cell.numFmt = fmt;
    cell.fill = fill(YELLOW);
    cell.border = thin;
  });
  const P1 = `$C$${P_FIRST}`;
  const P2 = `$C$${P_FIRST + 1}`;
  const P3 = `$C$${P_FIRST + 2}`;
  const STEP = `$C$${P_FIRST + 3}`;
  const FEE = `$C$${P_FIRST + 4}`;

  // --- Этап 1 ------------------------------------------------------------
  const s1 = P_FIRST + 6;
  sectionHeader(
    s1,
    'ЭТАП 1. ПОПОЛНЕНИЯ',
    'Пополнения складываются. По строкам с пометкой «да» удержана комиссия — она уменьшит только «Заработок» на этапе 4.',
  );
  const headRow = s1 + 2;
  ['№', 'Пополнение', 'Комиссия', 'Удержано', 'За вычетом'].forEach((text, i) => {
    const cell = ws.getCell(headRow, i + 1);
    cell.value = text;
    cell.font = { bold: true, color: { argb: 'FFFFFFFF' } };
    cell.fill = fill('FF4472C4');
    cell.alignment = { horizontal: 'center' };
    cell.border = thin;
  });

  const valid = income.lines.filter((l) => l.ok);
  const first = headRow + 1;
  valid.forEach((line, i) => {
    const r = first + i;
    ws.getCell(`A${r}`).value = i + 1;
    const amount = ws.getCell(`B${r}`);
    amount.value = line.gross;
    amount.numFmt = MONEY;
    amount.fill = fill(YELLOW);
    amount.border = thin;

    const flag = ws.getCell(`C${r}`);
    flag.value = line.hasCommission ? 'да' : '';
    flag.alignment = { horizontal: 'center' };
    flag.fill = fill(YELLOW);
    flag.border = thin;

    const held = ws.getCell(`D${r}`);
    held.value = { formula: `IF(C${r}="да",ROUND(B${r}*${FEE},2),0)`, result: line.commission } as ExcelJS.CellFormulaValue;
    held.numFmt = MONEY;
    held.border = thin;

    const net = ws.getCell(`E${r}`);
    net.value = { formula: `ROUND(B${r}-D${r},2)`, result: line.net } as ExcelJS.CellFormulaValue;
    net.numFmt = MONEY;
    net.border = thin;
  });

  const last = first + Math.max(valid.length, 1) - 1;
  const sumRow = last + 1;
  ws.getCell(`A${sumRow}`).value = 'Итого';
  ws.getCell(`A${sumRow}`).font = { bold: true };
  (
    [
      ['B', `SUM(B${first}:B${last})`, income.gross],
      ['D', `SUM(D${first}:D${last})`, income.commission],
      ['E', `SUM(E${first}:E${last})`, income.net],
    ] as Array<[string, string, number]>
  ).forEach(([col, formula, result]) => {
    const cell = ws.getCell(`${col}${sumRow}`);
    cell.value = { formula, result } as ExcelJS.CellFormulaValue;
    cell.numFmt = MONEY;
    cell.font = { bold: true };
    cell.fill = fill(BLUE);
    cell.border = thin;
  });

  const earnRow = sumRow + 1;
  ws.getCell(`B${earnRow}`).value = 'СУММА ПОПОЛНЕНИЙ';
  ws.getCell(`B${earnRow}`).font = { bold: true, size: 12 };
  const earnCell = ws.getCell(`C${earnRow}`);
  earnCell.value = { formula: `B${sumRow}`, result: income.gross } as ExcelJS.CellFormulaValue;
  earnCell.numFmt = MONEY;
  earnCell.font = { bold: true, size: 12 };
  earnCell.fill = fill(GREEN);
  earnCell.border = thin;
  const EARN = `$C$${earnRow}`;
  const FEE_TOTAL = `$D$${sumRow}`;

  // --- Этап 2 ------------------------------------------------------------
  const s2 = earnRow + 2;
  sectionHeader(
    s2,
    `ЭТАП 2. ДОЛЯ 1 — ${formatPercent(params.p1)} с округлением вверх`,
    'Процент от суммы пополнений округляется ВВЕРХ до кратности шага. Добавка понадобится на этапе 4.',
  );
  // Порядок строк: сырой процент, добавка, итог. Добавка ссылается на итог,
  // поэтому адреса считаем заранее.
  const rawRow = s2 + 2;
  const addRow = rawRow + 1;
  const part1Row = rawRow + 2;
  valueRow(rawRow, `${formatPercent(params.p1)} от пополнений`, `ROUND(${EARN}*${P1},2)`, row.raw1 ?? 0);
  valueRow(addRow, 'Добавка от округления вверх', `ROUND(C${part1Row}-C${rawRow},2)`, row.roundUp ?? 0);
  valueRow(part1Row, 'ДОЛЯ 1', `CEILING(${EARN}*${P1},${STEP})`, row.part1 ?? 0, true);

  // --- Этап 3 ------------------------------------------------------------
  const s3 = part1Row + 2;
  sectionHeader(
    s3,
    'ЭТАП 3. НАЛОГ',
    `${formatPercent(params.p2)} от полной суммы пополнений, без округления. Комиссия сюда не входит.`,
  );
  const r31 = s3 + 2;
  valueRow(r31, 'НАЛОГ', `ROUND(${EARN}*${P2},2)`, row.part2 ?? 0, true);

  // --- Этап 4 ------------------------------------------------------------
  const s4 = r31 + 2;
  const rawBase3 =
    params.p3Base === 'n' ? EARN : params.p3Base === 'part1' ? `C${part1Row}` : `${EARN}-C${addRow}`;
  sectionHeader(
    s4,
    'ЭТАП 4. ЗАРАБОТОК',
    `Сумма заработка — можно переводить себе. ${formatPercent(params.p3)} берётся от остатка: ` +
      'из суммы пополнений вычитается добавка округления с этапа 2 и удержанная комиссия. ' +
      'Траты вычитаются уже из полученного заработка целиком.',
  );
  const r41 = s4 + 2;
  valueRow(r41, 'База для процента', `ROUND(${rawBase3}-${FEE_TOTAL},2)`, row.base3 ?? 0);
  const r42 = r41 + 1;
  valueRow(r42, `${formatPercent(params.p3)} от базы`, `ROUND(C${r41}*${P3},2)`, row.part3 ?? 0);

  // Траты: просто список сумм, вычитается целиком из заработка.
  const validExpenses = expenses.lines.filter((l) => l.ok);
  let payoutRow = r42 + 1;
  if (validExpenses.length > 0) {
    const expTitle = r42 + 2;
    ws.getCell(`B${expTitle}`).value = 'Траты';
    ws.getCell(`B${expTitle}`).font = { bold: true };

    const expFirst = expTitle + 1;
    validExpenses.forEach((line, i) => {
      const r = expFirst + i;
      ws.getCell(`A${r}`).value = i + 1;
      ws.getCell(`B${r}`).value = 'Трата';
      const cell = ws.getCell(`C${r}`);
      cell.value = line.gross;
      cell.numFmt = MONEY;
      cell.fill = fill(YELLOW);
      cell.border = thin;
    });

    const expLast = expFirst + validExpenses.length - 1;
    const expSum = expLast + 1;
    valueRow(expSum, 'Итого трат', `SUM(C${expFirst}:C${expLast})`, expenses.total);

    payoutRow = expSum + 1;
    valueRow(payoutRow, 'ЗАРАБОТОК (после трат)', `ROUND(C${r42}-C${expSum},2)`, payout, true);
  } else {
    payoutRow = r42 + 1;
    valueRow(payoutRow, 'ЗАРАБОТОК', `ROUND(C${r42},2)`, payout, true);
  }

  // --- Этап 5 ------------------------------------------------------------
  const s5 = payoutRow + 2;
  sectionHeader(
    s5,
    'ЭТАП 5. РЕЗЮМЕ',
    'Доля 1 показана без округления. ИТОГО — это заработок с этапа 4, сумма к переводу себе.',
  );
  const r51 = s5 + 2;
  valueRow(r51, 'Доля 1 (без округления)', `C${rawRow}`, row.raw1 ?? 0);
  valueRow(r51 + 1, 'Налог', `C${r31}`, row.part2 ?? 0);
  valueRow(r51 + 2, 'Заработок (после трат)', `C${payoutRow}`, payout);
  valueRow(r51 + 3, 'Сумма пополнений', EARN, row.n ?? 0);
  valueRow(r51 + 4, 'ИТОГО', `C${payoutRow}`, payout, true);

  return (await wb.xlsx.writeBuffer()) as ArrayBuffer;
}
