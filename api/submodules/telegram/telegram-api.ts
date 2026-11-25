import { z } from 'zod/v4';

const telegramResponseSchema = z.object({
  ok: z.boolean(),
  description: z.string().default(''),
  result: z.unknown(),
  parameters: z.object({ retry_after: z.number().optional() }).optional(),
});

export class TelegramError extends Error {
  constructor(
    readonly status: number,
    readonly description: string,
    readonly retryAfterSeconds: number | undefined
  ) {
    super(`Telegram returned HTTP ${status}: ${description}`);
  }
}

export async function callTelegram(method: string, parameters: Record<string, unknown>, timeoutMilliseconds = 5000) {
  const token = process.env.TELEGRAM_BOT_TOKEN;
  if (!token) throw new Error('TELEGRAM_BOT_TOKEN is not set');
  const response = await fetch(`https://api.telegram.org/bot${token}/${method}`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(parameters),
    signal: AbortSignal.timeout(timeoutMilliseconds),
  });
  const body = telegramResponseSchema.parse(await response.json());
  if (!body.ok) throw new TelegramError(response.status, body.description, body.parameters?.retry_after);
  return body.result;
}
