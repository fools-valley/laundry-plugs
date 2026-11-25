import {
  pgSchema,
  text,
  timestamp,
  uuid,
  boolean,
  doublePrecision,
  jsonb,
  index,
  uniqueIndex,
} from 'drizzle-orm/pg-core';
import { isNull, sql } from 'drizzle-orm';
import { baseColumns, baseColumnsWithoutUpdatedAt } from '../columns';
import { accessTokenInAuth } from './access-tokens';

export const plugsSchema = pgSchema('plugs');

export const plugInPlugs = plugsSchema.table(
  'plug',
  {
    ...baseColumns,
    identifier: text('identifier').notNull(),
    createdByAccessTokenId: uuid('created_by_access_token_id')
      .notNull()
      .references(() => accessTokenInAuth.id),
    lastReadingAt: timestamp('last_reading_at', { withTimezone: true, mode: 'string' }),
    localIpAddress: text('local_ip_address'),
    telegramMessage: jsonb('telegram_message').$type<{
      chatId: string;
      topicId: number;
      messageId: number;
      displayName: string;
    }>(),
    telegramUnavailable: boolean('telegram_unavailable').notNull().default(false),
  },
  (table) => [index().on(table.createdAt), uniqueIndex().on(table.identifier)]
);

export const readingInPlugs = plugsSchema.table(
  'reading',
  {
    ...baseColumnsWithoutUpdatedAt,
    plugId: uuid('plug_id')
      .notNull()
      .references(() => plugInPlugs.id),
    accessTokenId: uuid('access_token_id')
      .notNull()
      .references(() => accessTokenInAuth.id),
    isOn: boolean('is_on'),
    powerWatts: doublePrecision('power_watts').notNull(),
    powerActivity: jsonb('power_activity').$type<{ firstAgeSeconds: number; lastAgeSeconds: number } | 'quiet'>(),
    voltageVolts: doublePrecision('voltage_volts'),
    currentAmperes: doublePrecision('current_amperes'),
    energyTotalWattHours: doublePrecision('energy_total_watt_hours'),
    temperatureCelsius: doublePrecision('temperature_celsius'),
    payload: jsonb('payload').$type<Record<string, unknown>>().notNull(),
  },
  (table) => [index().on(table.createdAt), index().on(table.plugId, table.createdAt)]
);

export const notificationEventInPlugs = plugsSchema.enum('notification_event', ['started', 'finished']);

export const notificationInPlugs = plugsSchema.table(
  'notification',
  {
    ...baseColumns,
    plugId: uuid('plug_id')
      .notNull()
      .references(() => plugInPlugs.id),
    telegramChatId: text('telegram_chat_id').notNull(),
    event: notificationEventInPlugs('event').notNull().default('finished'),
    telegramUser: jsonb('telegram_user').$type<{
      firstName: string;
      lastName: string | null;
      username: string | null;
    }>(),
    notifiedAt: timestamp('notified_at', { withTimezone: true, mode: 'string' }),
    cancelledAt: timestamp('cancelled_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [
    index().on(table.createdAt),
    index().on(table.telegramChatId, table.createdAt),
    uniqueIndex()
      .on(table.plugId, table.telegramChatId, table.event)
      .where(sql`${isNull(table.notifiedAt)} and ${isNull(table.cancelledAt)}`),
  ]
);

export type Plug = typeof plugInPlugs.$inferSelect;
export type Reading = typeof readingInPlugs.$inferSelect;
