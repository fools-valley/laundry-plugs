import log from 'loglevel';
import { checkOutages, watchedHouses, type Outage } from './outage-detection';
import { callTelegram } from '../telegram/telegram-api';
import { findChatIdsByUsername } from '../telegram/telegram-notifications';

const outageRecipients = ['AlexDaniel_42', 'almarquesmusic'];
const outageCheckMilliseconds = 10_000;
const clockFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', hour: '2-digit', minute: '2-digit' });
const dayFormat = new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Lisbon', day: 'numeric', month: 'short' });

function formatTime(timestamp: string) {
  const date = new Date(timestamp);
  const day = dayFormat.format(date);
  return day === dayFormat.format(new Date()) ? clockFormat.format(date) : `${day}, ${clockFormat.format(date)}`;
}

function formatDuration(from: string, to: string) {
  const totalMinutes = Math.max(1, Math.round((Date.parse(to) - Date.parse(from)) / 60_000));
  const hours = Math.floor(totalMinutes / 60);
  const minutes = totalMinutes % 60;
  const parts = [
    hours ? `${hours} ${hours === 1 ? 'hour' : 'hours'}` : '',
    minutes ? `${minutes} ${minutes === 1 ? 'minute' : 'minutes'}` : '',
  ];
  return parts.filter(Boolean).join(' ');
}

function describeRestoration(outage: Outage, houseName: string, restoredAt: string) {
  const wentQuietAt = formatTime(outage.lastSeenAt);
  switch (outage.cause) {
    case 'power_cut': {
      const poweredOnAt = outage.poweredOnAt ?? restoredAt;
      return `💡 Power is back in the ${houseName}. It went out after ${wentQuietAt} and came back around ${formatTime(poweredOnAt)} (${formatDuration(outage.lastSeenAt, poweredOnAt)}).`;
    }
    case 'network_outage':
      return `📶 The ${houseName} is back online. Its network was down from ${wentQuietAt} to ${formatTime(restoredAt)} (${formatDuration(outage.lastSeenAt, restoredAt)}), but the power stayed on.`;
    case null:
      return `✅ The ${houseName} is reporting again since ${formatTime(restoredAt)}, after going quiet at ${wentQuietAt} (${formatDuration(outage.lastSeenAt, restoredAt)}). I could not tell whether it was a power cut or the network.`;
    default: {
      const unexpectedCause: never = outage.cause;
      throw new Error(`Unexpected outage cause ${unexpectedCause}`);
    }
  }
}

function describeOutage(outage: Outage) {
  const houseName = watchedHouses.find(({ house }) => house === outage.house)?.name ?? outage.house;
  if (!outage.restoredAt)
    return `⚠️ Power cut or network down in the ${houseName}. Its plugs went quiet after ${formatTime(outage.lastSeenAt)}, while the other machines keep reporting.`;
  return describeRestoration(outage, houseName, outage.restoredAt);
}

export function startOutageAlerts() {
  // Outage alerts go to real people, so a local API must never send them.
  if (process.env.NODE_ENV !== 'production' || !process.env.TELEGRAM_BOT_TOKEN) {
    log.info('Outage alerts are off outside production or without TELEGRAM_BOT_TOKEN');
    return () => {};
  }

  async function announce(outage: Outage) {
    const text = describeOutage(outage);
    const chatIds = await findChatIdsByUsername(outageRecipients);
    if (!chatIds.length) log.warn('No outage recipients have used /notify yet');
    for (const chatId of chatIds) {
      try {
        await callTelegram('sendMessage', { chat_id: chatId, text });
      } catch (error) {
        log.warn('Could not send outage alert to', chatId, error);
      }
    }
  }

  let pending = false;
  const timer = setInterval(async () => {
    if (pending) return;
    pending = true;
    try {
      const { opened, restored } = await checkOutages();
      for (const outage of [...opened, ...restored]) await announce(outage);
    } catch (error) {
      log.warn('Could not check for outages', error);
    } finally {
      pending = false;
    }
  }, outageCheckMilliseconds);
  return () => clearInterval(timer);
}
