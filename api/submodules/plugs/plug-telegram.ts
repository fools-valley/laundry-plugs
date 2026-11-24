import { and, eq, isNotNull, lt, sql } from 'drizzle-orm';
import { db, plugInPlugs } from '@laundry-plugs/database/src/db';
import log from 'loglevel';
import { z } from 'zod/v4';
import { offlineAfterMilliseconds } from './plug-status';

const telegramResponseSchema = z.object({ ok: z.boolean(), description: z.string().optional() });

export function startTelegramAvailabilityCheck() {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  const chatId = process.env.TELEGRAM_CHAT_ID;
  const topicId = Number(process.env.TELEGRAM_TOPIC_ID);
  if (!token || !chatId || !Number.isSafeInteger(topicId) || topicId < 1) {
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

          const response = await fetch(`https://api.telegram.org/bot${token}/editMessageText`, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({
              chat_id: chatId,
              message_id: message.messageId,
              text: `⚪ ${message.displayName} · Offline`,
            }),
            signal: AbortSignal.timeout(5000),
          });
          const result = telegramResponseSchema.parse(await response.json());
          const alreadyUnavailable = response.status === 400 && result.description?.includes('message is not modified');
          const deleted =
            response.status === 400 &&
            ['message to edit not found', 'MESSAGE_ID_INVALID'].some((reason) => result.description?.includes(reason));
          if (!result.ok && !alreadyUnavailable && !deleted)
            throw new Error(`Telegram returned HTTP ${response.status}`);
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
