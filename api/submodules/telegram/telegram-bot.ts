import { setTimeout } from 'node:timers/promises';
import log from 'loglevel';
import { z } from 'zod/v4';
import { callTelegram } from './telegram-api';
import { listMachines } from './telegram-machines';
import { closeMachineMenus, sendMachineChoice, startMachineMenuRefresh } from './telegram-machine-menus';
import { cancelNotification, chooseMachine, getCancellationMenu, type TelegramUser } from './telegram-notifications';

const introduction =
  "I watch the laundry machines at fools' valley. Pick a machine, and I'll message you when it starts or finishes. Send /cancel to cancel the notification.";

const chatSchema = z.object({ id: z.number(), type: z.string() });
const userSchema = z
  .object({ first_name: z.string(), last_name: z.string().nullish(), username: z.string().nullish() })
  .transform(({ first_name: firstName, last_name: lastName, username }) => ({
    firstName,
    lastName: lastName ?? null,
    username: username ?? null,
  }));
const updateSchema = z.object({
  message: z.object({ chat: chatSchema, from: userSchema.optional(), text: z.string().optional() }).optional(),
  callback_query: z
    .object({
      id: z.string(),
      from: userSchema,
      data: z.string().optional(),
      message: z.object({ message_id: z.number(), chat: chatSchema }).optional(),
    })
    .optional(),
});

async function handleCallbackQuery(callbackQuery: NonNullable<z.infer<typeof updateSchema>['callback_query']>) {
  const [, action, id] = callbackQuery.data?.match(/^(notify|started|finished|cancel):([0-9a-f-]{36})$/) ?? [];
  const message = callbackQuery.message;
  if (message?.chat.type === 'private' && action === 'cancel' && id) {
    await callTelegram('editMessageText', {
      chat_id: message.chat.id,
      message_id: message.message_id,
      ...(await cancelNotification(message.chat.id, id)),
    });
    await callTelegram('answerCallbackQuery', { callback_query_id: callbackQuery.id });
    return;
  }
  const machine =
    message?.chat.type === 'private' ? (await listMachines()).find((machine) => machine.id === id) : undefined;
  if (!message || !machine) {
    await callTelegram('answerCallbackQuery', { callback_query_id: callbackQuery.id, text: 'That machine is gone.' });
    return;
  }
  const event = action === 'started' || action === 'finished' ? action : undefined;
  await callTelegram('editMessageText', {
    chat_id: message.chat.id,
    message_id: message.message_id,
    ...(await chooseMachine(message.chat.id, callbackQuery.from, machine, event)),
  });
  await callTelegram('answerCallbackQuery', { callback_query_id: callbackQuery.id });
}

async function handleMessage(chatId: number, telegramUser: TelegramUser | undefined, text = '') {
  const [, command, argument] = text.match(/^\/(\w+)(?:@\w+)?(?:\s+(\S+))?/) ?? [];
  const machine =
    command === 'start' && argument && telegramUser
      ? (await listMachines()).find((machine) => machine.identifier === argument)
      : undefined;
  if (machine && telegramUser)
    await callTelegram('sendMessage', { chat_id: chatId, ...(await chooseMachine(chatId, telegramUser, machine)) });
  else if (command === 'notify' || (command === 'start' && argument === 'notify'))
    await sendMachineChoice(chatId, 'Which machine should I watch?');
  else if (command === 'cancel')
    await callTelegram('sendMessage', { chat_id: chatId, ...(await getCancellationMenu(chatId)) });
  else await sendMachineChoice(chatId, introduction);
}

async function handleUpdate(update: unknown) {
  const { message, callback_query: callbackQuery } = updateSchema.parse(update);
  const chat = message?.chat ?? callbackQuery?.message?.chat;
  if (chat?.type === 'private') await closeMachineMenus(chat.id);
  if (message?.chat.type === 'private') await handleMessage(message.chat.id, message.from, message.text);
  if (callbackQuery) await handleCallbackQuery(callbackQuery);
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
    commands: [
      { command: 'notify', description: 'Message me when a machine starts or finishes' },
      { command: 'cancel', description: 'Cancel a notification' },
    ],
    scope: { type: 'all_private_chats' },
  }).catch((error) => log.warn('Could not set Telegram bot commands', error));
  pollUpdates().catch((error) => log.error('Telegram bot stopped', error));

  const stopMachineMenuRefresh = startMachineMenuRefresh();
  return () => {
    stopped = true;
    stopMachineMenuRefresh();
  };
}
