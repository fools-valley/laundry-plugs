import { setTimeout } from 'node:timers/promises';
import { and, desc, eq, inArray, isNull, sql } from 'drizzle-orm';
import log from 'loglevel';
import { z } from 'zod/v4';
import { db, machineMenuInPlugs } from '@laundry-plugs/database/src/db';
import { callTelegram, TelegramError } from './telegram-api';
import { getMachineKeyboard, listMachines } from './telegram-machines';

const machineMenuRefreshMilliseconds = 60 * 1000;
const liveMachineMenuLimit = 50;
// Spreading a full round over most of the minute keeps edits far below Telegram's limits and leaves slack before the next round.
const machineMenuEditSpacingMilliseconds = (machineMenuRefreshMilliseconds * 0.8) / liveMachineMenuLimit;
let telegramRetryAt = 0;
let menuRefreshEnabled = false;
let menuRefreshRunning = false;
let menuRefreshRequested = false;
let lastStatusSignature: string | undefined;

export async function sendMachineChoice(chatId: number, question: string) {
  const machines = await listMachines();
  const keyboard = getMachineKeyboard(machines);
  const message = z.object({ message_id: z.number() }).parse(
    await callTelegram('sendMessage', {
      chat_id: chatId,
      text: machines.length ? question : 'No machines have reported yet.',
      reply_markup: { inline_keyboard: keyboard },
    })
  );
  if (!machines.length) return;
  await db.insert(machineMenuInPlugs).values({
    telegramChatId: String(chatId),
    telegramMessageId: message.message_id,
    buttonLabels: keyboard.flat().map((button) => button.text),
  });
}

export async function closeMachineMenus(chatId: number) {
  await db
    .update(machineMenuInPlugs)
    .set({ closedAt: sql`now()` })
    .where(and(eq(machineMenuInPlugs.telegramChatId, String(chatId)), isNull(machineMenuInPlugs.closedAt)));
}

async function refreshMachineMenu(menuId: string, keyboard: ReturnType<typeof getMachineKeyboard>) {
  const buttonLabels = keyboard.flat().map((button) => button.text);
  return db.transaction(async (transaction) => {
    // The lock makes a button tap, which closes the menu first, wait for this edit instead of being overwritten by it.
    const [menu] = await transaction
      .select({
        telegramChatId: machineMenuInPlugs.telegramChatId,
        telegramMessageId: machineMenuInPlugs.telegramMessageId,
        buttonLabels: machineMenuInPlugs.buttonLabels,
      })
      .from(machineMenuInPlugs)
      .where(and(eq(machineMenuInPlugs.id, menuId), isNull(machineMenuInPlugs.closedAt)))
      .for('update', { skipLocked: true });
    if (!menu || menu.buttonLabels.join('\n') === buttonLabels.join('\n')) return false;
    let closed = false;
    try {
      await callTelegram('editMessageReplyMarkup', {
        chat_id: menu.telegramChatId,
        message_id: menu.telegramMessageId,
        reply_markup: { inline_keyboard: keyboard },
      });
    } catch (error) {
      if (!(error instanceof TelegramError) || error.status === 429) throw error;
      closed = !error.description.includes('message is not modified');
      if (closed) log.info('Closing machine menu that Telegram would not edit', menuId, error.description);
    }
    await transaction
      .update(machineMenuInPlugs)
      .set(closed ? { closedAt: sql`now()` } : { buttonLabels })
      .where(eq(machineMenuInPlugs.id, menuId));
    return true;
  });
}

async function refreshMachineMenus() {
  const openMenus = await db
    .select({ id: machineMenuInPlugs.id })
    .from(machineMenuInPlugs)
    .where(isNull(machineMenuInPlugs.closedAt))
    .orderBy(desc(machineMenuInPlugs.createdAt));
  const menus = openMenus.slice(0, liveMachineMenuLimit);
  const staleMenuIds = openMenus.slice(liveMachineMenuLimit).map((menu) => menu.id);
  if (staleMenuIds.length)
    await db
      .update(machineMenuInPlugs)
      .set({ closedAt: sql`now()` })
      .where(and(inArray(machineMenuInPlugs.id, staleMenuIds), isNull(machineMenuInPlugs.closedAt)));
  if (!menus.length) return;
  const keyboard = getMachineKeyboard(await listMachines());
  for (const { id } of menus) {
    if (menuRefreshRequested) return;
    try {
      if (await refreshMachineMenu(id, keyboard)) await setTimeout(machineMenuEditSpacingMilliseconds);
    } catch (error) {
      if (error instanceof TelegramError && error.status === 429) {
        telegramRetryAt = Date.now() + (error.retryAfterSeconds ?? 60) * 1000;
        log.warn('Telegram rate limit reached; pausing machine menu updates', error.retryAfterSeconds);
        return;
      }
      log.warn('Could not refresh machine menu', id, error);
    }
  }
}

// A request made during a round restarts it from the newest menu with fresh labels.
async function runMachineMenuRefresh() {
  if (menuRefreshRunning) {
    menuRefreshRequested = true;
    return;
  }
  menuRefreshRunning = true;
  try {
    do {
      menuRefreshRequested = false;
      if (Date.now() < telegramRetryAt) break;
      await refreshMachineMenus();
    } while (menuRefreshRequested);
  } catch (error) {
    log.warn('Could not refresh machine menus', error);
  } finally {
    menuRefreshRunning = false;
  }
}

export async function refreshMachineMenusOnStatusChange() {
  if (!menuRefreshEnabled) return;
  const statusSignature = (await listMachines()).map((machine) => `${machine.id}:${machine.status}`).join(' ');
  if (statusSignature === lastStatusSignature) return;
  lastStatusSignature = statusSignature;
  await runMachineMenuRefresh();
}

export function startMachineMenuRefresh() {
  menuRefreshEnabled = true;
  const timer = setInterval(runMachineMenuRefresh, machineMenuRefreshMilliseconds);
  return () => {
    menuRefreshEnabled = false;
    clearInterval(timer);
  };
}
