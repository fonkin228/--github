import assert from 'node:assert/strict';
import test from 'node:test';
import ExcelJS from 'exceljs';
import { calcAll, calcExpenses, calcIncome, calcRow, calcStages, normalizeParams } from '../../shared/calc';
import { ceilTo, round2 } from '../../shared/money';
import { parseAmount, parsePercent, splitAmounts } from '../../shared/parse';
import { plural, withPlural } from '../../shared/plural';
import { buildAnalytics } from '../../shared/analytics';
import { buildDatabaseWorkbook, parseDatabaseWorkbook } from '../../shared/database';
import { DEFAULT_PARAMS, newIncomeItem, type HistoryEntry } from '../../shared/types';
import { buildWorkbook } from '../../shared/xlsx';

test('parseAmount: форматы, которые реально встречаются', () => {
  const cases: Array<[string, number]> = [
    ['706945', 706945],
    ['706 945', 706945],
    ['706 945', 706945],       // неразрывный пробел
    ['706 945', 706945],       // узкий неразрывный
    ['706 945,50', 706945.5],
    ['706945.50', 706945.5],
    ['1 234 567,89', 1234567.89],
    ['1.234.567,89', 1234567.89],   // европейский стиль
    ['1,234,567.89', 1234567.89],   // американский стиль
    ['706 945 ₽', 706945],
    ['706945 руб.', 706945],
    ['0', 0],
    ['+706945', 706945],
  ];
  for (const [input, expected] of cases) {
    const parsed = parseAmount(input);
    assert.equal(parsed.ok, true, `не распознано: ${JSON.stringify(input)}`);
    assert.equal(parsed.value, expected, `неверно распознано: ${JSON.stringify(input)}`);
  }
});

test('parseAmount: мусор и отрицательные отсекаются', () => {
  for (const bad of ['', '   ', 'abc', '12abc', '1,2,3.4.5', '--5', '1e5x']) {
    assert.equal(parseAmount(bad).ok, false, `должно было отвалиться: ${JSON.stringify(bad)}`);
  }
  const negative = parseAmount('-100');
  assert.equal(negative.ok, false);
  assert.match((negative as { error: string }).error, /Отрицательная/);
});

test('parsePercent: и 89, и 89%, и 0,89', () => {
  assert.equal((parsePercent('89') as { value: number }).value, 0.89);
  assert.equal((parsePercent('89%') as { value: number }).value, 0.89);
  assert.equal((parsePercent('0,89') as { value: number }).value, 0.89);
  assert.equal(parsePercent('120').ok, false);
});

test('ceilTo: аналог Excel CEILING без артефактов плавающей точки', () => {
  assert.equal(ceilTo(629181.05, 1000), 630000);
  assert.equal(ceilTo(630000, 1000), 630000, 'кратное значение не должно подниматься');
  assert.equal(ceilTo(890000.0000000001, 1000), 890000, 'погрешность double не должна давать +1000');
  assert.equal(ceilTo(0, 1000), 0);
  assert.equal(ceilTo(1, 1000), 1000);
  assert.equal(ceilTo(1234.5, 100), 1300);
  assert.equal(ceilTo(1234.5, 0), 1234.5, 'нулевой шаг = без округления');
});

test('calcRow: контрольный пример N = 706 945, база п.3 = N − округление', () => {
  const row = calcRow('706 945', 1, DEFAULT_PARAMS);
  assert.equal(row.ok, true);
  assert.equal(row.n, 706945);
  assert.equal(row.raw1, 629181.05);       // C = N × 89%
  assert.equal(row.part1, 630000);         // D = CEILING(C; 1000)
  assert.equal(row.roundUp, 818.95);       // E = D − C
  assert.equal(row.part2, 49486.15);       // F = N × 7%
  assert.equal(row.base3, 706126.05);      // N − E
  assert.equal(row.part3, 28245.04);       // G = (N − E) × 4%
  assert.equal(row.total, 707731.19);      // H = D + F + G
  assert.equal(row.diff, 786.19);          // I = H − N
  assert.equal(row.refP3OfN, 28277.8);     // J = N × 4%
});

