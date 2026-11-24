import { between, eq, gte, ne, sql } from 'drizzle-orm';
import { db, plugInPlugs, readingInPlugs, type Reading } from '@laundry-plugs/database/src/db';

const minuteMilliseconds = 60 * 1000;
const cyclePauseMilliseconds = 3 * minuteMilliseconds;
const minimumCycleMilliseconds = 3 * minuteMilliseconds;
export const offlineAfterMilliseconds = 5 * minuteMilliseconds;
const finishedForMilliseconds = 5 * 60 * minuteMilliseconds;
const usageDayFormat = new Intl.DateTimeFormat('sv-SE', { timeZone: 'Europe/Lisbon', dateStyle: 'short' });

type Cycle = { startedAt: number; endedAt: number; energyWattHours: number };
type Use = { identifier: string; startedAt: string; endedAt: string | null; energyWattHours: number };
type PlugEnergy = { identifier: string; energyWattHours: number };

function findCycles(readings: (Pick<Reading, 'createdAt' | 'powerActivity'> & { energyWattHours?: number })[]) {
  const cycles: Cycle[] = [];
  for (const reading of readings) {
    const activity = reading.powerActivity;
    if (!activity || activity === 'quiet') continue;
    const at = Date.parse(reading.createdAt);
    const startedAt = at - activity.firstAgeSeconds * 1000;
    const endedAt = at - activity.lastAgeSeconds * 1000;
    const energyWattHours = reading.energyWattHours ?? 0;
    const lastCycle = cycles.at(-1);
    if (lastCycle && startedAt - lastCycle.endedAt < cyclePauseMilliseconds) {
      lastCycle.endedAt = Math.max(lastCycle.endedAt, endedAt);
      lastCycle.energyWattHours += energyWattHours;
    } else cycles.push({ startedAt, endedAt, energyWattHours });
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
    orderBy: { createdAt: 'asc', identifier: 'asc' },
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
  const days = Array.from(
    { length: 7 },
    (_, index): { date: string; energyWattHours: number; energyByPlug: PlugEnergy[]; uses: Use[] } => {
      const date = new Date(ending);
      date.setUTCDate(date.getUTCDate() + index - 6);
      return { date: date.toISOString().slice(0, 10), energyWattHours: 0, energyByPlug: [], uses: [] };
    }
  );
  const daysByDate = new Map(days.map((day) => [day.date, day]));

  // The energy counter is cumulative but can restart from zero, so a drop counts as no usage rather than negative usage.
  const energyReadings = db.$with('energy_readings').as(
    db
      .select({
        plugId: readingInPlugs.plugId,
        createdAt: readingInPlugs.createdAt,
        powerActivity: readingInPlugs.powerActivity,
        energyWattHours:
          sql<number>`greatest(${readingInPlugs.energyTotalWattHours} - lag(${readingInPlugs.energyTotalWattHours}) over (partition by ${readingInPlugs.plugId} order by ${readingInPlugs.createdAt}), 0)`.as(
            'energy_watt_hours'
          ),
      })
      .from(readingInPlugs)
      .where(
        between(
          readingInPlugs.createdAt,
          sql`((${ending}::date - 6)::timestamp AT TIME ZONE 'Europe/Lisbon') - interval '24 hours'`,
          sql`((${ending}::date + 1)::timestamp AT TIME ZONE 'Europe/Lisbon') + ${cyclePauseMilliseconds + minuteMilliseconds} * interval '1 millisecond'`
        )
      )
  );
  const usageDate = sql<string>`to_char(${energyReadings.createdAt} AT TIME ZONE 'Europe/Lisbon', 'YYYY-MM-DD')`;
  const [dailyEnergy, activeReadings] = await Promise.all([
    db
      .with(energyReadings)
      .select({
        date: usageDate,
        identifier: plugInPlugs.identifier,
        energyWattHours: sql<number>`sum(${energyReadings.energyWattHours})`.mapWith(Number),
      })
      .from(energyReadings)
      .innerJoin(plugInPlugs, eq(plugInPlugs.id, energyReadings.plugId))
      .groupBy(usageDate, plugInPlugs.id)
      .orderBy(plugInPlugs.createdAt, plugInPlugs.identifier),
    db
      .with(energyReadings)
      .select({
        identifier: plugInPlugs.identifier,
        createdAt: energyReadings.createdAt,
        powerActivity: energyReadings.powerActivity,
        energyWattHours: energyReadings.energyWattHours,
      })
      .from(energyReadings)
      .innerJoin(plugInPlugs, eq(plugInPlugs.id, energyReadings.plugId))
      .where(ne(energyReadings.powerActivity, 'quiet'))
      .orderBy(plugInPlugs.createdAt, plugInPlugs.identifier, energyReadings.createdAt),
  ]);
  for (const { date, identifier, energyWattHours } of dailyEnergy) {
    const day = daysByDate.get(date);
    if (!day) continue;
    day.energyWattHours += energyWattHours;
    day.energyByPlug.push({ identifier, energyWattHours });
  }
  const readingsByIdentifier = Map.groupBy(activeReadings, (reading) => reading.identifier);

  const now = Date.now();
  for (const [identifier, readings] of readingsByIdentifier) {
    const cycles = findCycles(readings);
    for (const cycle of cycles) {
      const isRunning = cycle === cycles.at(-1) && now - cycle.endedAt < cyclePauseMilliseconds;
      if (!isRunning && cycle.endedAt - cycle.startedAt < minimumCycleMilliseconds) continue;
      daysByDate.get(usageDayFormat.format(cycle.endedAt))?.uses.push({
        identifier,
        startedAt: new Date(cycle.startedAt).toISOString(),
        endedAt: isRunning ? null : new Date(cycle.endedAt).toISOString(),
        energyWattHours: cycle.energyWattHours,
      });
    }
  }
  const plugPositions = new Map([...readingsByIdentifier.keys()].map((identifier, position) => [identifier, position]));
  for (const day of days)
    day.uses.sort(
      (first, second) =>
        (plugPositions.get(first.identifier) ?? 0) - (plugPositions.get(second.identifier) ?? 0) ||
        first.startedAt.localeCompare(second.startedAt)
    );
  return { days };
}
