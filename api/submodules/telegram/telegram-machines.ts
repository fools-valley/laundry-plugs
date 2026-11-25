import { db, plugInPlugs, type Plug } from '@laundry-plugs/database/src/db';
import { listPlugStatuses } from '../plugs/plug-status';

export function getDisplayName(plug: Pick<Plug, 'identifier' | 'telegramMessage'>) {
  return plug.telegramMessage?.displayName ?? plug.identifier.replaceAll('-', ' ');
}

export async function listMachines() {
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

export type Machine = Awaited<ReturnType<typeof listMachines>>[number];

export function describeMachine({ displayName, status, cycleStartedAt }: Machine) {
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

export function getMachineKeyboard(machines: Machine[]) {
  return machines.map((machine) => [{ text: describeMachine(machine), callback_data: `notify:${machine.id}` }]);
}
