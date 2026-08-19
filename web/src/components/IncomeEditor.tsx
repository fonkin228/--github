import { formatPercent } from '@shared/money';
import { newIncomeItem, type IncomeItem, type IncomeLine, type Params } from '@shared/types';

let seq = 0;

const pad = (n: number): string => String(n).padStart(2, '0');
/** Сегодняшняя дата в формате, который понимает <input type="date">. */
export const today = (): string => {
  const d = new Date();
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};

export const makeIncomeItem = (amount = '', commission = false, date = today()): IncomeItem =>
  newIncomeItem(`i${Date.now().toString(36)}-${seq++}`, amount, commission, date);

/**
 * Список сумм со строками, которые добавляются кнопкой «+».
 * Используется дважды: пополнения на этапе 1 (с галочкой комиссии) и траты на этапе 4 (без неё).
 */
export function IncomeEditor({
  items,
  lines,
  params,
  onChange,
  withCommission = true,
  withDate = true,
  addLabel = '+ Добавить пополнение',
  placeholder = 'Например, 706 945',
}: {
  items: IncomeItem[];
  lines: IncomeLine[];
  params: Params;
  onChange(items: IncomeItem[]): void;
  withCommission?: boolean;
  withDate?: boolean;
  addLabel?: string;
  placeholder?: string;
}) {
  const patch = (id: string, next: Partial<IncomeItem>): void =>
    onChange(items.map((item) => (item.id === id ? { ...item, ...next } : item)));

  const add = (): void => onChange([...items, makeIncomeItem()]);

  const remove = (id: string): void => {
    const rest = items.filter((item) => item.id !== id);
    onChange(rest.length > 0 ? rest : [makeIncomeItem()]);
  };

  const feeLabel = `−${formatPercent(params.commissionRate)}`;

  return (
    <div className="income">
      {items.map((item, i) => {
        const line = lines[i];
        return (
          <div key={item.id} className="income__row">
            <div className="income__main">
              <input
                className={line?.error ? 'is-error' : ''}
                type="text"
                inputMode="decimal"
                value={item.amount}
                placeholder={i === 0 ? placeholder : 'Ещё сумма'}
                onChange={(e) => patch(item.id, { amount: e.target.value })}
              />
              {withCommission ? (
                <label className={`checkbox ${item.commission ? 'is-on' : ''}`} title="Удержана комиссия">
                  <input
                    type="checkbox"
                    checked={item.commission}
                    onChange={(e) => patch(item.id, { commission: e.target.checked })}
                  />
                  <span>{feeLabel}</span>
                </label>
              ) : null}
              <button
                type="button"
                className="income__remove"
                onClick={() => remove(item.id)}
                aria-label="Убрать строку"
                disabled={items.length === 1 && !item.amount}
              >
                ✕
              </button>
            </div>
            {withDate || (withCommission && line?.ok && line.hasCommission) ? (
              <div className="income__meta">
                {withDate ? (
                  <input
                    className="income__date"
                    type="date"
                    value={item.date ?? ''}
                    onChange={(e) => patch(item.id, { date: e.target.value })}
                    title="Дата пополнения"
                  />
                ) : null}
                {withCommission && line?.ok && line.hasCommission ? (
                  <span className="income__fee">
                    комиссия{' '}
                    {line.commission!.toLocaleString('ru-RU', {
                      minimumFractionDigits: 2,
                      maximumFractionDigits: 2,
                    })}
                  </span>
                ) : null}
              </div>
            ) : null}
            {line?.error ? <div className="income__error">{line.error}</div> : null}
          </div>
        );
      })}

      <button type="button" className="income__add" onClick={add}>
        {addLabel}
      </button>
    </div>
  );
}
