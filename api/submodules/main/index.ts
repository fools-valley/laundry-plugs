import { serve } from '@hono/node-server';
import log from 'loglevel';
import { z } from 'zod/v4';
import { db } from '@laundry-plugs/database/src/db';
import { app } from './app';
import { startTelegramAvailabilityCheck } from '../telegram/telegram-plug-messages';
import { startTelegramBot } from '../telegram/telegram-bot';

const defaultLogLevel = process.env.NODE_ENV === 'production' ? 'warn' : 'debug';
log.setLevel(
  z.enum(['trace', 'debug', 'info', 'warn', 'error', 'silent']).catch(defaultLogLevel).parse(process.env.LOG_LEVEL)
);

const port = Number(process.env.PORT || 3041);
const server = serve({ fetch: app.fetch, port }, () => log.info(`API listening on http://localhost:${port}`));

const stopTelegramAvailabilityCheck = startTelegramAvailabilityCheck();
const stopTelegramBot = startTelegramBot();

async function shutDown() {
  stopTelegramAvailabilityCheck();
  stopTelegramBot();
  server.close();
  await db.$client.end();
  process.exit(0);
}

process.on('SIGINT', shutDown);
process.on('SIGTERM', shutDown);
