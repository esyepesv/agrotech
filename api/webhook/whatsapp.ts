import type { VercelRequest, VercelResponse } from '@vercel/node';
import { waitUntil } from '@vercel/functions';
import { parseWhatsAppMessage } from '../../src/interfaces/http/whatsapp-webhook.js';
import { getEnv, getLogger, processIncoming } from '../../src/interfaces/serverless/runtime.js';
import { readRawBody } from '../../src/infrastructure/http/raw-body.js';
import { verifyMetaSignature } from '../../src/infrastructure/security/meta-signature.js';

const SIGNATURE_HEADER = 'x-hub-signature-256';

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
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
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
    const appSecret = getEnv().WHATSAPP_APP_SECRET;

    // #1 hardening: se lee el raw body ANTES (o independientemente) de
    // acceder a req.body — @vercel/node ya reemplazó el stream original por
    // uno que repite los mismos bytes crudos (ver readRawBody), así que el
    // HMAC se calcula sobre exactamente lo que Meta firmó, no sobre una
    // re-serialización de req.body ya parseado.
    if (appSecret !== undefined) {
      const rawBody = await readRawBody(req);
      const header = req.headers[SIGNATURE_HEADER];
      const signature = Array.isArray(header) ? header[0] : header;
      if (!verifyMetaSignature(rawBody, signature, appSecret)) {
        getLogger().warn('firma X-Hub-Signature-256 inválida o ausente en el webhook de WhatsApp');
        res.status(401).json({ ok: false });
        return;
      }
    }

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
