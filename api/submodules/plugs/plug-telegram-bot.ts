import { setTimeout } from 'node:timers/promises';
import { and, eq, isNull, sql } from 'drizzle-orm';
import log from 'loglevel';
import { z } from 'zod/v4';
import { db, finishNotificationInPlugs, plugInPlugs, type Plug } from '@laundry-plugs/database/src/db';
import { callTelegram, TelegramError } from './plug-telegram';
import { cyclePauseMilliseconds, listPlugStatuses } from './plug-status';

const helpText =
  "I watch the laundry machines at fools' valley. Send /notify, pick a machine, and I'll message you when it finishes.";
const statusEmojis = { offline: '⚪', running: '🔴', finished: '🟢', idle: '🟢' };

const chatSchema = z.object({ id: z.number(), type: z.string() });
const updateSchema = z.object({
  message: z.object({ chat: chatSchema, text: z.string().optional() }).optional(),
  callback_query: z
    .object({
      id: z.string(),
      data: z.string().optional(),
      message: z.object({ message_id: z.number(), chat: chatSchema }).optional(),
    })
    .optional(),
});

const pendingNotification = isNull(finishNotificationInPlugs.notifiedAt);

function getDisplayName(plug: Pick<Plug, 'identifier' | 'telegramMessage'>) {
  return plug.telegramMessage?.displayName ?? plug.identifier.replaceAll('-', ' ');
}

async function sendMachineChoice(chatId: number) {
  const [{ plugs: plugStatuses }, plugs] = await Promise.all([
    listPlugStatuses(),
    db
      .select({ id: plugInPlugs.id, identifier: plugInPlugs.identifier, telegramMessage: plugInPlugs.telegramMessage })
      .from(plugInPlugs)
      .orderBy(plugInPlugs.createdAt, plugInPlugs.identifier),
  ]);
  const statuses = new Map(plugStatuses.map((plugStatus) => [plugStatus.identifier, plugStatus.status]));
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: plugs.length ? 'Which machine should I watch?' : 'No machines have reported yet.',
    reply_markup: {
      inline_keyboard: plugs.map((plug) => [
        {
          text: `${statusEmojis[statuses.get(plug.identifier) ?? 'offline']} ${getDisplayName(plug)}`,
          callback_data: `notify:${plug.id}`,
        },
      ]),
    },
  });
}

async function handleUpdate(update: unknown) {
  const { message, callback_query: callbackQuery } = updateSchema.parse(update);
  if (message?.chat.type === 'private') {
    const command = message.text?.match(/^\/(\w+)(@\w+)?(\s|$)/)?.[1];
    if (command === 'notify') await sendMachineChoice(message.chat.id);
    else await callTelegram('sendMessage', { chat_id: message.chat.id, text: helpText });
  }
  if (!callbackQuery) return;

  const plugId = callbackQuery.data?.match(/^notify:([0-9a-f-]{36})$/)?.[1];
  const chat = callbackQuery.message?.chat;
  const plug =
    plugId && chat?.type === 'private'
      ? await db.query.plugInPlugs.findFirst({
          columns: { identifier: true, telegramMessage: true },
          where: { id: plugId },
        })
      : undefined;
  if (!plugId || !chat || !callbackQuery.message || !plug) {
    await callTelegram('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: 'That machine is gone.' });
    return;
  }
  await db
    .insert(finishNotificationInPlugs)
    .values({ plugId, telegramChatId: String(chat.id) })
    .onConflictDoNothing();
  await callTelegram('editMessageText', {
    chat_id: chat.id,
    message_id: callbackQuery.message.message_id,
    text: `I'll message you when ${getDisplayName(plug)} finishes.`,
  });
  await callTelegram('answerCallbackQuery', { callback_query_id: callbackQuery.id });
}

export async function sendFinishNotifications(identifier: string) {
  const notifications = await db
    .select({
      id: finishNotificationInPlugs.id,
      createdAt: finishNotificationInPlugs.createdAt,
      telegramChatId: finishNotificationInPlugs.telegramChatId,
      identifier: plugInPlugs.identifier,
      telegramMessage: plugInPlugs.telegramMessage,
    })
    .from(finishNotificationInPlugs)
    .innerJoin(plugInPlugs, eq(plugInPlugs.id, finishNotificationInPlugs.plugId))
    .where(and(eq(plugInPlugs.identifier, identifier), pendingNotification));
  if (!notifications.length) return;
  const plugStatus = (await listPlugStatuses()).plugs.find((plug) => plug.identifier === identifier);
  if (plugStatus?.status !== 'finished' || !plugStatus.lastUsedAt) return;
  const lastUsedAt = Date.parse(plugStatus.lastUsedAt);

  for (const notification of notifications) {
    // A machine shows as running through its quiet minutes, so a cycle whose last activity came shortly before the request still finished after it.
    if (lastUsedAt <= Date.parse(notification.createdAt) - cyclePauseMilliseconds) continue;
    try {
      await db.transaction(async (transaction) => {
        const [lockedNotification] = await transaction
          .select({ id: finishNotificationInPlugs.id })
          .from(finishNotificationInPlugs)
          .where(and(eq(finishNotificationInPlugs.id, notification.id), pendingNotification))
          .for('update', { skipLocked: true });
        if (!lockedNotification) return;
        try {
          await callTelegram('sendMessage', {
            chat_id: notification.telegramChatId,
            text: `🟢 ${getDisplayName(notification)} finished.`,
          });
        } catch (error) {
          // 403 means the person blocked the bot, so retrying would never succeed.
          if (!(error instanceof TelegramError && error.status === 403)) throw error;
        }
        await transaction
          .update(finishNotificationInPlugs)
          .set({ notifiedAt: sql`now()` })
          .where(eq(finishNotificationInPlugs.id, notification.id));
      });
    } catch (error) {
      log.warn('Could not send finish notification', notification.id, error);
    }
  }
}

export function startTelegramBot() {
  // Telegram allows one poller per bot, so a local API would steal updates from production.
  if (process.env.NODE_ENV !== 'production') {
    log.info('Telegram bot is off outside production');
    return () => {};
  }
  if (!process.env.TELEGRAM_BOT_TOKEN) {
    log.warn('Telegram bot is off: set TELEGRAM_BOT_TOKEN');
    return () => {};
  }
  let stopped = false;

  async function pollUpdates() {
    let offset = 0;
    while (!stopped) {
      try {
        const updates = z
          .array(z.looseObject({ update_id: z.number() }))
          .parse(
            await callTelegram(
              'getUpdates',
              { offset, timeout: 50, allowed_updates: ['message', 'callback_query'] },
              60_000
            )
          );
        for (const update of updates) {
          offset = update.update_id + 1;
          try {
            await handleUpdate(update);
          } catch (error) {
            log.warn('Could not handle Telegram update', update.update_id, error);
          }
        }
      } catch (error) {
        log.warn('Could not fetch Telegram updates', error);
        await setTimeout(5000);
      }
    }
  }

  callTelegram('setMyCommands', {
    commands: [{ command: 'notify', description: 'Message me when a machine finishes' }],
    scope: { type: 'all_private_chats' },
  }).catch((error) => log.warn('Could not set Telegram bot commands', error));
  pollUpdates().catch((error) => log.error('Telegram bot stopped', error));
  return () => {
    stopped = true;
  };
}
