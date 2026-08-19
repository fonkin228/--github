import { formatMoney, formatPercent } from '@shared/money';
import { ROWS, withPlural } from '@shared/plural';
import { p3BaseLabel, type CalcRow, type CalcTotals, type Params } from '@shared/types';

interface RowProps {
  row: CalcRow;
  params: Params;
}

export function ResultCard({ row, params }: RowProps) {
  if (!row.ok) {
    return (
      <div className="card card--error">
        <div className="card__head">
          <span className="card__index">{row.index}</span>
          <span className="card__title card__title--error">{row.input || '(пусто)'}</span>
        </div>
        <div className="card__error">{row.error}</div>
      </div>
    );
  }

  const diffPositive = (row.diff ?? 0) >= 0;

  return (
    <div className="card">
      <div className="card__head">
        <span className="card__index">{row.index}</span>
        <span className="card__title">{formatMoney(row.n)}</span>
      </div>

      <Line
        label={`п.1 · ${formatPercent(params.p1)} ↑${formatMoney(params.step, 0)}`}
        value={row.part1}
        strong
        note={row.roundUp ? `+${formatMoney(row.roundUp)} округление` : 'без добавки'}
      />
      <Line label={`п.2 · ${formatPercent(params.p2)} от N`} value={row.part2} />
      <Line
        label={`п.3 · ${formatPercent(params.p3)} от ${p3BaseLabel(params.p3Base)}`}
        value={row.part3}
        note={params.p3Base === 'nMinusRoundUp' && row.roundUp ? `база ${formatMoney(row.base3)}` : undefined}
      />

      <div className="card__divider" />
      <Line label="Итого" value={row.total} strong />
      <div className={`card__diff ${diffPositive ? 'is-plus' : 'is-minus'}`}>
        Δ к исходной сумме: {diffPositive ? '+' : ''}
        {formatMoney(row.diff)}
      </div>
    </div>
  );
}

function Line({
  label,
  value,
  strong,
  note,
}: {
  label: string;
  value: number | null;
  strong?: boolean;
  note?: string;
}) {
  return (
    <div className="line">
      <span className="line__label">
        {label}
        {note ? <span className="line__note">{note}</span> : null}
      </span>
      <span className={`line__value ${strong ? 'is-strong' : ''}`}>{formatMoney(value)}</span>
    </div>
  );
}

export function TotalsCard({ totals, params }: { totals: CalcTotals; params: Params }) {
  return (
    <div className="card card--totals">
      <div className="card__head">
        <span className="card__title">Свод · {withPlural(totals.count, ROWS)}</span>
      </div>
      <div className="line">
        <span className="line__label">Сумма N</span>
        <span className="line__value">{formatMoney(totals.n)}</span>
      </div>
      <div className="line">
        <span className="line__label">п.1 · {formatPercent(params.p1)}</span>
        <span className="line__value">{formatMoney(totals.part1)}</span>
      </div>
      <div className="line">
        <span className="line__label">п.2 · {formatPercent(params.p2)}</span>
        <span className="line__value">{formatMoney(totals.part2)}</span>
      </div>
      <div className="line">
        <span className="line__label">п.3 · {formatPercent(params.p3)}</span>
        <span className="line__value">{formatMoney(totals.part3)}</span>
      </div>
      <div className="card__divider" />
      <div className="line">
        <span className="line__label">Итого</span>
        <span className="line__value is-strong">{formatMoney(totals.total)}</span>
      </div>
      <div className="line">
        <span className="line__label">Добавлено округлением</span>
        <span className="line__value">{formatMoney(totals.roundUp)}</span>
      </div>
      {totals.invalid > 0 ? <div className="card__error">Не распознано строк: {totals.invalid}</div> : null}
    </div>
  );
}