test('calcRow: без добавки округления итог сходится ровно в N', () => {
  const row = calcRow(1000000, 1, DEFAULT_PARAMS);
  assert.equal(row.part1, 890000);
  assert.equal(row.roundUp, 0);
  assert.equal(row.part2, 70000);
  assert.equal(row.base3, 1000000, 'без добавки база п.3 равна самой N');
  assert.equal(row.part3, 40000);
  assert.equal(row.total, 1000000);
  assert.equal(row.diff, 0, '89 + 7 + 4 = 100%, расхождения быть не должно');
});

test('calcRow: три базы для п.3 дают три разных результата', () => {
  const n = 706945;
  const byDefault = calcRow(n, 1, normalizeParams({ p3Base: 'nMinusRoundUp' }));
  const byN = calcRow(n, 1, normalizeParams({ p3Base: 'n' }));
  const byPart1 = calcRow(n, 1, normalizeParams({ p3Base: 'part1' }));

  assert.equal(byDefault.part3, 28245.04, '(N − 818,95) × 4%');
  assert.equal(byN.part3, 28277.8, 'N × 4%');
  assert.equal(byPart1.part3, 25200, 'п.1 × 4% — так считала первая версия таблицы');

  assert.equal(byDefault.total, 707731.19);
  assert.equal(byN.total, 707763.95);
  assert.equal(byPart1.total, 704686.15);
});

test('calcRow: параметры влияют на результат', () => {
  const custom = normalizeParams({ p1: 0.9, p2: 0.05, p3: 0.05, step: 500 });
  const row = calcRow(100000, 1, custom);
  assert.equal(row.part1, 90000);
  assert.equal(row.roundUp, 0);
  assert.equal(row.part2, 5000);
  assert.equal(row.part3, 5000);
  assert.equal(row.total, 100000);
});

test('normalizeParams: мусор заменяется дефолтами', () => {
  const p = normalizeParams({ p1: 5, p2: -1, p3: Number.NaN, step: 0, commissionRate: 9, p3Base: 'ерунда' } as never);
  assert.deepEqual(p, DEFAULT_PARAMS);
  assert.equal(DEFAULT_PARAMS.p3Base, 'nMinusRoundUp', 'по умолчанию — от N минус округление');
});

test('calcAll: пакетный расчёт и свод', () => {
  const result = calcAll(['706 945', '1000000', 'мусор', ''], DEFAULT_PARAMS);
  assert.equal(result.rows.length, 4);
  assert.equal(result.totals.count, 2);
  assert.equal(result.totals.invalid, 2);
  assert.equal(result.totals.n, 1706945);
  assert.equal(result.totals.part1, 1520000);
  assert.equal(result.totals.part3, round2(28245.04 + 40000));
  assert.equal(result.totals.total, round2(707731.19 + 1000000));
  assert.equal(result.rows[2].ok, false);
  assert.match(result.rows[2].error!, /Не распознано/);
});

test('splitAmounts: многострочный ввод', () => {
  assert.deepEqual(splitAmounts('706 945\n1 000 000;250000\t300000\n\n'), [
    '706 945',
    '1 000 000',
    '250000',
    '300000',
  ]);
});

test('plural: русские числительные', () => {
  const forms: [string, string, string] = ['строка', 'строки', 'строк'];
  const expected: Array<[number, string]> = [
    [1, 'строка'], [2, 'строки'], [4, 'строки'], [5, 'строк'],
    [11, 'строк'], [12, 'строк'], [14, 'строк'], [21, 'строка'],
    [22, 'строки'], [25, 'строк'], [101, 'строка'], [111, 'строк'], [0, 'строк'],
  ];
  for (const [n, form] of expected) assert.equal(plural(n, forms), form, `n=${n}`);
  assert.equal(withPlural(3, forms), '3 строки');
});

