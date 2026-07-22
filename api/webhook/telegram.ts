import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { parseTelegramUpdate } from '../../src/interfaces/http/telegram-webhook.js';
import { processIncoming } from '../../src/interfaces/serverless/runtime.js';

/**
 * Equivalente serverless de registerTelegramWebhook (src/interfaces/http/telegram-webhook.ts):
 * reutiliza el mismo parser puro. Responde 200 de inmediato y delega el
 * procesamiento a waitUntil para no bloquear ni romper nunca el webhook.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method !== 'POST') {
    res.status(405).json({ ok: false });
    return;
  }

  const message = parseTelegramUpdate(req.body);
  if (message !== undefined) {
    waitUntil(processIncoming(message));
  }

  res.status(200).json({ ok: true });
}
