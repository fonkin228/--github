import type { ReactNode } from 'react';
import { formatMoney } from '@shared/money';

/** Карточка одного этапа: номер, заголовок, объяснение, содержимое и главный результат. */
export function Stage({
  n,
  title,
  hint,
  children,
  resultLabel,
  resultValue,
  footer,
  muted,
}: {
  n: number;
  title: string;
  hint: string;
  children?: ReactNode;
  resultLabel?: string;
  resultValue?: number | null;
  /** Рендерится после главного результата — например, сноска про расхождение. */
  footer?: ReactNode;
  muted?: boolean;
}) {
  return (
    <section className={`stage ${muted ? 'is-muted' : ''}`}>
      <header className="stage__head">
        <span className="stage__num">{n}</span>
        <h2 className="stage__title">{title}</h2>
      </header>
      <p className="stage__hint">{hint}</p>
      {children ? <div className="stage__body">{children}</div> : null}
      {resultLabel ? (
        <div className="stage__result">
          <span>{resultLabel}</span>
          <strong>{formatMoney(resultValue)}</strong>
        </div>
      ) : null}
      {footer}
    </section>
  );
}

/** Промежуточная строка внутри этапа: «откуда взялось — сколько». */
export function StageLine({
  label,
  value,
  note,
  sign,
}: {
  label: string;
  value: number | null;
  note?: string;
  sign?: '+' | '-';
}) {
  const formatted = formatMoney(value);
  return (
    <div className="line">
      <span className="line__label">
        {label}
        {note ? <span className="line__note">{note}</span> : null}
      </span>
      <span className={`line__value ${sign === '-' ? 'is-minus' : ''}`}>
        {sign && value ? (sign === '-' ? '−' : '+') : ''}
        {formatted}
      </span>
    </div>
  );
}
