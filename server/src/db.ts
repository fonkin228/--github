import Database from 'better-sqlite3';
import fs from 'node:fs';
import path from 'node:path';
import { config } from './config';
import { normalizeParams } from '../../shared/calc';
import type { CalcMode, CalcTotals, HistoryEntry, IncomeItem, Params } from '../../shared/types';

fs.mkdirSync(path.dirname(config.dbPath), { recursive: true });

export const db = new Database(config.dbPath);
db.pragma('journal_mode = WAL');
db.pragma('foreign_keys = ON');

/**
 * База общая: все расчёты и параметры лежат в одном «рабочем пространстве»,
 * чтобы группа видела одно и то же. Автор записи сохраняется отдельно.
 */
export const WORKSPACE = 0;

db.exec(`
CREATE TABLE IF NOT EXISTS users (
  tg_id       INTEGER PRIMARY KEY,
  first_name  TEXT,
  last_name   TEXT,
  username    TEXT,
  created_at  TEXT NOT NULL,
  seen_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS settings (
  tg_id      INTEGER PRIMARY KEY REFERENCES users(tg_id) ON DELETE CASCADE,
  params     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS calculations (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  tg_id      INTEGER NOT NULL REFERENCES users(tg_id) ON DELETE CASCADE,
  created_at TEXT NOT NULL,
  title      TEXT NOT NULL,
  params     TEXT NOT NULL,
  inputs     TEXT NOT NULL,
  totals     TEXT NOT NULL,
  mode       TEXT NOT NULL DEFAULT 'batch',
  income     TEXT,
  expenses   TEXT
);

CREATE INDEX IF NOT EXISTS idx_calculations_user ON calculations(tg_id, id DESC);

CREATE TABLE IF NOT EXISTS snapshots (
  id         INTEGER PRIMARY KEY AUTOINCREMENT,
  created_at TEXT NOT NULL,
  author     TEXT,
  reason     TEXT,
  entries    TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS chats (
  chat_id   INTEGER PRIMARY KEY,
  title     TEXT,
  added_at  TEXT NOT NULL
);
`);

// Мягкая миграция: базы, созданные до появления пошагового режима, дополняем колонками.
const existingColumns = new Set(
  (db.prepare('PRAGMA table_info(calculations)').all() as Array<{ name: string }>).map((c) => c.name),
);
if (!existingColumns.has('mode')) {
  db.exec("ALTER TABLE calculations ADD COLUMN mode TEXT NOT NULL DEFAULT 'batch'");
}
if (!existingColumns.has('income')) {
  db.exec('ALTER TABLE calculations ADD COLUMN income TEXT');
}
if (!existingColumns.has('expenses')) {
  db.exec('ALTER TABLE calculations ADD COLUMN expenses TEXT');
}
if (!existingColumns.has('author')) {
  db.exec('ALTER TABLE calculations ADD COLUMN author TEXT');
}
// Записи, сделанные до перехода на общую базу, переносим в рабочее пространство.
db.prepare('UPDATE calculations SET tg_id = ? WHERE tg_id <> ?').run(WORKSPACE, WORKSPACE);
db.prepare('INSERT OR IGNORE INTO users (tg_id, created_at, seen_at) VALUES (?, ?, ?)').run(
  WORKSPACE,
  nowIsoInit(),
  nowIsoInit(),
);

function nowIsoInit(): string {
  return new Date().toISOString();
}

const nowIso = (): string => new Date().toISOString();

export function upsertUser(user: { id: number; first_name?: string; last_name?: string; username?: string }): void {
  db.prepare(
    `INSERT INTO users (tg_id, first_name, last_name, username, created_at, seen_at)
     VALUES (@tg_id, @first_name, @last_name, @username, @now, @now)
     ON CONFLICT(tg_id) DO UPDATE SET
       first_name = excluded.first_name,
       last_name  = excluded.last_name,
       username   = excluded.username,
       seen_at    = excluded.seen_at`,
  ).run({
    tg_id: user.id,
    first_name: user.first_name ?? null,
    last_name: user.last_name ?? null,
    username: user.username ?? null,
    now: nowIso(),
  });
}

export function getParams(_tgId: number = WORKSPACE): Params {
  const row = db.prepare('SELECT params FROM settings WHERE tg_id = ?').get(WORKSPACE) as { params: string } | undefined;
  if (!row) return normalizeParams(null);
  try {
    return normalizeParams(JSON.parse(row.params));
  } catch {
    return normalizeParams(null);
  }
}

export function saveParams(_tgId: number, params: Params): Params {
  const normalized = normalizeParams(params);
  db.prepare(
    `INSERT INTO settings (tg_id, params, updated_at) VALUES (?, ?, ?)
     ON CONFLICT(tg_id) DO UPDATE SET params = excluded.params, updated_at = excluded.updated_at`,
  ).run(WORKSPACE, JSON.stringify(normalized), nowIso());
  return normalized;
}

export function addCalculation(args: {
  tgId: number;
  title: string;
  params: Params;
  inputs: string[];
  totals: CalcTotals;
  mode?: CalcMode;
  income?: IncomeItem[] | null;
  expenses?: IncomeItem[] | null;
  author?: string | null;
}): number {
  const info = db
    .prepare(
      'INSERT INTO calculations (tg_id, created_at, title, params, inputs, totals, mode, income, expenses, author) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)',
    )
    .run(
      WORKSPACE,
      nowIso(),
      args.title,
      JSON.stringify(args.params),
      JSON.stringify(args.inputs),
      JSON.stringify(args.totals),
      args.mode ?? 'batch',
      args.income ? JSON.stringify(args.income) : null,
      args.expenses?.length ? JSON.stringify(args.expenses) : null,
      args.author ?? null,
    );
  // Держим историю компактной: последние 100 расчётов на пользователя.
  db.prepare(
    `DELETE FROM calculations
     WHERE tg_id = ? AND id NOT IN (SELECT id FROM calculations WHERE tg_id = ? ORDER BY id DESC LIMIT 100)`,
  ).run(WORKSPACE, WORKSPACE);
  return Number(info.lastInsertRowid);
}

