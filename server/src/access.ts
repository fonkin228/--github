/**
 * Кто пускается к общей базе.
 *
 * Основное правило: человек должен состоять в одном из чатов, куда добавлен бот.
 * Список таких чатов ведётся автоматически — бот записывает группу, когда его
 * туда добавляют. Отдельно можно разрешить конкретные Telegram ID.
 */
import { bot } from './bot';
import { config } from './config';
import { listChats } from './db';

const ALLOWED_STATUSES = new Set(['creator', 'administrator', 'member', 'restricted']);
const CACHE_TTL_MS = 5 * 60 * 1000;

const cache = new Map<number, { allowed: boolean; until: number }>();

export interface AccessDecision {
  ok: boolean;
  reason?: string;
}

/** true, когда ограничивать некого: бот ещё не добавлен в группы и списка нет. */
export function accessIsOpen(): boolean {
  return listChats().length === 0 && config.allowedUserIds.length === 0 && !config.ownerId;
}

export async function checkAccess(userId: number): Promise<AccessDecision> {
  if (config.ownerId && userId === config.ownerId) return { ok: true };
  if (config.allowedUserIds.includes(userId)) return { ok: true };

  const chats = listChats();
  if (chats.length === 0) {
    // Пока бот не добавлен ни в одну группу, ограничивать не по чему.
    return accessIsOpen()
      ? { ok: true }
      : { ok: false, reason: 'Доступ выдаётся участникам группы, а бот пока ни в одну не добавлен.' };
  }
  if (!bot) return { ok: false, reason: 'Бот не настроен — проверить членство в группе нечем.' };

  const cached = cache.get(userId);
  if (cached && cached.until > Date.now()) {
    return cached.allowed ? { ok: true } : { ok: false, reason: DENIED };
  }

  for (const chat of chats) {
    try {
      const member = await bot.api.getChatMember(chat.chat_id, userId);
      if (ALLOWED_STATUSES.has(member.status)) {
        cache.set(userId, { allowed: true, until: Date.now() + CACHE_TTL_MS });
        return { ok: true };
      }
    } catch {
      // Пользователя нет в этом чате либо чат недоступен — пробуем следующий.
    }
  }

  cache.set(userId, { allowed: false, until: Date.now() + CACHE_TTL_MS });
  return { ok: false, reason: DENIED };
}

const DENIED =
  'Доступ к общей базе есть только у участников рабочей группы. Попросите владельца добавить вас в неё.';

/** Сбрасывает кэш — например, когда состав группы поменялся. */
export function forgetAccess(userId?: number): void {
  if (userId === undefined) cache.clear();
  else cache.delete(userId);
}
