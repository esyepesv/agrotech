import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { parseWhatsAppMessage } from '../../src/interfaces/http/whatsapp-webhook.js';
import { getEnv, processIncoming } from '../../src/interfaces/serverless/runtime.js';

/**
 * Toma el primer valor de un query param de Vercel, que puede llegar como
 * string único o como arreglo (?a=1&a=2) según la firma de VercelRequestQuery.
 */
function firstValue(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/**
 * Equivalente serverless de registerWhatsAppWebhook (src/interfaces/http/whatsapp-webhook.ts):
 * reutiliza el mismo parser puro para el POST y replica la verificación de
 * Meta (GET con hub.challenge) leyendo el verify token desde el runtime
 * memoizado en vez de recibirlo como parámetro.
 */
export default function handler(req: VercelRequest, res: VercelResponse): void {
  if (req.method === 'GET') {
    const mode = firstValue(req.query['hub.mode']);
    const verifyToken = firstValue(req.query['hub.verify_token']);
    const challenge = firstValue(req.query['hub.challenge']);
    const expectedToken = getEnv().WHATSAPP_VERIFY_TOKEN;

    const isValidHandshake =
      mode === 'subscribe' && expectedToken !== undefined && verifyToken === expectedToken;

    if (!isValidHandshake) {
      res.status(403).send('');
      return;
    }
    res.status(200).send(challenge ?? '');
    return;
  }

  if (req.method === 'POST') {
    const message = parseWhatsAppMessage(req.body);
    if (message !== undefined) {
      waitUntil(processIncoming(message));
    }
    // Nunca romper el webhook: responder 200 rápido y procesar en background.
    res.status(200).json({ ok: true });
    return;
  }

  res.status(405).json({ ok: false });
}
