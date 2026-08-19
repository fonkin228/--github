import { Bot, InlineKeyboard, InputFile, Keyboard } from 'grammy';
import { config } from './config';
import {
  addCalculation,
  getParams,
  listCalculations,
  countSnapshots,
  listChats,
  popSnapshot,
  registerChat,
  replaceCalculations,
  unregisterChat,
  upsertUser,
} from './db';
import { buildFileName, buildWorkbook } from '../../shared/xlsx';
import { buildDatabaseWorkbook, DATABASE_FILE_NAME, parseDatabaseWorkbook } from '../../shared/database';
import { calcAll } from '../../shared/calc';
import { formatMoney, formatPercent } from '../../shared/money';
import { splitAmounts } from '../../shared/parse';
import { ROWS, ROWS_DAT, SUMS, withPlural } from '../../shared/plural';
import { p3BaseLabel, type CalcResult } from '../../shared/types';

export const bot = config.botToken ? new Bot(config.botToken) : null;

const canOpenWebApp = (): boolean => /^https:\/\//.test(config.webAppUrl);
/** Прямая ссылка на Mini App — единственный способ открыть его из группы. */
const directLink = (): string => config.miniAppLink || config.webAppUrl;

/** В личке — нативная кнопка Web App под полем ввода. */
function privateKeyboard(): Keyboard | undefined {
  if (!canOpenWebApp()) return undefined;
  return new Keyboard().webApp('📊 Открыть калькулятор', config.webAppUrl).resized().persistent();
}

/**
 * В группах Telegram не разрешает инлайн-кнопки web_app,
 * поэтому даём обычную ссылку — она открывает то же приложение.
 */