test('buildWorkbook: файл открывается, формулы и значения на месте', async () => {
  const result = calcAll(['706 945', '1000000'], DEFAULT_PARAMS);
  const buffer = await buildWorkbook(result);
  assert.ok(buffer.byteLength > 5000, 'файл подозрительно маленький');

  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.getWorksheet('Расчёт');
  assert.ok(ws, 'нет листа «Расчёт»');

  assert.equal(ws!.getCell('B5').value, 0.89);
  assert.equal(ws!.getCell('B8').value, 1000);
  assert.equal(ws!.getCell('B12').value, 706945);

  const d12 = ws!.getCell('D12').value as ExcelJS.CellFormulaValue;
  assert.match(d12.formula, /CEILING\(\$L12\*\$B\$5,\$B\$8\)/);
  assert.equal(d12.result, 630000);

  const g12 = ws!.getCell('G12').value as ExcelJS.CellFormulaValue;
  assert.match(g12.formula, /\(\$L12-E12\)\*\$B\$7/, 'база п.3 — N минус добавка округления');
  assert.equal(g12.result, 28245.04);

  const h12 = ws!.getCell('H12').value as ExcelJS.CellFormulaValue;
  assert.equal(h12.result, 707731.19);

  const l12 = ws!.getCell('L12').value as ExcelJS.CellFormulaValue;
  assert.match(l12.formula, /SUBSTITUTE/);
  assert.equal(ws!.getColumn('L').hidden, true);
});

// --- Этап 1: пополнения ---------------------------------------------------

test('calcIncome: складывает пополнения, комиссию считает отдельно', () => {
  const income = calcIncome(
    [newIncomeItem('a', '100 000', true), newIncomeItem('b', '50000', false)],
    DEFAULT_PARAMS,
  );
  assert.equal(income.gross, 150000, 'база для доли 1 и налога — вся сумма пополнений');
  assert.equal(income.commission, 1000, '1% со ста тысяч');
  assert.equal(income.net, 149000, 'справочно: пополнения минус комиссия');
  assert.equal(income.validCount, 2);
  assert.equal(income.invalidCount, 0);

  assert.equal(income.lines[0].commission, 1000);
  assert.equal(income.lines[0].net, 99000);
  assert.equal(income.lines[1].commission, 0);
});

test('calcIncome: пустая строка — не ошибка, мусор — ошибка', () => {
  const income = calcIncome(
    [newIncomeItem('a', '1000'), newIncomeItem('b', '   '), newIncomeItem('c', 'абв')],
    DEFAULT_PARAMS,
  );
  assert.equal(income.gross, 1000);
  assert.equal(income.validCount, 1);
  assert.equal(income.invalidCount, 1, 'считаем ошибкой только непустой мусор');
  assert.equal(income.lines[1].error, null, 'пустую строку не подсвечиваем');
  assert.match(income.lines[2].error!, /Не распознано/);
});

test('calcIncome: ставка комиссии настраивается', () => {
  const income = calcIncome([newIncomeItem('a', '100000', true)], { commissionRate: 0.025 });
  assert.equal(income.commission, 2500);
  assert.equal(income.gross, 100000, 'ставка не трогает сумму пополнений');

  const zero = calcIncome([newIncomeItem('a', '100000', true)], { commissionRate: 0 });
  assert.equal(zero.commission, 0);
});

test('calcStages: комиссия влияет только на «Заработок»', () => {
  const items = [newIncomeItem('a', '100 000', true), newIncomeItem('b', '50000')];
  const { income, row } = calcStages(items, [], DEFAULT_PARAMS);

  assert.equal(income.gross, 150000);
  assert.equal(income.commission, 1000);

  assert.equal(row.n, 150000, 'доля 1 и налог считаются от полной суммы пополнений');
  assert.equal(row.raw1, 133500);
  assert.equal(row.part1, 134000);
  assert.equal(row.roundUp, 500);
  assert.equal(row.part2, 10500, 'налог — 7% от 150 000, комиссия его не трогает');
  assert.equal(row.base3, 148500, '150 000 − 500 округления − 1 000 комиссии');
  assert.equal(row.part3, 5940);
  assert.equal(row.total, 150440);
});

test('calcStages: без галочек комиссии расчёт не меняется', () => {
  const withFee = calcStages([newIncomeItem('a', '150000', true)], [], DEFAULT_PARAMS);
  const without = calcStages([newIncomeItem('a', '150000', false)], [], DEFAULT_PARAMS);

  assert.equal(withFee.row.part1, without.row.part1, 'доля 1 одинаковая');
  assert.equal(withFee.row.part2, without.row.part2, 'налог одинаковый');
  assert.notEqual(withFee.row.part3, without.row.part3, 'а заработок отличается');
  assert.equal(without.row.base3, 149500);
  assert.equal(withFee.row.base3, 148000, 'минус 1 500 комиссии');
});

// --- Траты на этапе 4 ------------------------------------------------------

