import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import log from 'loglevel';
import { z } from 'zod/v4';
import { requireAccessToken } from '../access-tokens/access-tokens';
import {
  plugIdentifierSchema,
  recordPlugReading,
  shellySwitchStatusSchema,
  plugReadingHeadersSchema,
} from './plug-readings';
import { listPlugStatuses, listPlugUsage } from './plug-status';
import { refreshMachineMenusOnStatusChange, sendNotifications } from './plug-telegram-bot';

export const plugRoutes = new Hono()
  .get('/', async (c) => c.json(await listPlugStatuses()))
  .get(
    '/usage',
    zValidator(
      'query',
      z.object({ ending: z.iso.date().refine((date) => date >= '2000-01-07' && date <= '9999-12-30') })
    ),
    async (c) => c.json(await listPlugUsage(c.req.valid('query').ending))
  )
  .post(
    '/:identifier/readings',
    requireAccessToken,
    zValidator('param', z.object({ identifier: plugIdentifierSchema })),
    zValidator('json', shellySwitchStatusSchema),
    zValidator('header', plugReadingHeadersSchema),
    async (c) => {
      const { identifier } = c.req.valid('param');
      const telegramUnavailable = await recordPlugReading(
        identifier,
        c.get('accessToken'),
        c.req.valid('json'),
        c.req.valid('header')
      );
      sendNotifications(identifier).catch((error) => log.warn('Could not check notifications', error));
      refreshMachineMenusOnStatusChange().catch((error) => log.warn('Could not check machine menus', error));
      if (telegramUnavailable) c.header('X-Telegram-Unavailable', '1');
      return c.body(null, 204);
    }
  );
