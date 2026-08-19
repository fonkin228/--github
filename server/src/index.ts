import Fastify from 'fastify';
import cors from '@fastify/cors';
import fastifyStatic from '@fastify/static';
import fs from 'node:fs';
import path from 'node:path';
import { webhookCallback } from 'grammy';
import { assertProductionSafety, config } from './config';
import { bot, registerBotHandlers } from './bot';
import { registerRoutes } from './routes';

const app = Fastify({
  logger: { level: config.isProduction ? 'info' : 'debug' },
  bodyLimit: 2 * 1024 * 1024,
});

async function main(): Promise<void> {
  assertProductionSafety((msg) => app.log.warn(msg));

  // Mini App и API живут на одном домене, но в dev фронт крутится на 5173.
  await app.register(cors, { origin: config.isProduction ? false : true });

  await registerRoutes(app);

  // --- Бот ----------------------------------------------------------------
  if (bot && config.botMode !== 'off') {
    registerBotHandlers();
    if (config.botMode === 'webhook') {
      const secretPath = `/telegram/${config.webhookSecret || 'webhook'}`;
      app.post(secretPath, webhookCallback(bot, 'fastify'));

      // Прописываем адрес вебхука сами — иначе Telegram не знает, куда слать обновления.
      const base = (config.publicUrl || config.webAppUrl).replace(/\/+$/, '');
      if (/^https:\/\//.test(base)) {
        try {
          await bot.api.setWebhook(`${base}${secretPath}`, { drop_pending_updates: false });
          app.log.info(`Вебхук зарегистрирован: ${base}${secretPath}`);
        } catch (error) {
          app.log.error({ error }, 'Не удалось зарегистрировать вебхук');
        }
      } else {
        app.log.warn('PUBLIC_URL/WEBAPP_URL не https — вебхук не зарегистрирован, сделайте это вручную.');
      }
      app.log.info(`Бот в режиме webhook, путь ${secretPath}`);
    } else {
      void bot.start({
        onStart: (info) => app.log.info(`Бот запущен в режиме polling: @${info.username}`),
      });
    }
  } else {
    app.log.warn('Бот не запущен (нет BOT_TOKEN или BOT_MODE=off) — Mini App работает автономно.');
  }

  // --- Статика Mini App ---------------------------------------------------
  const webDist = path.resolve(__dirname, '../../web/dist');
  if (fs.existsSync(webDist)) {
    await app.register(fastifyStatic, { root: webDist, prefix: '/' });
    app.setNotFoundHandler((request, reply) => {
      if (request.url.startsWith('/api/')) return reply.code(404).send({ error: 'Не найдено' });
      return reply.sendFile('index.html');
    });
    app.log.info(`Отдаю собранный Mini App из ${webDist}`);
  } else {
    app.log.warn('web/dist не найден — соберите фронт (npm run build) или запустите vite отдельно.');
  }

  await app.listen({ port: config.port, host: config.host });
}

main().catch((error) => {
  app.log.error(error);
  process.exit(1);
});

const shutdown = async (signal: string): Promise<void> => {
  app.log.info(`${signal}: останавливаюсь`);
  try {
    if (bot && config.botMode === 'polling') await bot.stop();
    await app.close();
  } finally {
    process.exit(0);
  }
};
process.on('SIGINT', () => void shutdown('SIGINT'));
process.on('SIGTERM', () => void shutdown('SIGTERM'));