function groupKeyboard(): InlineKeyboard | undefined {
  const link = directLink();
  if (!/^https:\/\//.test(link)) return undefined;
  return new InlineKeyboard().url('📊 Открыть калькулятор', link);
}

const isGroup = (type: string): boolean => type === 'group' || type === 'supergroup';

/** Текстовая карточка результата — то же, что видно в Mini App. */
export function renderResult(result: CalcResult): string {
  const { params, rows, totals } = result;
  const valid = rows.filter((r) => r.ok);
  const head =
    `<b>Распределение пополнений</b> — ${formatPercent(params.p1)} / ${formatPercent(params.p2)} / ${formatPercent(params.p3)}, ` +
    `шаг округления ${formatMoney(params.step, 0)}`;

  if (valid.length === 0) return `${head}\n\n❗️Ни одна сумма не распознана.`;

  const blocks = valid.slice(0, 10).map((r) =>
    [
      `<b>Пополнение ${formatMoney(r.n)}</b>`,
      `Доля 1 (${formatPercent(params.p1)}, вверх до ${formatMoney(params.step, 0)}): <b>${formatMoney(r.part1)}</b>` +
        (r.roundUp ? `  <i>(+${formatMoney(r.roundUp)})</i>` : '  <i>(без добавки)</i>'),
      `Налог (${formatPercent(params.p2)}): <b>${formatMoney(r.part2)}</b>`,
      `Заработок (${formatPercent(params.p3)} от «${p3BaseLabel(params.p3Base)}»): <b>${formatMoney(r.part3)}</b>`,
      `Итого: <b>${formatMoney(r.total)}</b>`,
    ].join('\n'),
  );

  const tail: string[] = [];
  if (valid.length > 10) tail.push(`…и ещё ${withPlural(valid.length - 10, ROWS)} — они есть в файле.`);
  if (valid.length > 1) {
    tail.push(
      `<b>Свод по ${withPlural(valid.length, ROWS_DAT)}</b>\nПополнения: ${formatMoney(totals.n)}\n` +
        `Доля 1: ${formatMoney(totals.part1)}\nНалог: ${formatMoney(totals.part2)}\n` +
        `Заработок: ${formatMoney(totals.part3)}`,
    );
  }
  const invalid = rows.length - valid.length;
  if (invalid > 0) tail.push(`⚠️ Не распознано строк: ${invalid}`);

  return [head, ...blocks, ...tail].join('\n\n');
}

/** Отправляет готовый файл расчёта. */
export async function sendWorkbookToUser(
  tgId: number,
  source: CalcResult | Buffer,
  caption?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!bot) return { ok: false, error: 'Бот не настроен (нет BOT_TOKEN)' };
  try {
    const buffer = Buffer.isBuffer(source) ? source : Buffer.from(await buildWorkbook(source));
    await bot.api.sendDocument(tgId, new InputFile(buffer, buildFileName()), {
      caption: caption ?? 'Расчёт готов. Файл живой: проценты и шаг можно менять прямо в Excel.',
    });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Отправляет произвольный файл пользователю в личку. */
export async function sendDocumentToUser(
  tgId: number,
  buffer: Buffer,
  fileName: string,
  caption?: string,
): Promise<{ ok: boolean; error?: string }> {
  if (!bot) return { ok: false, error: 'Бот не настроен (нет BOT_TOKEN)' };
  try {
    await bot.api.sendDocument(tgId, new InputFile(buffer, fileName), { caption });
    return { ok: true };
  } catch (error) {
    return { ok: false, error: error instanceof Error ? error.message : String(error) };
  }
}

/** Текущая общая база одним файлом. */
async function currentDatabase(): Promise<{ buffer: Buffer; count: number }> {
  const entries = listCalculations(0, 100);
  const buffer = Buffer.from(await buildDatabaseWorkbook(entries));
  return { buffer, count: entries.length };
}

/** Рассылает уведомление во все чаты, куда добавлен бот. */
export async function notifyChats(text: string, withFile = false): Promise<void> {
  if (!bot) return;
  const chats = listChats();
  if (chats.length === 0) return;

  const keyboard = groupKeyboard();
  const file = withFile ? await currentDatabase() : null;

  for (const chat of chats) {
    try {
      await bot.api.sendMessage(chat.chat_id, text, { parse_mode: 'HTML', reply_markup: keyboard });
      if (file) {
        await bot.api.sendDocument(chat.chat_id, new InputFile(file.buffer, DATABASE_FILE_NAME), {
          caption: 'Актуальная база на этот момент.',
        });
      }
    } catch (error) {
      console.error(`[bot] не удалось написать в чат ${chat.chat_id}:`, error);
    }
  }
}

export function registerBotHandlers(): void {
  if (!bot) return;

  bot.catch((err) => console.error('[bot] ошибка обработчика:', err.error));

  // --- Появление и уход из группы ---------------------------------------
  // Состав группы поменялся — забываем прошлые вердикты о доступе.
  bot.on('chat_member', () => {
    void import('./access').then((m) => m.forgetAccess());
  });

  bot.on('my_chat_member', async (ctx) => {
    const chat = ctx.chat;
    if (!isGroup(chat.type)) return;
    const status = ctx.myChatMember.new_chat_member.status;

    if (status === 'member' || status === 'administrator') {
      registerChat(chat.id, 'title' in chat ? chat.title : null);
      await ctx.reply(
        [
          '👋 Калькулятор распределения пополнений.',
          '',
          'Считать удобнее в приложении — кнопка ниже.',
          'Здесь я пишу, когда кто-то обновляет базу, и по команде /baza присылаю её файлом.',
        ].join('\n'),
        { reply_markup: groupKeyboard() },
      );
    } else {
      unregisterChat(chat.id);
    }
  });

  // --- Команды -----------------------------------------------------------
  bot.command('start', async (ctx) => {
    if (ctx.from) upsertUser(ctx.from);
    if (isGroup(ctx.chat.type)) {
      registerChat(ctx.chat.id, 'title' in ctx.chat ? ctx.chat.title : null);
      await ctx.reply('Калькулятор распределения пополнений. Открыть — кнопкой ниже, база — по команде /baza.', {
        reply_markup: groupKeyboard(),
      });
      return;
    }

    await ctx.reply(
      [
        '👋 Это калькулятор распределения пополнений.',
        '',
        'Пришлите сумму — верну разбивку и файл Excel.',
        'Команда /baza присылает всю базу одним файлом.',
        '',
        canOpenWebApp()
          ? 'Кнопка ниже открывает приложение с этапами, аналитикой и историей.'
          : '⚠️ Mini App пока не подключён: задайте WEBAPP_URL и укажите его в BotFather.',
      ].join('\n'),
      { reply_markup: privateKeyboard() },
    );
  });

  bot.command('baza', async (ctx) => {
    const allowed = await isAllowed(ctx.from?.id);
    if (!allowed.ok) {
      await ctx.reply(allowed.reason ?? 'Нет доступа к базе.');
      return;
    }
    const { buffer, count } = await currentDatabase();
    if (count === 0) {
      await ctx.reply('База пока пуста — ни одного сохранённого расчёта.');
      return;
    }
    await ctx.replyWithDocument(new InputFile(buffer, DATABASE_FILE_NAME), {
      caption: `Актуальная база: ${withPlural(count, ['расчёт', 'расчёта', 'расчётов'])}. Можно править в Excel и загрузить обратно в приложении.`,
    });
  });

  bot.command('otkat', async (ctx) => {
    const allowed = await isAllowed(ctx.from?.id);
    if (!allowed.ok) {
      await ctx.reply(allowed.reason ?? 'Нет доступа к базе.');
      return;
    }

    const snapshot = popSnapshot();
    if (!snapshot) {
      await ctx.reply('Откатывать нечего: сохранённых версий базы нет.');
      return;
    }

    // Сам откат снимок не создаёт, иначе стопка начнёт ходить по кругу.
    const restored = replaceCalculations(0, snapshot.entries, snapshot.author ?? undefined, { snapshot: false });
    const when = new Date(snapshot.createdAt).toLocaleString('ru-RU', {
      day: '2-digit',
      month: 'short',
      hour: '2-digit',
      minute: '2-digit',
    });
    const left = countSnapshots();

    await ctx.reply(
      [
        `↩️ Вернул версию от ${when}${snapshot.reason ? ` (перед: ${snapshot.reason})` : ''}.`,
        `Расчётов: ${restored}.`,
        left > 0 ? `Ещё можно откатиться назад: ${left}.` : 'Это была последняя сохранённая версия.',
      ].join('\n'),
    );
  });

  bot.command('help', async (ctx) => {
    await ctx.reply(
      [
        '<b>Команды</b>',
        '/start — открыть калькулятор',
        '/baza — прислать текущую базу файлом',
        '/otkat — вернуть предыдущую версию базы',
        'Пришлите боту xlsx — он станет текущей базой',
        '/params — проценты и шаг округления',
        '',
        isGroup(ctx.chat.type)
          ? 'В группе я не вмешиваюсь в переписку: только команды и уведомления об обновлении базы.'
          : 'Просто пришлите сумму пополнения — посчитаю.',
      ].join('\n'),
      { parse_mode: 'HTML' },
    );
  });

  bot.command('params', async (ctx) => {
    const params = getParams();
    await ctx.reply(
      [
        `Доля 1: ${formatPercent(params.p1)} от пополнений (округление вверх до ${formatMoney(params.step, 0)})`,
        `Налог: ${formatPercent(params.p2)} от пополнений`,
        `Заработок: ${formatPercent(params.p3)} от «${p3BaseLabel(params.p3Base)}»`,
        `Комиссия за пополнение: ${formatPercent(params.commissionRate)}`,
        '',
        'Изменить — в приложении, вкладка «Параметры».',
      ].join('\n'),
    );
  });

  // --- Загрузка базы файлом ----------------------------------------------
  // Главный способ перенести базу на другое устройство: прислать боту xlsx.
  bot.on('message:document', async (ctx) => {
    const doc = ctx.message.document;
    const name = doc.file_name ?? '';
    if (!/\.xlsx$/i.test(name)) return; // не наш файл — молчим

    const who = ctx.from?.first_name ?? 'кто-то';
    const allowed = await isAllowed(ctx.from?.id);
    if (!allowed.ok) {
      await ctx.reply(allowed.reason ?? 'Нет доступа к базе.');
      return;
    }

    const note = await ctx.reply('Читаю файл…');
    try {
      const file = await ctx.api.getFile(doc.file_id);
      if (!file.file_path) throw new Error('Telegram не отдал файл');
      const response = await fetch(`https://api.telegram.org/file/bot${config.botToken}/${file.file_path}`);
      if (!response.ok) throw new Error(`Не удалось скачать файл (${response.status})`);

      const { entries, skipped } = await parseDatabaseWorkbook(await response.arrayBuffer(), getParams());
      if (entries.length === 0) {
        await ctx.api.editMessageText(
          ctx.chat.id,
          note.message_id,
          'В файле не нашлось ни одного расчёта. Нужен лист «База» — такой файл отдаёт команда /baza.',
        );
        return;
      }

      const saved = replaceCalculations(0, entries, who, { reason: `файл от ${who}` });
      const deposits = entries.reduce((sum, e) => sum + (e.totals?.n ?? 0), 0);

      await ctx.api.editMessageText(
        ctx.chat.id,
        note.message_id,
        [
          `✅ База загружена: ${saved} ${saved === 1 ? 'расчёт' : 'расчётов'}.`,
          `Пополнений на ${formatMoney(deposits)}.`,
          skipped.length > 0 ? `Пропущено строк: ${skipped.length}.` : '',
          'Прошлая версия сохранена — вернуть можно командой /otkat.',
        ]
          .filter(Boolean)
          .join(' '),
      );

      // Остальным участникам — уведомление, но без повторной отправки файла.
      const others = listChats().filter((c) => c.chat_id !== ctx.chat.id);
      for (const chat of others) {
        try {
          await bot!.api.sendMessage(
            chat.chat_id,
            `📥 <b>${who}</b> загрузил базу файлом: ${saved} расчётов.`,
            { parse_mode: 'HTML', reply_markup: groupKeyboard() },
          );
        } catch {
          /* чат недоступен — пропускаем */
        }
      }
    } catch (error) {
      await ctx.api.editMessageText(
        ctx.chat.id,
        note.message_id,
        `Не получилось прочитать файл: ${error instanceof Error ? error.message : String(error)}`,
      );
    }
  });

  // --- Быстрый расчёт: только в личке ------------------------------------
  bot.on('message:text', async (ctx) => {
    if (isGroup(ctx.chat.type)) return; // в группе молчим
    const text = ctx.message.text.trim();
    if (text.startsWith('/')) return;
    if (ctx.from) upsertUser(ctx.from);

    const inputs = splitAmounts(text);
    if (inputs.length === 0) return;

    const params = getParams();
    const result = calcAll(inputs.slice(0, config.maxRowsPerCalc), params);

    if (result.rows.every((r) => !r.ok)) {
      await ctx.reply('Не понял 🤔 Пришлите число, например 706 945 или 706945,50.', {
        reply_markup: privateKeyboard(),
      });
      return;
    }

    addCalculation({
      tgId: ctx.from.id,
      title: inputs.length === 1 ? inputs[0] : `${withPlural(inputs.length, SUMS)} (из чата)`,
      params,
      inputs,
      totals: result.totals,
      author: ctx.from.first_name,
    });

    const keyboard = new InlineKeyboard().text('📥 Скачать xlsx', 'xlsx');
    await ctx.reply(renderResult(result), { parse_mode: 'HTML', reply_markup: keyboard });
  });

  bot.callbackQuery('xlsx', async (ctx) => {
    await ctx.answerCallbackQuery({ text: 'Готовлю файл…' });
    const params = getParams();
    const inputs = extractAmountsFromResultMessage(ctx.callbackQuery.message?.text ?? '');
    if (inputs.length === 0) {
      await ctx.reply('Не нашёл, что экспортировать. Пришлите сумму ещё раз.');
      return;
    }
    const sent = await sendWorkbookToUser(ctx.from.id, calcAll(inputs, params));
    if (!sent.ok) await ctx.reply(`Не удалось отправить файл: ${sent.error}`);
  });
}

/** Проверка доступа. Импорт отложенный — иначе получится кольцо bot ↔ access. */
async function isAllowed(userId?: number): Promise<{ ok: boolean; reason?: string }> {
  if (!userId) return { ok: false, reason: 'Не могу определить, кто вы.' };
  const { checkAccess } = await import('./access');
  return checkAccess(userId);
}

/** Достаёт суммы из отправленной ботом карточки результата («Пополнение 706 945,00»). */
function extractAmountsFromResultMessage(text: string): string[] {
  const matches = [...text.matchAll(/Пополнение ([\d\s  ]+(?:[.,]\d+)?)/g)];
  return matches.map((m) => m[1].trim());
}
