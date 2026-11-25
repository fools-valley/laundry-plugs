import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import log from 'loglevel';
import { db, plugInPlugs } from '@laundry-plugs/database/src/db';
import { offlineAfterMilliseconds } from '../plugs/plug-status';
import { callTelegram, TelegramError } from './telegram-api';

export function startTelegramAvailabilityCheck() {
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const topicId = Number(process.env.TELEGRAM_TOPIC_ID);
  if (!process.env.TELEGRAM_BOT_TOKEN || !chatId || !Number.isSafeInteger(topicId) || topicId < 1) {
    log.warn('Telegram offline edits are off: set TELEGRAM_BOT_TOKEN, TELEGRAM_CHAT_ID and TELEGRAM_TOPIC_ID');
    return () => {};
  }

  const offline = and(
    lt(plugInPlugs.lastReadingAt, sql`now() - ${offlineAfterMilliseconds} * interval '1 millisecond'`),
    isNotNull(plugInPlugs.telegramMessage),
    eq(plugInPlugs.telegramUnavailable, false)
  );

  async function checkOfflinePlugs() {
    const plugs = await db.select({ id: plugInPlugs.id }).from(plugInPlugs).where(offline);
    for (const { id } of plugs) {
      try {
        await db.transaction(async (transaction) => {
          const [plug] = await transaction
            .select({ message: plugInPlugs.telegramMessage })
            .from(plugInPlugs)
            .where(and(eq(plugInPlugs.id, id), offline))
            .for('update', { skipLocked: true });
          const message = plug?.message;
          if (!message || message.chatId !== chatId || message.topicId !== topicId) return;

          let deleted = false;
          try {
            await callTelegram('editMessageText', {
              chat_id: chatId,
              message_id: message.messageId,
              text: `⚪ ${message.displayName} · Offline`,
            });
          } catch (error) {
            if (!(error instanceof TelegramError && error.status === 400)) throw error;
            deleted = ['message to edit not found', 'MESSAGE_ID_INVALID'].some((reason) =>
              error.description.includes(reason)
            );
            if (!deleted && !error.description.includes('message is not modified')) throw error;
          }
          await transaction
            .update(plugInPlugs)
            .set(deleted ? { telegramMessage: null } : { telegramUnavailable: true })
            .where(eq(plugInPlugs.id, id));
        });
      } catch {
        log.warn('Could not update Telegram availability for plug', id);
      }
    }
  }

  let pending = false;
  const timer = setInterval(async () => {
    if (pending) return;
    pending = true;
    try {
      await checkOfflinePlugs();
    } catch (error) {
      log.warn('Could not check plug availability', error);
    } finally {
      pending = false;
    }
  }, 60_000);
  return () => clearInterval(timer);
}
