import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHandlers, getRegistrationConfig } from '../../src/interfaces/serverless/runtime.js';
import { applyCors } from '../../src/interfaces/serverless/cors.js';
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, getRegistrationConfig().corsAllowedOrigins)) return;
  if (req.method !== 'POST') { res.status(405).json({ error: { code: 'method_not_allowed', message: 'Método no soportado.' } }); return; }
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  const handlers = getAuthHandlers();
  const response = action === 'destinations' ? await handlers.authDestinations({ body: req.body }) : action === 'request-otp' ? await handlers.authRequestOtp({ body: req.body }) : action === 'verify-otp' ? await handlers.authVerifyOtp({ body: req.body }) : { status: 404, body: { error: { code: 'not_found', message: 'Ruta no encontrada.' } } };
  if (response.headers) for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value);
  res.status(response.status).json(response.body);
}
