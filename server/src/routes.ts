import type { FastifyInstance, FastifyReply, FastifyRequest } from 'fastify';
import { accessIsOpen, checkAccess, forgetAccess } from './access';
import { authenticate, type TelegramUser } from './auth';
import { config } from './config';
import {
  addCalculation,
  clearCalculations,
  deleteCalculation,
  getCalculation,
  getParams,
  listCalculations,
  replaceCalculations,
  saveParams,
  upsertUser,
} from './db';
import { notifyChats, sendDocumentToUser, sendWorkbookToUser } from './bot';
import { buildFileName, buildStagesWorkbook, buildWorkbook } from '../../shared/xlsx';
import { buildDatabaseWorkbook, DATABASE_FILE_NAME } from '../../shared/database';
import { calcAll, calcStages, normalizeParams } from '../../shared/calc';
import { formatMoney } from '../../shared/money';
import { splitAmounts } from '../../shared/parse';
import { SUMS, withPlural } from '../../shared/plural';
import type { CalcMode, HistoryEntry, IncomeItem, Params } from '../../shared/types';

declare module 'fastify' {
  interface FastifyRequest {
    tgUser: TelegramUser;
    isDevAuth: boolean;
  }
}

interface CalcBody {
  inputs?: unknown;
  text?: unknown;
  params?: Partial<Params> | null;
  save?: boolean;
  title?: string;
  /** 'stages' — расчёт из поступлений, 'batch' — список независимых заработков */
  mode?: CalcMode;
  income?: IncomeItem[] | null;
  expenses?: IncomeItem[] | null;
}

const readIncome = (body: CalcBody): IncomeItem[] | null =>
  Array.isArray(body.income) && body.income.length > 0 ? body.income : null;

const readExpenses = (body: CalcBody): IncomeItem[] =>
  Array.isArray(body.expenses) ? body.expenses : [];

/** Общий сборщик файла: пошаговая книга, если пришли поступления, иначе таблица. */
async function buildFile(body: CalcBody, params: Params, inputs: string[]): Promise<Buffer> {
  const income = readIncome(body);
  if (income) {
    const stages = calcStages(income, readExpenses(body), params);
    return Buffer.from(await buildStagesWorkbook(stages));
  }
  return Buffer.from(await buildWorkbook(calcAll(inputs, params)));
}

/** Принимает и массив строк, и «многострочный» текст из textarea. */
function readInputs(body: CalcBody): string[] {
  if (Array.isArray(body.inputs)) {
    return body.inputs.map((v) => String(v ?? '').trim()).filter((v) => v.length > 0);
  }
  if (typeof body.text === 'string') return splitAmounts(body.text);
  return [];
}

function resolveParams(request: FastifyRequest, body: CalcBody): Params {
  return body.params ? normalizeParams(body.params) : getParams(request.tgUser.id);
}

