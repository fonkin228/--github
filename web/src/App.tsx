import { useCallback, useEffect, useMemo, useState } from 'react';
import { api, IS_STANDALONE, type MeResponse } from './api';
import { alertUser, confirmUser, haptic, isInsideTelegram, tg } from './telegram';
import { AnalyticsTab } from './components/AnalyticsTab';
import { HistoryTab } from './components/HistoryTab';
import { makeIncomeItem } from './components/IncomeEditor';
import { ParamsTab } from './components/ParamsTab';
import { StagesTab } from './components/StagesTab';
import { ThemeSwitch } from './components/ThemeSwitch';
import { applyTheme, readTheme, type Theme } from './theme';
import { calcStages } from '@shared/calc';
import { buildDatabaseWorkbook, DATABASE_FILE_NAME, parseDatabaseWorkbook } from '@shared/database';
import { formatMoney, formatPercent } from '@shared/money';
import { DEFAULT_PARAMS, type HistoryEntry, type IncomeItem, type Params } from '@shared/types';

type Tab = 'stages' | 'analytics' | 'params' | 'history';

const TABS: Array<[Tab, string]> = [
  ['stages', 'Этапы'],
  ['analytics', 'Аналитика'],
  ['params', 'Параметры'],
  ['history', 'История'],
];

