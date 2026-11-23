import { sql } from 'drizzle-orm';
import { uuid, timestamp } from 'drizzle-orm/pg-core';

export const baseColumnsWithoutUpdatedAt = {
  id: uuid('id').primaryKey().defaultRandom(),
  createdAt: timestamp('created_at', { withTimezone: true, mode: 'string' }).notNull().defaultNow(),
};

export const baseColumns = {
  ...baseColumnsWithoutUpdatedAt,
  updatedAt: timestamp('updated_at', { withTimezone: true, mode: 'string' })
    .notNull()
    .defaultNow()
    .$onUpdate(() => sql`now()`),
};
