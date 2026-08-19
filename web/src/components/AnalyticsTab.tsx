import { useMemo, useState } from 'react';
import { buildAnalytics, type Granularity, type PeriodStat } from '@shared/analytics';
import { formatMoney } from '@shared/money';
import { DEPOSITS, PERIODS, withPlural } from '@shared/plural';
import type { HistoryEntry } from '@shared/types';

const TITLES: Record<Granularity, string> = { week: 'Недели', month: 'Месяцы' };

/** Сводка по сохранённым расчётам, сгруппированная по неделям или месяцам. */
export function AnalyticsTab({ entries, loading }: { entries: HistoryEntry[]; loading: boolean }) {
  const [granularity, setGranularity] = useState<Granularity>('week');
  const { periods, totals } = useMemo(() => buildAnalytics(entries, granularity), [entries, granularity]);

  if (loading) {
    return (
      <div className="tab">
        <p className="hint">Загружаю…</p>
      </div>
    );
  }

  return (
    <div className="tab">
      <div className="segmented">
        {(['week', 'month'] as Granularity[]).map((g) => (
          <button
            key={g}
            type="button"
            className={granularity === g ? 'is-active' : ''}
            onClick={() => setGranularity(g)}
          >
            {TITLES[g]}
          </button>
        ))}
      </div>

      {periods.length === 0 ? (
        <p className="empty">
          Пока нечего показывать. Посчитайте пополнения и нажмите «Сохранить в историю» — расчёт попадёт сюда.
        </p>
      ) : (
        <>
          <PeriodCard
            title="За всё время"
            subtitle={withPlural(periods.length, PERIODS)}
            stat={totals}
            highlight
          />
          {periods.map((p) => (
            <PeriodCard key={p.key} title={p.label} subtitle={withPlural(p.count, DEPOSITS)} stat={p} />
          ))}
        </>
      )}

      <p className="hint">
        Даты берутся с самих пополнений. Если в одном расчёте пополнения разных дат, налог и заработок
        распределяются между ними пропорционально суммам.
      </p>
    </div>
  );
}

function PeriodCard({
  title,
  subtitle,
  stat,
  highlight,
}: {
  title: string;
  subtitle: string;
  stat: Pick<PeriodStat, 'deposits' | 'tax' | 'payout' | 'remainder'>;
  highlight?: boolean;
}) {
  return (
    <div className={`card ${highlight ? 'card--totals' : ''}`}>
      <div className="card__head">
        <span className="card__title">{title}</span>
        <span className="period__count">{subtitle}</span>
      </div>
      <div className="line">
        <span className="line__label">Пополнения</span>
        <span className="line__value">{formatMoney(stat.deposits)}</span>
      </div>
      <div className="line">
        <span className="line__label">Налог</span>
        <span className="line__value">{formatMoney(stat.tax)}</span>
      </div>
      <div className="line">
        <span className="line__label">Заработок</span>
        <span className="line__value">{formatMoney(stat.payout)}</span>
      </div>
      <div className="card__divider" />
      <div className="line">
        <span className="line__label">
          Остаток<span className="line__note">пополнения − налог − заработок</span>
        </span>
        <span className="line__value is-strong">{formatMoney(stat.remainder)}</span>
      </div>
    </div>
  );
}