export default function App() {
  const [tab, setTab] = useState<Tab>('stages');
  const [income, setIncome] = useState<IncomeItem[]>(() => [makeIncomeItem()]);
  const [expenses, setExpenses] = useState<IncomeItem[]>(() => [makeIncomeItem()]);
  const [params, setParams] = useState<Params>(DEFAULT_PARAMS);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [history, setHistory] = useState<HistoryEntry[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [busy, setBusy] = useState<'save' | 'export' | 'db' | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [denied, setDenied] = useState<string | null>(null);
  const [flash, setFlash] = useState<string | null>(null);
  const [theme, setTheme] = useState<Theme>(() => readTheme());

  // Считается локально тем же кодом, что и на сервере.
  const stages = useMemo(() => calcStages(income, expenses, params), [expenses, income, params]);
  const ready = stages.income.validCount > 0 && stages.row.ok;

  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  useEffect(() => {
    api
      .me()
      .then((data) => {
        setMe(data);
        setParams(data.params);
      })
      .catch((e: Error & { status?: number }) => {
        if (e.status === 403) setDenied(e.message);
        else setError(e.message);
      });
  }, []);

  const loadHistory = useCallback(async () => {
    setHistoryLoading(true);
    try {
      const { items } = await api.history();
      setHistory(items);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setHistoryLoading(false);
    }
  }, []);

  useEffect(() => {
    if (tab === 'history' || tab === 'analytics') void loadHistory();
  }, [tab, loadHistory]);

  const payload = useMemo(
    () => ({ inputs: [String(stages.income.gross)], income, expenses, mode: 'stages' as const }),
    [expenses, income, stages.income.gross],
  );

  const showFlash = useCallback((text: string) => {
    setFlash(text);
    window.setTimeout(() => setFlash(null), 3000);
  }, []);

  /** Явное сохранение: расчёт кладётся в историю. */
  const handleSave = useCallback(async () => {
    if (!ready || busy) return;
    setBusy('save');
    setError(null);
    tg?.MainButton.showProgress(true);
    try {
      await api.calc(payload.inputs, params, {
        save: true,
        mode: payload.mode,
        income: payload.income,
        expenses: payload.expenses,
      });
      haptic('success');
      showFlash('Сохранено в историю');
    } catch (e) {
      haptic('error');
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      tg?.MainButton.hideProgress();
      setBusy(null);
    }
  }, [busy, params, payload, ready, showFlash]);

  /** Выгрузка файла. В историю не пишет — для этого отдельная кнопка. */
  const handleExport = useCallback(async () => {
    if (!ready || busy) return;
    setBusy('export');
    setError(null);
    try {
      if (isInsideTelegram && me?.botConfigured && !me.devAuth) {
        await api.exportToChat(payload.inputs, params, payload.income, payload.expenses);
        haptic('success');
        alertUser('Файл отправлен в чат с ботом.');
      } else {
        await api.download(payload.inputs, params, payload.income, payload.expenses);
      }
    } catch (e) {
      haptic('error');
      const message = e instanceof Error ? e.message : String(e);
      setError(message);
      alertUser(`Не получилось: ${message}`);
    } finally {
      setBusy(null);
    }
  }, [busy, me, params, payload, ready]);

  useEffect(() => {
    const button = tg?.MainButton;
    if (!button) return;
    if (tab !== 'stages' || !ready) {
      button.hide();
      return;
    }
    button.setText('Сохранить в историю');
    button.show();
    button.onClick(handleSave);
    return () => button.offClick(handleSave);
  }, [handleSave, ready, tab]);

  /** Внутри Telegram файл отдаёт бот: на телефоне скачивание из WebView не работает. */
  const sendsToChat = isInsideTelegram && Boolean(me?.botConfigured) && !me?.devAuth;

  /** Выгружает всю историю одним файлом. */
  const handleExportDatabase = useCallback(async () => {
    if (busy) return;
    setBusy('db');
    setError(null);
    try {
      if (sendsToChat) {
        const { count } = await api.sendDatabaseToChat();
        haptic('success');
        showFlash(`База отправлена в чат: ${count} расчётов`);
        return;
      }
      const buffer = await buildDatabaseWorkbook(history);
      const blob = new Blob([buffer], {
        type: 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
      });
      const url = URL.createObjectURL(blob);
      const link = document.createElement('a');
      link.href = url;
      link.download = DATABASE_FILE_NAME;
      document.body.appendChild(link);
      link.click();
      link.remove();
      setTimeout(() => URL.revokeObjectURL(url), 10000);
      showFlash('База выгружена');
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(null);
    }
  }, [busy, history, sendsToChat, showFlash]);

  /** Читает отредактированный файл и заменяет им историю. */
  const handleImportDatabase = useCallback(
    async (file: File) => {
      if (busy) return;
      setBusy('db');
      setError(null);
      try {
        const { entries, skipped } = await parseDatabaseWorkbook(await file.arrayBuffer(), params);
        if (entries.length === 0) {
          setError('В файле не нашлось ни одного расчёта — проверьте лист «База».');
          return;
        }
        const ok = await confirmUser(
          `Заменить историю на ${entries.length} расчётов из файла? Текущая история будет удалена.`,
        );
        if (!ok) return;

        await api.replaceHistory(entries);
        await loadHistory();
        haptic('success');
        showFlash(
          skipped.length > 0
            ? `Загружено расчётов: ${entries.length}. Пропущено строк: ${skipped.length}`
            : `Загружено расчётов: ${entries.length}`,
        );
      } catch (e) {
        haptic('error');
        setError(e instanceof Error ? e.message : 'Файл не читается — нужен xlsx, выгруженный этим приложением');
      } finally {
        setBusy(null);
      }
    },
    [busy, loadHistory, params, showFlash],
  );

  const handleSaveParams = async (next: Params): Promise<void> => {
    const { params: saved } = await api.saveParams(next);
    setParams(saved);
    haptic('success');
  };

  const openHistoryEntry = (entry: HistoryEntry): void => {
    setParams(entry.params);
    // Записи из бота хранят только список сумм — раскладываем их по строкам пополнений.
    const items = entry.income?.length
      ? entry.income.map((item) => ({ ...item }))
      : entry.inputs.map((amount) => makeIncomeItem(amount));
    setIncome(items.length > 0 ? items : [makeIncomeItem()]);
    const restoredExpenses = entry.expenses?.length ? entry.expenses.map((item) => ({ ...item })) : [];
    setExpenses(restoredExpenses.length > 0 ? restoredExpenses : [makeIncomeItem()]);
    setTab('stages');
  };

  const deleteHistoryEntry = async (id: number): Promise<void> => {
    await api.deleteHistoryItem(id);
    setHistory((items) => items.filter((item) => item.id !== id));
  };

  const clearHistory = async (): Promise<void> => {
    if (!(await confirmUser('Удалить всю историю расчётов?'))) return;
    await api.clearHistory();
    setHistory([]);
  };

  if (denied) {
    return (
      <div className="app">
        <header className="header">
          <div className="header__text">
            <h1>Распределение пополнений</h1>
          </div>
          <ThemeSwitch value={theme} onChange={setTheme} />
        </header>
        <div className="card card--error">
          <div className="card__head">
            <span className="card__title">Доступ закрыт</span>
          </div>
          <p className="hint">{denied}</p>
        </div>
      </div>
    );
  }

  return (
    <div className="app">
      <header className="header">
        <div className="header__text">
          <h1>Распределение пополнений</h1>
          <div className="header__params">
            {formatPercent(params.p1)} / {formatPercent(params.p2)} / {formatPercent(params.p3)} · шаг{' '}
            {formatMoney(params.step, 0)} · комиссия {formatPercent(params.commissionRate)}
          </div>
        </div>
        <ThemeSwitch value={theme} onChange={setTheme} />
      </header>

      <nav className="tabs">
        {TABS.map(([key, label]) => (
          <button key={key} className={tab === key ? 'is-active' : ''} onClick={() => setTab(key)}>
            {label}
          </button>
        ))}
      </nav>

      {flash ? <div className="notice notice--ok">{flash}</div> : null}
      {me?.devAuth && !IS_STANDALONE ? (
        <div className="notice notice--warn">
          Dev-режим: подпись Telegram не проверяется, отправка файла в чат недоступна.
        </div>
      ) : null}
      {error ? <div className="notice notice--error">{error}</div> : null}

      {tab === 'stages' ? (
        <StagesTab
          items={income}
          income={stages.income}
          expenseItems={expenses}
          expenses={stages.expenses}
          row={stages.row}
          payout={stages.payout}
          params={params}
          onChange={setIncome}
          onExpensesChange={setExpenses}
        />
      ) : null}

      {tab === 'analytics' ? <AnalyticsTab entries={history} loading={historyLoading} /> : null}

      {tab === 'params' ? <ParamsTab params={params} onChange={setParams} onSave={handleSaveParams} /> : null}

      {tab === 'history' ? (
        <HistoryTab
          items={history}
          loading={historyLoading}
          busy={busy === 'db'}
          onOpen={openHistoryEntry}
          onDelete={(id) => void deleteHistoryEntry(id)}
          onClear={() => void clearHistory()}
          sendsToChat={sendsToChat}
          onExport={() => void handleExportDatabase()}
          onImport={(file) => void handleImportDatabase(file)}
        />
      ) : null}

      {tab === 'stages' && ready ? (
        <div className="actions">
          <button className="btn btn--primary btn--wide" onClick={handleSave} disabled={busy !== null}>
            {busy === 'save' ? 'Сохраняю…' : 'Сохранить в историю'}
          </button>
          <button className="btn btn--wide" onClick={handleExport} disabled={busy !== null}>
            {busy === 'export' ? 'Готовлю файл…' : 'Скачать xlsx'}
          </button>
        </div>
      ) : null}

      <footer className="footer">
        Файл выгружается «живым»: проценты и шаг остаются формулами, пересчитывается прямо в Excel.
        {IS_STANDALONE ? ' Работает автономно: расчёт и выгрузка идут здесь, без сервера.' : ''}
      </footer>
    </div>
  );
}
