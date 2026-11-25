import { and, count, eq, gte, isNull, sql } from 'drizzle-orm';
import log from 'loglevel';
import { db, notificationEventInPlugs, notificationInPlugs, plugInPlugs } from '@laundry-plugs/database/src/db';
import { cyclePauseMilliseconds } from '../plugs/plug-status';
import { callTelegram, TelegramError } from './telegram-api';
import { describeMachine, getDisplayName, listMachines, type Machine } from './telegram-machines';

const dailyNotificationLimit = 1000;

const pendingNotification = sql`${isNull(notificationInPlugs.notifiedAt)} and ${isNull(notificationInPlugs.cancelledAt)}`;

type NotificationEvent = (typeof notificationEventInPlugs.enumValues)[number];
export type TelegramUser = NonNullable<(typeof notificationInPlugs.$inferInsert)['telegramUser']>;

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

export async function getCancellationMenu(chatId: number, heading?: string) {
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

export async function cancelNotification(chatId: number, notificationId: string) {
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

export async function chooseMachine(
  chatId: number,
  telegramUser: TelegramUser,
  machine: Machine,
  event?: NotificationEvent
) {
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
