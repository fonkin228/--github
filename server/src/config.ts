import dotenv from 'dotenv';
import path from 'node:path';

// .env ищем и в папке server, и в корне репозитория — удобнее держать один файл в корне.
dotenv.config({ path: path.resolve(__dirname, '../.env') });
dotenv.config({ path: path.resolve(__dirname, '../../.env') });

const bool = (value: string | undefined, fallback = false): boolean => {
  if (value === undefined) return fallback;
  return ['1', 'true', 'yes', 'on'].includes(value.trim().toLowerCase());
};

export const config = {
  /** Токен от @BotFather. Без него бот не стартует, но API и Mini App работают. */
  botToken: process.env.BOT_TOKEN?.trim() ?? '',
  /** Публичный https-URL Mini App (его же вписываем в BotFather). */
  webAppUrl: process.env.WEBAPP_URL?.trim() ?? '',
  port: Number(process.env.PORT ?? 3000),
  host: process.env.HOST ?? '0.0.0.0',
  dbPath: process.env.DATABASE_PATH
    ? path.resolve(process.env.DATABASE_PATH)
    : path.resolve(__dirname, '../../data/app.db'),
  /** polling — для локальной разработки, webhook — для прода. */
  botMode: (process.env.BOT_MODE ?? 'polling') as 'polling' | 'webhook' | 'off',
  webhookSecret: process.env.WEBHOOK_SECRET ?? '',
  /**
   * Разрешить работу без валидного Telegram initData (открытие в обычном браузере).
   * ОБЯЗАТЕЛЬНО false в проде.
   */
  allowDevAuth: bool(process.env.ALLOW_DEV_AUTH, process.env.NODE_ENV !== 'production'),
  /** Максимальный возраст initData в секундах. */
  initDataMaxAgeSec: Number(process.env.INIT_DATA_MAX_AGE ?? 86400),
  /** Ограничение на размер пакета сумм за один расчёт. */
  maxRowsPerCalc: Number(process.env.MAX_ROWS ?? 1000),
  /**
   * Прямая ссылка на Mini App вида https://t.me/имя_бота/имя_приложения.
   * Нужна для групп: инлайн-кнопки web_app там не работают, а ссылка работает.
   */
  miniAppLink: process.env.MINIAPP_LINK?.trim() ?? '',
  /** Публичный адрес сервера — на него Telegram шлёт вебхук. Обычно совпадает с WEBAPP_URL. */
  publicUrl: process.env.PUBLIC_URL?.trim() ?? '',
  /** Telegram ID владельца — ему доступ есть всегда. */
  ownerId: Number(process.env.OWNER_ID ?? 0) || 0,
  /** Дополнительные Telegram ID через запятую, помимо участников группы. */
  allowedUserIds: (process.env.ALLOWED_USERS ?? '')
    .split(',')
    .map((v) => Number(v.trim()))
    .filter((v) => Number.isFinite(v) && v > 0),
  isProduction: process.env.NODE_ENV === 'production',
};

export function assertProductionSafety(log: (msg: string) => void): void {
  if (config.isProduction && config.allowDevAuth) {
    log('ВНИМАНИЕ: ALLOW_DEV_AUTH=true в production — авторизация Telegram фактически отключена.');
  }
  if (!config.botToken) {
    log('BOT_TOKEN не задан: бот выключен, проверка initData работает только в dev-режиме.');
  }
}
