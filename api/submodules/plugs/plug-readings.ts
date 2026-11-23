import { eq, sql } from 'drizzle-orm';
import { z } from 'zod/v4';
import { db, plugInPlugs, readingInPlugs, type AccessToken } from '@laundry-plugs/database/src/db';

export const plugIdentifierSchema = z
  .string()
  .max(64)
  .regex(/^[a-z0-9]+(-[a-z0-9]+)*$/);

export const shellySwitchStatusSchema = z.looseObject({
  output: z.boolean().optional(),
  apower: z.number(),
  voltage: z.number().optional(),
  current: z.number().optional(),
  aenergy: z.looseObject({ total: z.number() }).optional(),
  temperature: z.looseObject({ tC: z.number().nullable() }).optional(),
});

const powerActivityHeaderSchema = z.union([
  z.literal('quiet'),
  z
    .string()
    .regex(/^\d{1,3},\d{1,3}$/)
    .transform((value) => {
      const [firstAgeSeconds = 0, lastAgeSeconds = 0] = value.split(',').map(Number);
      return { firstAgeSeconds, lastAgeSeconds };
    })
    .refine(({ firstAgeSeconds, lastAgeSeconds }) => firstAgeSeconds >= lastAgeSeconds),
]);

export const plugReadingHeadersSchema = z.object({
  'x-plug-activity': powerActivityHeaderSchema.optional(),
  'x-telegram-chat-id': z
    .string()
    .regex(/^-100[0-9]+$/)
    .max(20)
    .optional(),
  'x-telegram-topic-id': z.coerce.number().int().positive().max(2147483647).optional(),
  'x-telegram-message-id': z.coerce.number().int().positive().max(2147483647).optional(),
  'x-telegram-display-name': z
    .string()
    .regex(/^[ -~]+$/)
    .max(100)
    .optional(),
  'x-telegram-status-restored': z.literal('1').optional(),
});

export async function recordPlugReading(
  identifier: string,
  accessToken: AccessToken,
  switchStatus: z.infer<typeof shellySwitchStatusSchema>,
  readingHeaders: z.infer<typeof plugReadingHeadersSchema>
) {
  return db.transaction(async (transaction) => {
    const washerIdentifier = identifier.replace(/^((?:old|tc)-house)-washing-machine-([12])$/, '$1-washer-$2');
    const previousIdentifier = washerIdentifier.replace(/^((?:old|tc)-house)-washer-([12])$/, '$1-washing-machine-$2');
    const previousPlug =
      previousIdentifier === washerIdentifier
        ? undefined
        : await transaction.query.plugInPlugs.findFirst({
            columns: { identifier: true },
            where: { identifier: previousIdentifier },
          });
    const storedIdentifier = previousPlug?.identifier ?? washerIdentifier;
    const [plug] = await transaction
      .insert(plugInPlugs)
      .values({ identifier: storedIdentifier, createdByAccessTokenId: accessToken.id, lastReadingAt: sql`now()` })
      .onConflictDoUpdate({ target: plugInPlugs.identifier, set: { lastReadingAt: sql`now()` } })
      .returning({
        id: plugInPlugs.id,
        telegramMessage: plugInPlugs.telegramMessage,
        telegramUnavailable: plugInPlugs.telegramUnavailable,
      });
    if (!plug) throw new Error(`Plug ${identifier} was not saved`);
    await transaction.insert(readingInPlugs).values({
      plugId: plug.id,
      accessTokenId: accessToken.id,
      isOn: switchStatus.output,
      powerWatts: switchStatus.apower,
      powerActivity: readingHeaders['x-plug-activity'],
      voltageVolts: switchStatus.voltage,
      currentAmperes: switchStatus.current,
      energyTotalWattHours: switchStatus.aenergy?.total,
      temperatureCelsius: switchStatus.temperature?.tC,
      payload: switchStatus,
    });

    const chatId = readingHeaders['x-telegram-chat-id'];
    const topicId = readingHeaders['x-telegram-topic-id'];
    const messageId = readingHeaders['x-telegram-message-id'];
    const displayName = readingHeaders['x-telegram-display-name'];
    const savedMessage = plug.telegramMessage;
    if (chatId && topicId && messageId && displayName) {
      const restored = readingHeaders['x-telegram-status-restored'] === '1';
      const sameMessage = savedMessage?.chatId === chatId && savedMessage.messageId === messageId;
      const unavailable = sameMessage && plug.telegramUnavailable && !restored;
      if (
        !sameMessage ||
        savedMessage.topicId !== topicId ||
        savedMessage.displayName !== displayName ||
        unavailable !== plug.telegramUnavailable
      ) {
        await transaction
          .update(plugInPlugs)
          .set({
            telegramMessage: { chatId, topicId, messageId, displayName },
            telegramUnavailable: unavailable,
          })
          .where(eq(plugInPlugs.id, plug.id));
      }
      return { messageId, unavailable };
    }
    if (savedMessage && savedMessage.chatId === chatId && savedMessage.topicId === topicId) {
      return { messageId: savedMessage.messageId, unavailable: plug.telegramUnavailable };
    }
  });
}
