import { Hono } from 'hono';
import { logger } from 'hono/logger';
import { secureHeaders } from 'hono/secure-headers';
import { HTTPException } from 'hono/http-exception';
import log from 'loglevel';
import { testDatabaseConnection } from '@laundry-plugs/database/src/db';
import { plugRoutes } from '../plugs/plug-routes';

export const app = new Hono()
  .use(logger((message) => log.info(message)))
  .use(secureHeaders())
  .get('/health', async (c) => {
    await testDatabaseConnection();
    return c.text('ok');
  })
  .route('/plugs', plugRoutes)
  .onError((error, c) => {
    if (error instanceof HTTPException) return error.getResponse();
    log.error(error);
    return c.text('Internal Server Error', 500);
  });

export type AppType = typeof app;
