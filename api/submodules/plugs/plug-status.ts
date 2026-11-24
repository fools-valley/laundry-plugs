import { between, gte, sql } from 'drizzle-orm';
import { db, type Reading } from '@laundry-plugs/database/src/db';

const minuteMilliseconds = 60 * 1000;
const cyclePauseMilliseconds = 3 * minuteMilliseconds;
const minimumCycleMilliseconds = 3 * minuteMilliseconds;
export const offlineAfterMilliseconds = 5 * minuteMilliseconds;
const finishedForMilliseconds = 2 * 60 * minuteMilliseconds;
const usageDayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon', dateStyle: 'short' });

type Cycle = { startedAt: number; endedAt: number };
type Use = { identifier: string; startedAt: string; endedAt: string };

function findCycles(readings: Pick<Reading, 'createdAt' | 'powerActivity'>[]) {
  const cycles: Cycle[] = [];
  for (const reading of readings) {
    const activity = reading.powerActivity;
    if (!activity || activity === 'quiet') continue;
    const at = Date.parse(reading.createdAt);
    const startedAt = at - activity.firstAgeSeconds * 1000;
    const endedAt = at - activity.lastAgeSeconds * 1000;
    const lastCycle = cycles.at(-1);
    if (lastCycle && startedAt - lastCycle.endedAt < cyclePauseMilliseconds)
      lastCycle.endedAt = Math.max(lastCycle.endedAt, endedAt);
    else cycles.push({ startedAt, endedAt });
  }
  return cycles;
}

function determineStatus(
  isOnline: boolean,
  runningCycle: Cycle | undefined,
  lastUsedAt: number | undefined,
  now: number
): 'offline' | 'running' | 'finished' | 'idle' {
  if (!isOnline) return 'offline';
  if (runningCycle) return 'running';
  if (lastUsedAt && now - lastUsedAt <= finishedForMilliseconds) return 'finished';
  return 'idle';
}

export async function listPlugStatuses() {
  const plugs = await db.query.plugInPlugs.findMany({
    columns: { identifier: true, lastReadingAt: true },
    orderBy: { identifier: 'asc' },
    with: {
      latestReadings: { columns: { powerWatts: true }, orderBy: { createdAt: 'desc' }, limit: 1 },
      readings: {
        columns: { createdAt: true, powerActivity: true },
        where: {
          powerActivity: { ne: 'quiet' },
          RAW: (reading) => gte(reading.createdAt, sql`now() - interval '24 hours'`),
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  const now = Date.now();
  const plugStatuses = plugs.map((plug) => {
    const lastReadingAt = plug.lastReadingAt ? Date.parse(plug.lastReadingAt) : undefined;
    const isOnline = lastReadingAt !== undefined && now - lastReadingAt <= offlineAfterMilliseconds;
    const cycles = findCycles(plug.readings);
    const lastCycle = cycles.at(-1);
    // A cycle counts as over only once a reading confirms the quiet minutes, so missed readings never end it early.
    const runningCycle =
      isOnline && lastCycle && lastReadingAt - lastCycle.endedAt < cyclePauseMilliseconds ? lastCycle : undefined;
    const lastUsedAt = cycles.findLast(
      (cycle) => cycle !== runningCycle && cycle.endedAt - cycle.startedAt >= minimumCycleMilliseconds
    )?.endedAt;
    return {
      identifier: plug.identifier,
      status: determineStatus(isOnline, runningCycle, lastUsedAt, now),
      lastReadingAt: lastReadingAt === undefined ? null : new Date(lastReadingAt).toISOString(),
      lastPowerWatts: plug.latestReadings[0]?.powerWatts ?? null,
      cycleStartedAt: runningCycle ? new Date(runningCycle.startedAt).toISOString() : null,
      lastUsedAt: lastUsedAt === undefined ? null : new Date(lastUsedAt).toISOString(),
    };
  });
  return { plugs: plugStatuses };
}

export async function listPlugUsage(ending: string) {
  const days = Array.from({ length: 7 }, (_, index): { date: string; uses: Use[] } => {
    const date = new Date(ending);
    date.setUTCDate(date.getUTCDate() + index - 6);
    return { date: date.toISOString().slice(0, 10), uses: [] };
  });
  const usesByDate = new Map(days.map((day) => [day.date, day.uses]));

  const plugs = await db.query.plugInPlugs.findMany({
    columns: { identifier: true },
    with: {
      readings: {
        columns: { createdAt: true, powerActivity: true },
        where: {
          powerActivity: { ne: 'quiet' },
          RAW: (reading) =>
            between(
              reading.createdAt,
              sql`((${ending}::date - 6)::timestamp AT TIME ZONE 'Europe/Lisbon') - interval '24 hours'`,
              sql`((${ending}::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon') + ${cyclePauseMilliseconds + minuteMilliseconds} * interval '1 millisecond'`
            ),
        },
        orderBy: { createdAt: 'asc' },
      },
    },
  });

  const now = Date.now();
  for (const plug of plugs) {
    for (const cycle of findCycles(plug.readings)) {
      if (cycle.endedAt - cycle.startedAt < minimumCycleMilliseconds || now - cycle.endedAt < cyclePauseMilliseconds)
        continue;
      usesByDate.get(usageDayFormat.format(cycle.endedAt))?.push({
        identifier: plug.identifier,
        startedAt: new Date(cycle.startedAt).toISOString(),
        endedAt: new Date(cycle.endedAt).toISOString(),
      });
    }
  }
  for (const day of days) day.uses.sort((first, second) => second.endedAt.localeCompare(first.endedAt));
  return { days };
}
