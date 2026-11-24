import { createHash } from 'node:crypto';
import { and, eq, isNull, sql } from 'drizzle-orm';
import { createMiddleware } from 'hono/factory';
import { HTTPException } from 'hono/http-exception';
import { db, accessTokenInAuth, type AccessToken } from '@laundry-plugs/database/src/db';

export const requireAccessToken = createMiddleware<{ Variables: { accessToken: AccessToken } }>(async (c, next) => {
  const token = c.req.header('authorization')?.match(/^Bearer\s+(\S+)$/i)?.[1];
  if (!token) throw new HTTPException(401);
  const [accessToken] = await db
    .update(accessTokenInAuth)
    .set({ lastUsedAt: sql`now()` })
    .where(
      and(
        eq(accessTokenInAuth.tokenHash, createHash('sha256').update(token).digest('hex')),
        isNull(accessTokenInAuth.revokedAt)
      )
    )
    .returning();
  if (!accessToken) throw new HTTPException(401);
  c.set('accessToken', accessToken);
  await next();
});
