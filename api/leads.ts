import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getLeadHandlers, getRegistrationConfig } from '../src/interfaces/serverless/runtime.js';
import { applyCors } from '../src/interfaces/serverless/cors.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, getRegistrationConfig().corsAllowedOrigins)) return;
  if (req.method !== 'POST') {
    res.status(405).json({ error: { code: 'method_not_allowed', message: 'Método no soportado.' } });
    return;
  }
  const ip = typeof req.headers['x-forwarded-for'] === 'string'
    ? req.headers['x-forwarded-for'].split(',')[0]?.trim() ?? 'unknown'
    : req.socket.remoteAddress ?? 'unknown';
  const key = typeof req.headers['idempotency-key'] === 'string' ? req.headers['idempotency-key'] : undefined;
  const response = await getLeadHandlers().submit({ body: req.body, ip, idempotencyKey: key });
  if (response.headers !== undefined) for (const [name, value] of Object.entries(response.headers)) res.setHeader(name, value);
  res.status(response.status).json(response.body);
}
