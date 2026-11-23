import './load-env';
import { migrate } from 'drizzle-orm/postgres-js/migrator';
import { db } from './db';

await migrate(db, { migrationsFolder: new URL('../drizzle', import.meta.url).pathname });
await db.$client.end();