export async function registerRoutes(app: FastifyInstance): Promise<void> {
  // --- Авторизация по initData ------------------------------------------
  app.addHook('preHandler', async (request: FastifyRequest, reply: FastifyReply) => {
    if (!request.url.startsWith('/api/')) return;
    if (request.url === '/api/health') return;

    const header = request.headers['x-telegram-init-data'];
    const initData = Array.isArray(header) ? header[0] : header;
    const auth = authenticate(initData);
    if (!auth.ok) {
      reply.code(401).send({ error: auth.error });
      return;
    }
    request.tgUser = auth.user;
    request.isDevAuth = auth.dev;
    upsertUser(auth.user);

    // Общая база — только для участников рабочей группы.
    if (!auth.dev) {
      const access = await checkAccess(auth.user.id);
      if (!access.ok) {
        reply.code(403).send({ error: access.reason });
        return;
      }
    }
  });

  app.get('/api/health', async () => ({
    ok: true,
    botConfigured: Boolean(config.botToken),
    webAppUrl: config.webAppUrl || null,
    devAuth: config.allowDevAuth,
    /** true = доступ пока никем не ограничен: бот не добавлен ни в одну группу. */
    accessOpen: accessIsOpen(),
  }));

  app.get('/api/me', async (request) => ({
    user: request.tgUser,
    devAuth: request.isDevAuth,
    params: getParams(request.tgUser.id),
    botConfigured: Boolean(config.botToken),
  }));

  // --- Расчёт ------------------------------------------------------------
  app.post('/api/calc', async (request, reply) => {
    const body = (request.body ?? {}) as CalcBody;
    const inputs = readInputs(body);
    if (inputs.length === 0) return reply.code(400).send({ error: 'Нет ни одной суммы' });
    if (inputs.length > config.maxRowsPerCalc) {
      return reply.code(413).send({ error: `Слишком много строк: максимум ${config.maxRowsPerCalc}` });
    }

    const params = resolveParams(request, body);
    const result = calcAll(inputs, params);

    const income = readIncome(body);
    let historyId: number | null = null;
    if (body.save !== false) {
      historyId = addCalculation({
        tgId: request.tgUser.id,
        title:
          body.title?.trim() ||
          (income
            ? `Пополнения ${inputs[0]}`
            : inputs.length === 1
              ? inputs[0]
              : withPlural(inputs.length, SUMS)),
        params,
        inputs,
        totals: result.totals,
        mode: income ? 'stages' : 'batch',
        income,
        expenses: income ? readExpenses(body) : null,
        author: [request.tgUser.first_name, request.tgUser.last_name].filter(Boolean).join(' ') || null,
      });
    }
    return { ...result, historyId };
  });

  // --- Параметры ---------------------------------------------------------
  app.get('/api/settings', async (request) => ({ params: getParams(request.tgUser.id) }));

  app.put('/api/settings', async (request, reply) => {
    const body = (request.body ?? {}) as { params?: Partial<Params> };
    if (!body.params) return reply.code(400).send({ error: 'Нет объекта params' });
    return { params: saveParams(request.tgUser.id, normalizeParams(body.params)) };
  });

  // --- Экспорт -----------------------------------------------------------
  app.post('/api/export', async (request, reply) => {
    const body = (request.body ?? {}) as CalcBody;
    const inputs = readInputs(body);
    if (inputs.length === 0) return reply.code(400).send({ error: 'Нет ни одной суммы' });

    const result = calcAll(inputs, resolveParams(request, body));
    const buffer = Buffer.from(await buildWorkbook(result));
    const fileName = buildFileName();

    return reply
      .header('Content-Type', 'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet')
      .header('Content-Disposition', `attachment; filename="${fileName}"; filename*=UTF-8''${encodeURIComponent(fileName)}`)
      .send(buffer);
  });

  /**
   * Внутри Telegram WebView скачивание blob-файлов часто блокируется,
   * поэтому основной путь доставки — бот присылает документ в чат.
   */
  app.post('/api/export/telegram', async (request, reply) => {
    if (request.isDevAuth) return reply.code(400).send({ error: 'В dev-режиме отправка в чат недоступна' });

    const body = (request.body ?? {}) as CalcBody;
    const inputs = readInputs(body);
    if (inputs.length === 0) return reply.code(400).send({ error: 'Нет ни одной суммы' });

    const params = resolveParams(request, body);
    const buffer = await buildFile(body, params, inputs);
    const sent = await sendWorkbookToUser(request.tgUser.id, buffer);
    if (!sent.ok) return reply.code(502).send({ error: sent.error });
    return { ok: true };
  });

  /**
   * Присылает всю базу файлом в чат с ботом.
   * На телефоне это единственный рабочий способ: внутри Telegram
   * обычное скачивание блокируется.
   */
  app.post('/api/database/send', async (request, reply) => {
    if (request.isDevAuth) return reply.code(400).send({ error: 'В dev-режиме отправка в чат недоступна' });

    const entries = listCalculations(request.tgUser.id, 100);
    if (entries.length === 0) return reply.code(400).send({ error: 'База пуста — нечего отправлять' });

    const buffer = Buffer.from(await buildDatabaseWorkbook(entries));
    const sent = await sendDocumentToUser(
      request.tgUser.id,
      buffer,
      DATABASE_FILE_NAME,
      `База: ${entries.length} расчётов. Можно править в Excel и прислать обратно этим же файлом.`,
    );
    if (!sent.ok) return reply.code(502).send({ error: sent.error });
    return { ok: true, count: entries.length };
  });

  // --- История -----------------------------------------------------------
  app.get('/api/history', async (request) => ({ items: listCalculations(request.tgUser.id) }));

  app.get('/api/history/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    const entry = getCalculation(request.tgUser.id, Number(id));
    if (!entry) return reply.code(404).send({ error: 'Расчёт не найден' });
    return { entry, result: calcAll(entry.inputs, entry.params) };
  });

  /** Сброс кэша членства — если человека только что добавили в группу. */
  app.post('/api/access/refresh', async (request) => {
    forgetAccess(request.tgUser.id);
    return { ok: true };
  });

  app.delete('/api/history/:id', async (request, reply) => {
    const { id } = request.params as { id: string };
    if (!deleteCalculation(request.tgUser.id, Number(id))) {
      return reply.code(404).send({ error: 'Расчёт не найден' });
    }
    return { ok: true };
  });

  app.delete('/api/history', async (request) => ({ deleted: clearCalculations(request.tgUser.id) }));

  /** Импорт базы: клиент разбирает xlsx сам и присылает готовые записи. */
  app.put('/api/history', async (request, reply) => {
    const body = (request.body ?? {}) as { entries?: HistoryEntry[] };
    if (!Array.isArray(body.entries)) return reply.code(400).send({ error: 'Нет массива entries' });

    const who = [request.tgUser.first_name, request.tgUser.last_name].filter(Boolean).join(' ') || 'кто-то';
    const saved = replaceCalculations(request.tgUser.id, body.entries, who, { reason: `импорт из приложения (${who})` });
    const deposits = body.entries.reduce((sum, e) => sum + (e.totals?.n ?? 0), 0);

    // Уведомляем группу и сразу прикладываем свежую базу.
    void notifyChats(
      [
        `📥 <b>${who}</b> обновил базу из файла.`,
        `Расчётов: ${saved}. Пополнений на ${formatMoney(deposits)}.`,
        'Прошлая версия сохранена — вернуть можно командой /otkat.',
      ].join('\n'),
      true,
    );

    return { saved };
  });
}
