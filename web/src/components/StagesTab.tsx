import { formatMoney, formatPercent } from '@shared/money';
import type { CalcRow, ExpenseResult, IncomeItem, IncomeResult, Params } from '@shared/types';
import { IncomeEditor } from './IncomeEditor';
import { Stage, StageLine } from './Stage';

/** Основной экран: один расчёт, разложенный на пять понятных этапов. */
export function StagesTab({
  items,
  income,
  expenseItems,
  expenses,
  row,
  payout,
  params,
  onChange,
  onExpensesChange,
}: {
  items: IncomeItem[];
  income: IncomeResult;
  expenseItems: IncomeItem[];
  expenses: ExpenseResult;
  row: CalcRow;
  payout: number;
  params: Params;
  onChange(items: IncomeItem[]): void;
  onExpensesChange(items: IncomeItem[]): void;
}) {
  const ready = income.validCount > 0 && row.ok;
  const stepLabel = formatMoney(params.step, 0);
  const hasFee = income.commission > 0;

  return (
    <div className="tab">
      <Stage
        n={1}
        title="Пополнения"
        hint={
          `Сложите все пополнения. Кнопка «+» добавляет строку. ` +
          `Галочка отмечает пополнения, с которых удержана комиссия ${formatPercent(params.commissionRate)} — ` +
          `она уменьшит только «Заработок» на этапе 4, а на долю 1 и налог не повлияет.`
        }
        resultLabel="Сумма пополнений"
        resultValue={income.gross}
      >
        <IncomeEditor items={items} lines={income.lines} params={params} onChange={onChange} />

        {hasFee ? (
          <div className="stage__sum">
            <StageLine
              label="Удержано комиссией"
              value={income.commission}
              sign="-"
              note="вычтется на этапе 4"
            />
          </div>
        ) : null}

        {income.invalidCount > 0 ? (
          <div className="stage__warn">Строк не распознано: {income.invalidCount}</div>
        ) : null}
      </Stage>

      {!ready ? (
        <p className="empty">Введите хотя бы одно пополнение — этапы ниже посчитаются сами.</p>
      ) : (
        <>
          <Stage
            n={2}
            title={`Доля 1 — ${formatPercent(params.p1)} с округлением вверх`}
            hint={
              `Берём ${formatPercent(params.p1)} от суммы пополнений и округляем ВВЕРХ до ближайшей ` +
              `кратности ${stepLabel}. Добавка от округления понадобится на этапе 4.`
            }
            resultLabel="Доля 1"
            resultValue={row.part1}
          >
            <StageLine label={`${formatPercent(params.p1)} от пополнений`} value={row.raw1} />
            <StageLine
              label={`Округление вверх до ${stepLabel}`}
              value={row.roundUp}
              sign="+"
              note={row.roundUp === 0 ? 'уже кратно, добавлять нечего' : undefined}
            />
          </Stage>

          <Stage
            n={3}
            title="Налог"
            hint={`${formatPercent(params.p2)} от полной суммы пополнений, без округления. Комиссия сюда не входит.`}
            resultLabel="Налог"
            resultValue={row.part2}
          />

          <Stage
            n={4}
            title="Заработок"
            hint={
              `Сумма заработка — можно переводить себе. ` +
              `${formatPercent(params.p3)} берётся не от всей суммы пополнений, а от остатка: ` +
              `из неё вычитается добавка округления с этапа 2` +
              (hasFee ? ' и удержанная комиссия.' : '.')
            }
            resultLabel={expenses.total > 0 ? 'Заработок после трат' : 'Заработок'}
            resultValue={payout}
          >
            <StageLine label="Пополнения" value={row.n} />
            <StageLine label="Добавка округления" value={row.roundUp} sign="-" />
            {hasFee ? <StageLine label="Комиссия" value={row.commission} sign="-" /> : null}
            <div className="stage__sum">
              <StageLine label="База для процента" value={row.base3} />
              <StageLine label={`${formatPercent(params.p3)} от базы`} value={row.part3} />
            </div>

            <div className="stage__block">
              <div className="stage__blockTitle">
                Траты<span className="field__note">вычитаются из заработка целиком</span>
              </div>
              <IncomeEditor
                items={expenseItems}
                lines={expenses.lines}
                params={params}
                onChange={onExpensesChange}
                withCommission={false}
                withDate={false}
                addLabel="+ Добавить трату"
                placeholder="Например, 1 500"
              />
              {expenses.total > 0 ? (
                <div className="stage__sum">
                  <StageLine label="Итого трат" value={expenses.total} sign="-" />
                </div>
              ) : null}
              {expenses.invalidCount > 0 ? (
                <div className="stage__warn">Трат не распознано: {expenses.invalidCount}</div>
              ) : null}
            </div>
          </Stage>

          <Stage
            n={5}
            title="Резюме"
            hint="Доля 1 показана без округления. Итого внизу — это заработок с этапа 4, та сумма, которую можно переводить себе."
            resultLabel="Итого"
            resultValue={payout}
          >
            <StageLine label="Доля 1" value={row.raw1} note="без округления" />
            <StageLine label="Налог" value={row.part2} />
            <StageLine label="Заработок" value={payout} note={expenses.total > 0 ? 'после трат' : undefined} />
            <div className="stage__sum">
              <StageLine label="Сумма пополнений" value={row.n} />
            </div>
          </Stage>
        </>
      )}
    </div>
  );
}
