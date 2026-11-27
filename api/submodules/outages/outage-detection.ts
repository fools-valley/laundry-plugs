import { and, asc, between, desc, eq, gt, inArray, isNull, lte, max, notInArray, sql } from 'drizzle-orm';
import { db, outageInPlugs, plugInPlugs, readingInPlugs } from '@laundry-plugs/database/src/db';

// The mystery machine went quiet together with the old house plugs on 27 Nov 2026, so it counts as part of the old house.
export const watchedHouses = [
  {
    house: 'old-house',
    name: 'old house',
    identifiers: ['old-house-washer-1', 'old-house-washer-2', 'old-house-dryer-1', 'mystery-machine-1'],
  },
];

// Plugs report every minute and retry every 10 seconds: a house silent for 75 seconds while another plug reports has
// lost power or network, and waiting 20 more seconds lets plugs catch up after the API itself was unreachable.
const missedReportSeconds = 75;
const catchUpSeconds = 20;

export type Outage = typeof outageInPlugs.$inferSelect;

async function detectOutage(house: string, identifiers: string[]) {
  const [lastSeen] = await db
    .select({ lastSeenAt: max(plugInPlugs.lastReadingAt) })
    .from(plugInPlugs)
    .where(
      and(inArray(plugInPlugs.identifier, identifiers), gt(plugInPlugs.lastReadingAt, sql`now() - interval '1 day'`))
    );
  const lastSeenAt = lastSeen?.lastSeenAt;
  if (!lastSeenAt) return undefined;
  const [otherReading] = await db
    .select({ id: readingInPlugs.id })
    .from(readingInPlugs)
    .innerJoin(plugInPlugs, eq(plugInPlugs.id, readingInPlugs.plugId))
    .where(
      and(
        notInArray(plugInPlugs.identifier, identifiers),
        between(
          readingInPlugs.createdAt,
          sql`${lastSeenAt}::timestamptz + ${missedReportSeconds} * interval '1 second'`,
          sql`now() - ${catchUpSeconds} * interval '1 second'`
        )
      )
    )
    .limit(1);
  if (!otherReading) return undefined;
  const [outage] = await db
    .insert(outageInPlugs)
    .values({ house, lastSeenAt })
    .onConflictDoNothing({ target: outageInPlugs.house, where: isNull(outageInPlugs.restoredAt) })
    .returning();
  return outage;
}

async function findPlugRestart(plugId: string, lastSeenAt: string) {
  const readingColumns = {
    createdAt: readingInPlugs.createdAt,
    uptimeSeconds: readingInPlugs.uptimeSeconds,
    energyTotalWattHours: readingInPlugs.energyTotalWattHours,
  };
  const [firstReadingAfter] = await db
    .select(readingColumns)
    .from(readingInPlugs)
    .where(and(eq(readingInPlugs.plugId, plugId), gt(readingInPlugs.createdAt, lastSeenAt)))
    .orderBy(asc(readingInPlugs.createdAt))
    .limit(1);
  if (!firstReadingAfter) return undefined;
  const returnedAt = firstReadingAfter.createdAt;
  if (firstReadingAfter.uptimeSeconds !== null) {
    const bootedAt = Date.parse(returnedAt) - firstReadingAfter.uptimeSeconds * 1000;
    return { returnedAt, restarted: bootedAt > Date.parse(lastSeenAt), bootedAt };
  }
  const [lastReadingBefore] = await db
    .select(readingColumns)
    .from(readingInPlugs)
    .where(and(eq(readingInPlugs.plugId, plugId), lte(readingInPlugs.createdAt, lastSeenAt)))
    .orderBy(desc(readingInPlugs.createdAt))
    .limit(1);
  const energyBefore = lastReadingBefore?.energyTotalWattHours ?? null;
  const energyAfter = firstReadingAfter.energyTotalWattHours;
  // Older scripts send no uptime, but a restart loses the energy the counter had not saved yet.
  if (energyBefore === null || energyAfter === null || energyBefore === energyAfter)
    return { returnedAt, restarted: null, bootedAt: null };
  return { returnedAt, restarted: energyAfter < energyBefore, bootedAt: null };
}

async function detectRestoration(outage: Outage, identifiers: string[]) {
  const plugs = await db
    .select({ id: plugInPlugs.id })
    .from(plugInPlugs)
    .where(inArray(plugInPlugs.identifier, identifiers));
  const restarts = (await Promise.all(plugs.map(({ id }) => findPlugRestart(id, outage.lastSeenAt))))
    .filter((restart) => restart !== undefined)
    .toSorted((first, second) => Date.parse(first.returnedAt) - Date.parse(second.returnedAt));
  const [firstRestart] = restarts;
  if (!firstRestart) return undefined;
  const bootTimes = restarts.flatMap(({ restarted, bootedAt }) => (restarted && bootedAt !== null ? [bootedAt] : []));
  const restarted = restarts.some((restart) => restart.restarted === true);
  const keptRunning = restarts.some((restart) => restart.restarted === false);
  const [restoredOutage] = await db
    .update(outageInPlugs)
    .set({
      restoredAt: firstRestart.returnedAt,
      poweredOnAt: bootTimes.length ? new Date(Math.min(...bootTimes)).toISOString() : null,
      cause: restarted ? 'power_cut' : keptRunning ? 'network_outage' : null,
    })
    .where(and(eq(outageInPlugs.id, outage.id), isNull(outageInPlugs.restoredAt)))
    .returning();
  return restoredOutage;
}

export async function checkOutages() {
  const openOutages = await db.select().from(outageInPlugs).where(isNull(outageInPlugs.restoredAt));
  const changes: { opened: Outage[]; restored: Outage[] } = { opened: [], restored: [] };
  for (const { house, identifiers } of watchedHouses) {
    const openOutage = openOutages.find((outage) => outage.house === house);
    if (openOutage) {
      const restoredOutage = await detectRestoration(openOutage, identifiers);
      if (restoredOutage) changes.restored.push(restoredOutage);
    } else {
      const outage = await detectOutage(house, identifiers);
      if (outage) changes.opened.push(outage);
    }
  }
  return changes;
}
