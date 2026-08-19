import { IS_STANDALONE } from '../api';
import { calcStages } from '@shared/calc';
import { formatMoney, formatPercent } from '@shared/money';
import type { HistoryEntry } from '@shared/types';

interface Props {
  items: HistoryEntry[];
  loading: boolean;
  busy: boolean;
  /** true = файл уходит документом в чат, а не скачивается */
  sendsToChat: boolean;
  onOpen(entry: HistoryEntry): void;
  onDelete(id: number): void;
  onClear(): void;
  onExport(): void;
  onImport(file: File): void;
}

/** Заработок после трат — то же число, что показывает «Резюме». */
const payoutOf = (entry: HistoryEntry): number =>
  entry.mode === 'stages' && entry.income?.length
    ? calcStages(entry.income, entry.expenses ?? [], entry.params).payout
    : entry.totals.part3;

const formatDate = (iso: string): string =>
  new Date(iso).toLocaleString('ru-RU', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' });

export function HistoryTab({ items, loading, busy, sendsToChat, onOpen, onDelete, onClear, onExport, onImport }: Props) {
  if (loading) return <div className="tab"><p className="hint">Загружаю…</p></div>;

  const database = (
    <DatabaseBlock
      busy={busy}
      empty={items.length === 0}
      sendsToChat={sendsToChat}
      onExport={onExport}
      onImport={onImport}
    />
  );

  if (items.length === 0) {
    return (
      <div className="tab">
        <p className="hint">
          История пуста. Посчитайте пополнения и нажмите «Сохранить в историю» — или загрузите готовую базу из файла.
        </p>
        {database}
      </div>
    );
  }

  return (
    <div className="tab">
      <p className="hint">Нажмите на расчёт, чтобы вернуть его в калькулятор. Храним последние 100.</p>
      {items.map((entry) => (
        <div key={entry.id} className="history">
          <button className="history__main" onClick={() => onOpen(entry)}>
            <div className="history__top">
              <span className="history__title">{entry.title}</span>
              <span className="history__date">{formatDate(entry.createdAt)}</span>
            </div>
            <div className="history__meta">
              {formatPercent(entry.params.p1)} / {formatPercent(entry.params.p2)} / {formatPercent(entry.params.p3)}
              {' · шаг '}
              {formatMoney(entry.params.step, 0)}
            </div>
            <div className="history__totals">
              пополнения {formatMoney(entry.totals.n)} → заработок {formatMoney(payoutOf(entry))}
            </div>
          </button>
          <button className="history__delete" onClick={() => onDelete(entry.id)} aria-label="Удалить">
            ✕
          </button>
        </div>
      ))}
      {database}

      <button className="btn btn--danger" onClick={onClear} disabled={busy}>
        Очистить историю
      </button>
    </div>
  );
}

/** Выгрузка всей истории в xlsx и загрузка отредактированного файла обратно. */
function DatabaseBlock({
  busy,
  empty,
  sendsToChat,
  onExport,
  onImport,
}: {
  busy: boolean;
  empty: boolean;
  sendsToChat: boolean;
  onExport(): void;
  onImport(file: File): void;
}) {
  const inputId = 'database-file';
  return (
    <div className="database">
      <div className="database__title">База в Excel</div>
      <p className="hint">
        Вся история одним файлом: строка — пополнение или трата. Файл можно править в Excel и загружать обратно —
        история заменится содержимым файла.
      </p>
      {sendsToChat ? (
        <p className="database__note">
          С телефона файл приходит документом в чат с ботом — скачивание внутри Telegram не работает. Оттуда его
          можно открыть в Excel, поправить и прислать боту обратно.
        </p>
      ) : null}
      {IS_STANDALONE ? (
        <p className="database__note">
          Автономный режим: эта база живёт только в этом браузере. Бот её не видит и по команде <b>/baza</b> не
          пришлёт. Чтобы база стала общей, открывайте приложение с адреса сервера.
        </p>
      ) : null}
      <div className="actions">
        <button className="btn btn--wide" onClick={onExport} disabled={busy || empty}>
          {sendsToChat ? 'Прислать базу в чат' : 'Выгрузить базу в xlsx'}
        </button>
        <label className={`btn btn--wide btn--file ${busy ? 'is-disabled' : ''}`} htmlFor={inputId}>
          Загрузить базу из файла
        </label>
        <input
          id={inputId}
          type="file"
          accept=".xlsx,application/vnd.openxmlformats-officedocument.spreadsheetml.sheet"
          hidden
          disabled={busy}
          onChange={(e) => {
            const file = e.target.files?.[0];
            e.target.value = '';
            if (file) onImport(file);
          }}
        />
      </div>
    </div>
  );
}
