import { setTimeout } from 'node:timers/promises';
import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';
import log from 'loglevel';
import { z } from 'zod/v4';
import {
  db,
  notificationEventInPlugs,
  notificationInPlugs,
  plugInPlugs,
  type Plug,
} from '@laundry-plugs/database/src/db';
import { callTelegram, TelegramError } from './plug-telegram';
import { cyclePauseMilliseconds, listPlugStatuses } from './plug-status';

const dailyNotificationLimit = 1000;

const introduction =
  "I watch the laundry machines at fools' valley. Send /notify and pick a machine, and I'll message you when it starts or finishes. Send /cancel to stop one.";

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

const pendingNotification = sql`${isNull(notificationInPlugs.notifiedAt)} and ${isNull(notificationInPlugs.cancelledAt)}`;

function getDisplayName(plug: Pick<Plug, 'identifier' | 'telegramMessage'>) {
  return plug.telegramMessage?.displayName ?? plug.identifier.replaceAll('-', ' ');
}

async function listMachines() {
  const [{ plugs: plugStatuses }, plugs] = await Promise.all([
    listPlugStatuses(),
    db
      .select({ id: plugInPlugs.id, identifier: plugInPlugs.identifier, telegramMessage: plugInPlugs.telegramMessage })
      .from(plugInPlugs)
      .orderBy(plugInPlugs.createdAt, plugInPlugs.identifier),
  ]);
  const statuses = new Map(plugStatuses.map((plugStatus) => [plugStatus.identifier, plugStatus]));
  return plugs.map((plug) => {
    const plugStatus = statuses.get(plug.identifier);
    return {
      id: plug.id,
      identifier: plug.identifier,
      displayName: getDisplayName(plug),
      status: plugStatus?.status ?? 'offline',
      cycleStartedAt: plugStatus?.cycleStartedAt ?? null,
      lastUsedAt: plugStatus?.lastUsedAt ?? null,
    };
  });
}

type Machine = Awaited<ReturnType<typeof listMachines>>[number];
type NotificationEvent = (typeof notificationEventInPlugs.enumValues)[number];

function describeMachine({ displayName, status, cycleStartedAt }: Machine) {
  switch (status) {
    case 'offline':
      return `⚪ ${displayName} · Offline`;
    case 'running': {
      const elapsedMinutes = cycleStartedAt ? Math.floor((Date.now() - Date.parse(cycleStartedAt)) / 60_000) : 0;
      if (elapsedMinutes < 1) return `🔴 ${displayName} · In use (for less than a minute)`;
      return `🔴 ${displayName} · In use (for ${elapsedMinutes} ${elapsedMinutes === 1 ? 'minute' : 'minutes'})`;
    }
    case 'finished':
    case 'idle':
      return `🟢 ${displayName} · Available`;
    default: {
      const unexpectedStatus: never = status;
      throw new Error(`Unexpected plug status ${unexpectedStatus}`);
    }
  }
}

async function sendIntroduction(chatId: number) {
  const machines = await listMachines();
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: [introduction, machines.map(describeMachine).join('\n')].filter(Boolean).join('\n\n'),
  });
}

async function sendMachineChoice(chatId: number) {
  const machines = await listMachines();
  await callTelegram('sendMessage', {
    chat_id: chatId,
    text: machines.length ? 'Which machine should I watch?' : 'No machines have reported yet.',
    reply_markup: {
      inline_keyboard: machines.map((machine) => [
        { text: describeMachine(machine), callback_data: `notify:${machine.id}` },
      ]),
    },
  });
}

type TelegramUser = z.infer<typeof userSchema>;

async function requestNotification(
  chatId: number,
  telegramUser: TelegramUser,
  machine: Machine,
  event: NotificationEvent
) {
  const telegramChatId = String(chatId);
  const withinLimit = await db.transaction(async (transaction) => {
    // Rows that do not exist yet cannot be locked, so serialize each person's requests to keep the count exact.
    await transaction.execute(sql`select pg_advisory_xact_lock(hashtext(${telegramChatId}))`);
    const [requests] = await transaction
      .select({ count: count() })
      .from(notificationInPlugs)
      .where(
        and(
          eq(notificationInPlugs.telegramChatId, telegramChatId),
          gte(notificationInPlugs.createdAt, sql`now() - interval '1 day'`)
        )
      );
    if ((requests?.count ?? 0) >= dailyNotificationLimit) return false;
    await transaction
      .insert(notificationInPlugs)
      .values({ plugId: machine.id, telegramChatId, event, telegramUser })
      .onConflictDoUpdate({
        target: [notificationInPlugs.plugId, notificationInPlugs.telegramChatId, notificationInPlugs.event],
        targetWhere: pendingNotification,
        set: { telegramUser },
      });
    return true;
  });
  if (!withinLimit) return { text: "That's too many notifications for one day. Try again tomorrow." };
  return {
    text: `I'll message you when ${describeEvent(machine.displayName, event)}. You can also /cancel the notification.\n\nYour name shows on the website while you wait.`,
  };
}

function describeEvent(displayName: string, event: NotificationEvent) {
  return `${displayName} ${event === 'started' ? 'is in use' : 'finishes'}`;
}