test('calcExpenses: складывает суммы, комиссию не применяет', () => {
  const e = calcExpenses([newIncomeItem('a', '1 500'), newIncomeItem('b', '440,40', true)]);
  assert.equal(e.total, 1940.4, 'галочка комиссии на тратах игнорируется');
  assert.equal(e.validCount, 2);
  assert.equal(e.invalidCount, 0);
});

test('calcStages: траты вычитаются целиком и только из заработка', () => {
  const items = [newIncomeItem('a', '100 000', true), newIncomeItem('b', '50000')];
  const withoutExpenses = calcStages(items, [], DEFAULT_PARAMS);
  const withExpenses = calcStages(items, [newIncomeItem('e', '1 000')], DEFAULT_PARAMS);

  assert.equal(withExpenses.row.part1, withoutExpenses.row.part1, 'доля 1 не меняется');
  assert.equal(withExpenses.row.part2, withoutExpenses.row.part2, 'налог не меняется');
  assert.equal(withExpenses.row.base3, withoutExpenses.row.base3, 'база процента не меняется');
  assert.equal(withExpenses.row.part3, 5940, 'сам процент тоже не меняется');

  assert.equal(withoutExpenses.payout, 5940);
  assert.equal(withExpenses.expenses.total, 1000);
  assert.equal(withExpenses.payout, 4940, 'из заработка вычитается вся трата, а не её процент');
});

test('calcStages: траты могут увести заработок в минус', () => {
  const r = calcStages([newIncomeItem('a', '150000')], [newIncomeItem('e', '10000')], DEFAULT_PARAMS);
  assert.equal(r.row.part3, 5980);
  assert.equal(r.payout, -4020, 'отрицательный итог показываем как есть');
});

// --- Аналитика по периодам -------------------------------------------------

const entry = (
  id: number,
  createdAt: string,
  income: Array<[string, boolean, string]>,
  expenses: string[] = [],
): HistoryEntry => {
  const items = income.map(([amount, commission, date], i) => newIncomeItem(`i${id}-${i}`, amount, commission, date));
  const exp = expenses.map((amount, i) => newIncomeItem(`e${id}-${i}`, amount));
  const stages = calcStages(items, exp, DEFAULT_PARAMS);
  return {
    id,
    createdAt,
    title: `test ${id}`,
    params: DEFAULT_PARAMS,
    mode: 'stages',
    inputs: [String(stages.income.gross)],
    income: items,
    expenses: exp,
    totals: {
      count: 1,
      invalid: 0,
      n: stages.income.gross,
      part1: stages.row.part1 ?? 0,
      part2: stages.row.part2 ?? 0,
      part3: stages.row.part3 ?? 0,
      total: stages.row.total ?? 0,
      diff: stages.row.diff ?? 0,
      roundUp: stages.row.roundUp ?? 0,
    },
  };
};

test('buildAnalytics: группировка по месяцам', () => {
  const entries = [
    entry(1, '2026-07-15T10:00:00.000Z', [['100000', false, '2026-07-15']]),
    entry(2, '2026-08-10T10:00:00.000Z', [['200000', false, '2026-08-10']]),
  ];
  const { periods, totals } = buildAnalytics(entries, 'month');

  assert.equal(periods.length, 2);
  assert.equal(periods[0].key, '2026-08', 'новые периоды идут первыми');
  assert.equal(periods[1].key, '2026-07');

  assert.deepEqual(
    { d: periods[0].deposits, t: periods[0].tax, p: periods[0].payout, r: periods[0].remainder },
    { d: 200000, t: 14000, p: 8000, r: 178000 },
  );
  assert.deepEqual(
    { d: periods[1].deposits, t: periods[1].tax, p: periods[1].payout, r: periods[1].remainder },
    { d: 100000, t: 7000, p: 4000, r: 89000 },
  );

  assert.equal(totals.deposits, 300000);
  assert.equal(totals.tax, 21000);
  assert.equal(totals.payout, 12000);
  assert.equal(totals.remainder, 267000, 'остаток = пополнения − налог − заработок');
});

