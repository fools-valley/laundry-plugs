import { between, gte, sql } from 'drizzle-orm';
import { db, type Reading } from '@laundry-plugs/database/src/db';

const minuteMilliseconds = 60 * 1000;
const activePowerWatts = 5;
const cyclePauseMilliseconds = 3 * minuteMilliseconds;
const minimumCycleMilliseconds = 3 * minuteMilliseconds;
const longestReadingGapMilliseconds = 2 * minuteMilliseconds;
export const offlineAfterMilliseconds = 5 * minuteMilliseconds;
const finishedForMilliseconds = 2 * 60 * minuteMilliseconds;
const usageDayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon', dateStyle: 'short' });

type PowerReading = Pick<Reading, 'createdAt' | 'powerWatts' | 'powerActivity'>;
type Cycle = { startedAt: number; endedAt: number; energyWattHours: number };

function findCycles(readings: PowerReading[]) {
  const cycles: Cycle[] = [];
  let previousAt: number | undefined;
  for (const reading of readings) {
    const at = Date.parse(reading.createdAt);
    const elapsedMilliseconds = Math.min(at - (previousAt ?? at - minuteMilliseconds), longestReadingGapMilliseconds);
    previousAt = at;
    const activity = reading.powerActivity;
    if (activity === 'quiet' || (activity == null && reading.powerWatts < activePowerWatts)) continue;
    const startedAt = at - (activity?.firstAgeSeconds ?? 0) * 1000;
    const endedAt = at - (activity?.lastAgeSeconds ?? 0) * 1000;
    const energyWattHours = (reading.powerWatts * elapsedMilliseconds) / (60 * minuteMilliseconds);
    const lastCycle = cycles.at(-1);
    if (lastCycle && startedAt - lastCycle.endedAt < cyclePauseMilliseconds) {
      lastCycle.endedAt = Math.max(lastCycle.endedAt, endedAt);
      lastCycle.energyWattHours += energyWattHours;
    } else cycles.push({ startedAt, endedAt, energyWattHours });
  }
  return cycles;
}

function summarizeCycles(readings: PowerReading[], now: number) {
  const cycles = findCycles(readings);
  const lastCycle = cycles.at(-1);
  const runningCycle = lastCycle && now - lastCycle.endedAt < cyclePauseMilliseconds ? lastCycle : undefined;
  const finishedCycles = cycles.filter(
    (cycle) => cycle !== runningCycle && cycle.endedAt - cycle.startedAt >= minimumCycleMilliseconds
  );
  return { runningCycle, finishedCycles };
}

function serializeCycle(cycle: Cycle | undefined) {
  if (!cycle) return null;
  return {
    startedAt: new Date(cycle.startedAt).toISOString(),
    endedAt: new Date(cycle.endedAt).toISOString(),
    energyWattHours: cycle.energyWattHours,
  };
}

function determineStatus(
  isOnline: boolean,
  isRunning: boolean,
  lastFinishedCycle: Cycle | undefined,
  now: number
): 'offline' | 'running' | 'finished' | 'idle' {
  if (!isOnline) return 'offline';
  if (isRunning) return 'running';
  if (lastFinishedCycle && now - lastFinishedCycle.endedAt <= finishedForMilliseconds) return 'finished';
  return 'idle';
}

export async function listPlugStatuses() {
  const plugs = await db.query.plugInPlugs.findMany({
    columns: { identifier: true, lastReadingAt: true },
    orderBy: { identifier: 'asc' },
    with: {
      latestReadings: { columns: { powerWatts: true }, orderBy: { createdAt: 'desc' }, limit: 1 },
      readings: {
        columns: { createdAt: true, powerWatts: true, powerActivity: true, isOn: true },
        where: { RAW: (reading) => gte(reading.createdAt, sql`now() - interval '24 hours'`) },
        orderBy: { createdAt: 'asc' },
      },
    },
  });
  const now = Date.now();
  const plugStatuses = plugs.map((plug) => {
    const latestReading = plug.readings.at(-1);
    const isOnline = !!latestReading && now - Date.parse(latestReading.createdAt) <= offlineAfterMilliseconds;
    const observedAt = latestReading?.powerActivity != null ? Date.parse(latestReading.createdAt) : now;
    const { runningCycle, finishedCycles } = summarizeCycles(plug.readings, observedAt);
    const isRunning = isOnline && !!runningCycle;
    const lastFinishedCycle = finishedCycles.at(-1);
    return {
      identifier: plug.identifier,
      status: determineStatus(isOnline, isRunning, lastFinishedCycle, now),
      lastReadingAt: plug.lastReadingAt ? new Date(plug.lastReadingAt).toISOString() : null,
      lastPowerWatts: plug.latestReadings[0]?.powerWatts ?? null,
      powerWatts: isOnline && latestReading ? latestReading.powerWatts : null,
      isOn: isOnline && latestReading ? latestReading.isOn : null,
      currentCycle: isRunning ? serializeCycle(runningCycle) : null,
      lastFinishedCycle: serializeCycle(lastFinishedCycle),
      finishedCycleCount: finishedCycles.length,
    };
  });
  return { plugs: plugStatuses };
}

export async function listPlugUsage(ending: string) {
  const lastDay = new Date(ending);
  const usesByDate = new Map<string, { identifier: string; startedAt: string; endedAt: string }[]>();
  const days = Array.from({ length: 7 }, (_, index) => {
    const date = new Date(lastDay);
    date.setUTCDate(date.getUTCDate() + index - 6);
    const day = date.toISOString().slice(0, 10);
    const uses: { identifier: string; startedAt: string; endedAt: string }[] = [];
    usesByDate.set(day, uses);
    return { date: day, uses };
  });

  const plugs = await db.query.plugInPlugs.findMany({
    columns: { identifier: true },
    with: {
      readings: {
        columns: { createdAt: true, powerWatts: true, powerActivity: true },
        where: {
          OR: [{ powerWatts: { gte: activePowerWatts } }, { powerActivity: { isNotNull: true } }],
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