async function getCancellationMenu(chatId: number, heading?: string) {
  const notifications = await db
    .select({
      id: notificationInPlugs.id,
      event: notificationInPlugs.event,
      identifier: plugInPlugs.identifier,
      telegramMessage: plugInPlugs.telegramMessage,
    })
    .from(notificationInPlugs)
    .innerJoin(plugInPlugs, eq(plugInPlugs.id, notificationInPlugs.plugId))
    .where(and(eq(notificationInPlugs.telegramChatId, String(chatId)), pendingNotification))
    .orderBy(notificationInPlugs.createdAt);
  const question = notifications.length ? 'Which notification should I cancel?' : 'No notifications are waiting.';
  return {
    text: heading ? `${heading}\n\n${question}` : question,
    reply_markup: {
      inline_keyboard: notifications.map((notification) => [
        {
          text: `✕ ${describeEvent(getDisplayName(notification), notification.event)}`,
          callback_data: `cancel:${notification.id}`,
        },
      ]),
    },
  };
}

async function cancelNotification(chatId: number, notificationId: string) {
  const [cancelledNotification] = await db
    .update(notificationInPlugs)
    .set({ cancelledAt: sql`now()` })
    .where(
      and(
        eq(notificationInPlugs.id, notificationId),
        eq(notificationInPlugs.telegramChatId, String(chatId)),
        pendingNotification
      )
    )
    .returning({ plugId: notificationInPlugs.plugId, event: notificationInPlugs.event });
  const plug = cancelledNotification
    ? await db.query.plugInPlugs.findFirst({
        columns: { identifier: true, telegramMessage: true },
        where: { id: cancelledNotification.plugId },
      })
    : undefined;
  return getCancellationMenu(
    chatId,
    cancelledNotification && plug
      ? `Cancelled. I won't message you when ${describeEvent(getDisplayName(plug), cancelledNotification.event)}.`
      : 'That notification was already sent or cancelled.'
  );
}

async function chooseMachine(chatId: number, telegramUser: TelegramUser, machine: Machine, event?: NotificationEvent) {
  if (event || machine.status === 'running')
    return requestNotification(chatId, telegramUser, machine, event ?? 'finished');
  return {
    text: `${describeMachine(machine)}\nWhen should I message you?`,
    reply_markup: {
      inline_keyboard: [
        [{ text: 'When it is in use', callback_data: `started:${machine.id}` }],
        [{ text: 'When it is available again', callback_data: `finished:${machine.id}` }],
      ],
    },
  };
}

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
  else if (command === 'notify' || (command === 'start' && argument === 'notify')) await sendMachineChoice(chatId);
  else if (command === 'cancel')
    await callTelegram('sendMessage', { chat_id: chatId, ...(await getCancellationMenu(chatId)) });
  else await sendIntroduction(chatId);
}

async function handleUpdate(update: unknown) {
  const { message, callback_query: callbackQuery } = updateSchema.parse(update);
  if (message?.chat.type === 'private') await handleMessage(message.chat.id, message.from, message.text);
  if (callbackQuery) await handleCallbackQuery(callbackQuery);
}

function hasHappened(event: NotificationEvent, machine: Machine, requestedAt: string) {
  switch (event) {
    case 'started':
      return machine.status === 'running';
    case 'finished':
      // A machine shows as running through its quiet minutes, so a cycle whose last activity came shortly before the request still finished after it.
      return (
        machine.status === 'finished' &&
        machine.lastUsedAt !== null &&
        Date.parse(machine.lastUsedAt) > Date.parse(requestedAt) - cyclePauseMilliseconds
      );
    default: {
      const unexpectedEvent: never = event;
      throw new Error(`Unexpected notification event ${unexpectedEvent}`);
    }
  }
}

export async function sendNotifications(identifier: string) {
  const notifications = await db
    .select({
      id: notificationInPlugs.id,
      createdAt: notificationInPlugs.createdAt,
      telegramChatId: notificationInPlugs.telegramChatId,
      event: notificationInPlugs.event,
    })
    .from(notificationInPlugs)
    .innerJoin(plugInPlugs, eq(plugInPlugs.id, notificationInPlugs.plugId))
    .where(and(eq(plugInPlugs.identifier, identifier), pendingNotification));
  if (!notifications.length) return;
  const machine = (await listMachines()).find((machine) => machine.identifier === identifier);
  if (!machine) return;

  for (const notification of notifications) {
    if (!hasHappened(notification.event, machine, notification.createdAt)) continue;
    try {
      await db.transaction(async (transaction) => {
        const [lockedNotification] = await transaction
          .select({ id: notificationInPlugs.id })
          .from(notificationInPlugs)
          .where(and(eq(notificationInPlugs.id, notification.id), pendingNotification))
          .for('update', { skipLocked: true });
        if (!lockedNotification) return;
        try {
          await callTelegram('sendMessage', { chat_id: notification.telegramChatId, text: describeMachine(machine) });
        } catch (error) {
          // 403 means the person blocked the bot, so retrying would never succeed.
          if (!(error instanceof TelegramError && error.status === 403)) throw error;
        }
        await transaction
          .update(notificationInPlugs)
          .set({ notifiedAt: sql`now()` })
          .where(eq(notificationInPlugs.id, notification.id));
      });
    } catch (error) {
      log.warn('Could not send notification', notification.id, error);
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
    commands: [
      { command: 'notify', description: 'Message me when a machine starts or finishes' },
      { command: 'cancel', description: 'Cancel a notification' },
    ],
    scope: { type: 'all_private_chats' },
  }).catch((error) => log.warn('Could not set Telegram bot commands', error));
  pollUpdates().catch((error) => log.error('Telegram bot stopped', error));
  return () => {
    stopped = true;
  };
}