test('buildAnalytics: один расчёт разносится по неделям пропорционально суммам', () => {
  // 100 000 (с комиссией) 17 августа и 50 000 — 24 августа: разные недели
  const entries = [entry(1, '2026-08-24T10:00:00.000Z', [['100000', true, '2026-08-17'], ['50000', false, '2026-08-24']])];
  const { periods, totals } = buildAnalytics(entries, 'week');

  assert.equal(periods.length, 2, 'две недели');
  const [late, early] = periods;

  assert.equal(early.deposits, 100000);
  assert.equal(late.deposits, 50000);
  // налог всего расчёта 10 500, заработок 5 940 — делятся 2:1
  assert.equal(early.tax, 7000);
  assert.equal(late.tax, 3500);
  assert.equal(early.payout, 3960);
  assert.equal(late.payout, 1980);

  assert.equal(totals.deposits, 150000);
  assert.equal(totals.tax, 10500, 'сумма долей совпадает с налогом расчёта');
  assert.equal(totals.payout, 5940);
  assert.equal(totals.count, 2, 'считаем именно пополнения');
});

test('buildAnalytics: без дат строки падают в день сохранения', () => {
  const e = entry(1, '2026-08-19T10:00:00.000Z', [['100000', false, '']]);
  const { periods } = buildAnalytics([e], 'month');
  assert.equal(periods[0].key, '2026-08');
  assert.equal(periods[0].deposits, 100000);
});

// --- База в Excel: выгрузка и загрузка обратно -----------------------------

test('база: круговой рейс — выгрузили, прочитали, всё на месте', async () => {
  const source = [
    entry(1, '2026-08-24T10:00:00.000Z', [['100000', true, '2026-08-17'], ['50000', false, '2026-08-24']], ['1000']),
    entry(2, '2026-07-15T10:00:00.000Z', [['200000', false, '2026-07-15']]),
  ];

  const buffer = await buildDatabaseWorkbook(source);
  const { entries, skipped } = await parseDatabaseWorkbook(buffer, DEFAULT_PARAMS);

  assert.equal(skipped.length, 0, 'ничего не потерялось');
  assert.equal(entries.length, 2);

  const [first, second] = entries;
  assert.equal(first.income!.length, 2);
  assert.equal(first.income![0].amount, '100000');
  assert.equal(first.income![0].commission, true, 'галочка комиссии пережила рейс');
  assert.equal(first.income![0].date, '2026-08-17', 'дата пережила рейс');
  assert.equal(first.income![1].commission, false);
  assert.equal(first.expenses!.length, 1);
  assert.equal(first.expenses![0].amount, '1000');

  assert.equal(first.totals.n, source[0].totals.n);
  assert.equal(first.totals.part2, source[0].totals.part2);
  assert.equal(first.totals.part3, source[0].totals.part3);
  assert.equal(second.totals.n, 200000);
});

test('база: параметры расчёта сохраняются в файле', async () => {
  const custom = normalizeParams({ p1: 0.9, p2: 0.05, p3: 0.05, step: 500, commissionRate: 0.02, p3Base: 'n' });
  const source: HistoryEntry[] = [
    { ...entry(1, '2026-08-19T10:00:00.000Z', [['100000', true, '2026-08-19']]), params: custom },
  ];

  const { entries } = await parseDatabaseWorkbook(await buildDatabaseWorkbook(source), DEFAULT_PARAMS);
  assert.deepEqual(entries[0].params, custom, 'параметры прочитались обратно без потерь');
});

test('база: битые строки пропускаются с объяснением', async () => {
  const buffer = await buildDatabaseWorkbook([entry(1, '2026-08-19T10:00:00.000Z', [['100000', false, '2026-08-19']])]);
  const wb = new ExcelJS.Workbook();
  await wb.xlsx.load(Buffer.from(buffer) as unknown as Parameters<typeof wb.xlsx.load>[0]);
  const ws = wb.getWorksheet('База')!;
  ws.getCell('A6').value = 1;
  ws.getCell('C6').value = 'пополнение';
  ws.getCell('D6').value = 'абракадабра';
  const broken = (await wb.xlsx.writeBuffer()) as ArrayBuffer;

  const { entries, skipped } = await parseDatabaseWorkbook(broken, DEFAULT_PARAMS);
  assert.equal(entries.length, 1, 'нормальные строки не пострадали');
  assert.equal(skipped.length, 1);
  assert.equal(skipped[0].row, 6);
  assert.match(skipped[0].reason, /не распознана/);
});
