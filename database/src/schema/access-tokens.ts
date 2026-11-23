import { pgSchema, text, timestamp, index, uniqueIndex } from 'drizzle-orm/pg-core';
import { baseColumns } from '../columns';

export const authSchema = pgSchema('auth');

export const accessTokenInAuth = authSchema.table(
  'access_token',
  {
    ...baseColumns,
    name: text('name').notNull(),
    tokenHash: text('token_hash').notNull(),
    lastUsedAt: timestamp('last_used_at', { withTimezone: true, mode: 'string' }),
    revokedAt: timestamp('revoked_at', { withTimezone: true, mode: 'string' }),
  },
  (table) => [index().on(table.createdAt), uniqueIndex().on(table.tokenHash)]
);

export type AccessToken = typeof accessTokenInAuth.$inferSelect;
