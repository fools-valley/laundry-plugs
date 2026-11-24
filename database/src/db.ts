import './load-env';
import { drizzle } from 'drizzle-orm/postgres-js';
import { sql } from 'drizzle-orm';
import postgres from 'postgres';
import * as schema from './schema/index';
import { relations } from './relations';

const connectionString = process.env.DATABASE_URL || 'postgres://postgres:postgres@localhost:5432/laundry_plugs';
const client = postgres(connectionString, { max: 10, idle_timeout: 20, max_lifetime: 60 * 30 });

export const db = drizzle({ client, schema, relations, logger: process.env.NODE_ENV === 'development' });

export async function testDatabaseConnection() {
  await db.execute(sql`select 1`);
}

export * from './schema/index';
