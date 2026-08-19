import crypto from 'node:crypto';
import { config } from './config';

export interface TelegramUser {
  id: number;
  first_name?: string;
  last_name?: string;
  username?: string;
  language_code?: string;
  is_premium?: boolean;
}

export type AuthResult =
  | { ok: true; user: TelegramUser; dev: boolean }
  | { ok: false; error: string };

/**
 * Проверка подписи Telegram Web App initData.
 * secret = HMAC_SHA256(key="WebAppData", data=bot_token)
 * hash   = HMAC_SHA256(key=secret, data=data_check_string)
 * https://core.telegram.org/bots/webapps#validating-data-received-via-the-mini-app
 */
export function verifyInitData(initData: string): AuthResult {
  if (!initData) return { ok: false, error: 'initData отсутствует' };
  if (!config.botToken) return { ok: false, error: 'BOT_TOKEN не настроен на сервере' };

  let params: URLSearchParams;
  try {
    params = new URLSearchParams(initData);
  } catch {
    return { ok: false, error: 'initData не разбирается' };
  }

  const hash = params.get('hash');
  if (!hash) return { ok: false, error: 'В initData нет hash' };

  const pairs: string[] = [];
  for (const [key, value] of params.entries()) {
    if (key === 'hash' || key === 'signature') continue;
    pairs.push(`${key}=${value}`);
  }
  pairs.sort();
  const dataCheckString = pairs.join('\n');

  const secretKey = crypto.createHmac('sha256', 'WebAppData').update(config.botToken).digest();
  const computed = crypto.createHmac('sha256', secretKey).update(dataCheckString).digest('hex');

  const a = Buffer.from(computed, 'hex');
  const b = Buffer.from(hash, 'hex');
  if (a.length !== b.length || !crypto.timingSafeEqual(a, b)) {
    return { ok: false, error: 'Подпись initData не совпала' };
  }

  const authDate = Number(params.get('auth_date') ?? 0);
  if (!authDate) return { ok: false, error: 'В initData нет auth_date' };
  const ageSec = Math.floor(Date.now() / 1000) - authDate;
  if (ageSec > config.initDataMaxAgeSec) {
    return { ok: false, error: 'initData просрочен, переоткройте приложение' };
  }

  const userRaw = params.get('user');
  if (!userRaw) return { ok: false, error: 'В initData нет user' };
  try {
    const user = JSON.parse(userRaw) as TelegramUser;
    if (!user?.id) return { ok: false, error: 'В initData нет user.id' };
    return { ok: true, user, dev: false };
  } catch {
    return { ok: false, error: 'user в initData не разбирается' };
  }
}

/** Dev-пользователь для тестов из обычного браузера (только когда ALLOW_DEV_AUTH=true). */
export const DEV_USER: TelegramUser = { id: 0, first_name: 'Dev', username: 'dev' };

export function authenticate(initData: string | undefined): AuthResult {
  const verified = initData ? verifyInitData(initData) : { ok: false as const, error: 'initData отсутствует' };
  if (verified.ok) return verified;
  if (config.allowDevAuth) return { ok: true, user: DEV_USER, dev: true };
  return verified;
}
