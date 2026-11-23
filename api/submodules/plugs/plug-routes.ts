import { Hono } from 'hono';
import { zValidator } from '@hono/zod-validator';
import { z } from 'zod/v4';
import { requireAccessToken } from '../access-tokens/access-tokens';
import {
  plugIdentifierSchema,
  recordPlugReading,
  shellySwitchStatusSchema,
  plugReadingHeadersSchema,
} from './plug-readings';
import { listPlugStatuses, listPlugUsage } from './plug-status';

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
      const telegramStatus = await recordPlugReading(
        c.req.valid('param').identifier,
        c.get('accessToken'),
        c.req.valid('json'),
        c.req.valid('header')
      );
      if (telegramStatus) {
        c.header('X-Telegram-Message-Id', String(telegramStatus.messageId));
        if (telegramStatus.unavailable) c.header('X-Telegram-Unavailable', '1');
      }
      return c.body(null, 204);
    }
  );