interface CalcRowDb {
  id: number;
  created_at: string;
  title: string;
  params: string;
  inputs: string;
  totals: string;
  mode: string;
  income: string | null;
  expenses: string | null;
  author: string | null;
}

const toEntry = (row: CalcRowDb): HistoryEntry => ({
  id: row.id,
  createdAt: row.created_at,
  title: row.title,
  params: normalizeParams(JSON.parse(row.params)),
  mode: row.mode === 'stages' ? 'stages' : 'batch',
  inputs: JSON.parse(row.inputs) as string[],
  income: row.income ? (JSON.parse(row.income) as IncomeItem[]) : undefined,
  expenses: row.expenses ? (JSON.parse(row.expenses) as IncomeItem[]) : undefined,
  author: row.author ?? undefined,
  totals: JSON.parse(row.totals) as CalcTotals,
});

export function listCalculations(_tgId: number, limit = 50): HistoryEntry[] {
  const rows = db
    .prepare('SELECT id, created_at, title, params, inputs, totals, mode, income, expenses, author FROM calculations WHERE tg_id = ? ORDER BY id DESC LIMIT ?')
    .all(WORKSPACE, limit) as CalcRowDb[];
  return rows.map(toEntry);
}

export function getCalculation(_tgId: number, id: number): HistoryEntry | null {
  const row = db
    .prepare('SELECT id, created_at, title, params, inputs, totals, mode, income, expenses, author FROM calculations WHERE tg_id = ? AND id = ?')
    .get(WORKSPACE, id) as CalcRowDb | undefined;
  return row ? toEntry(row) : null;
}

export function deleteCalculation(_tgId: number, id: number): boolean {
  return db.prepare('DELETE FROM calculations WHERE tg_id = ? AND id = ?').run(WORKSPACE, id).changes > 0;
}

// --- Снимки базы: страховка перед заменой ----------------------------------

const SNAPSHOT_LIMIT = 10;

export interface Snapshot {
  id: number;
  createdAt: string;
  author: string | null;
  reason: string | null;
  entries: HistoryEntry[];
}

/** Складывает текущее состояние базы в стопку снимков. */
export function pushSnapshot(author?: string | null, reason?: string | null): number {
  const entries = listCalculations(WORKSPACE, 100);
  const info = db
    .prepare('INSERT INTO snapshots (created_at, author, reason, entries) VALUES (?, ?, ?, ?)')
    .run(nowIso(), author ?? null, reason ?? null, JSON.stringify(entries));
  db.prepare(
    'DELETE FROM snapshots WHERE id NOT IN (SELECT id FROM snapshots ORDER BY id DESC LIMIT ?)',
  ).run(SNAPSHOT_LIMIT);
  return entries.length;
}

/** Снимает верхний снимок со стопки и отдаёт его. */
export function popSnapshot(): Snapshot | null {
  const row = db.prepare('SELECT id, created_at, author, reason, entries FROM snapshots ORDER BY id DESC LIMIT 1').get() as
    | { id: number; created_at: string; author: string | null; reason: string | null; entries: string }
    | undefined;
  if (!row) return null;
  db.prepare('DELETE FROM snapshots WHERE id = ?').run(row.id);
  return {
    id: row.id,
    createdAt: row.created_at,
    author: row.author,
    reason: row.reason,
    entries: JSON.parse(row.entries) as HistoryEntry[],
  };
}

export function countSnapshots(): number {
  return (db.prepare('SELECT COUNT(*) AS n FROM snapshots').get() as { n: number }).n;
}

/**
 * Полностью заменяет историю.
 * Перед заменой прячет текущее состояние в снимок — его возвращает /otkat.
 */
export function replaceCalculations(
  _tgId: number,
  entries: HistoryEntry[],
  author?: string,
  options?: { snapshot?: boolean; reason?: string },
): number {
  if (options?.snapshot !== false) pushSnapshot(author, options?.reason ?? 'замена базы');

  const tx = db.transaction((list: HistoryEntry[]) => {
    db.prepare('DELETE FROM calculations WHERE tg_id = ?').run(WORKSPACE);
    for (const item of list.slice(0, 100).reverse()) {
      addCalculation({
        tgId: WORKSPACE,
        title: item.title,
        params: item.params,
        inputs: item.inputs,
        totals: item.totals,
        mode: item.mode,
        income: item.income ?? null,
        expenses: item.expenses ?? null,
        author: item.author ?? author ?? null,
      });
    }
  });
  tx(entries);
  return Math.min(entries.length, 100);
}

// --- Чаты, куда бот шлёт уведомления ---------------------------------------

export function registerChat(chatId: number, title?: string | null): void {
  db.prepare(
    `INSERT INTO chats (chat_id, title, added_at) VALUES (?, ?, ?)
     ON CONFLICT(chat_id) DO UPDATE SET title = excluded.title`,
  ).run(chatId, title ?? null, nowIso());
}

export function unregisterChat(chatId: number): void {
  db.prepare('DELETE FROM chats WHERE chat_id = ?').run(chatId);
}

export function listChats(): Array<{ chat_id: number; title: string | null }> {
  return db.prepare('SELECT chat_id, title FROM chats').all() as Array<{ chat_id: number; title: string | null }>;
}

export function clearCalculations(_tgId: number): number {
  return db.prepare('DELETE FROM calculations WHERE tg_id = ?').run(WORKSPACE).changes;
}
