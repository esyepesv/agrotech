import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHandlers, getRegistrationConfig } from '../../src/interfaces/serverless/runtime.js';
import { applyCors } from '../register/_cors.js';

export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const config = getRegistrationConfig();
  if (applyCors(req, res, config.corsAllowedOrigins)) {
    return;
  }
  if (req.method !== 'POST') {
    res.status(405).json({ error: { code: 'method_not_allowed', message: 'Método no soportado.' } });
    return;
  }

  const authorization = req.headers.authorization;
  const response = await getAuthHandlers().accountRequestOtp({
    body: req.body,
    authorization: Array.isArray(authorization) ? authorization[0] : authorization,
  });
  if (response.headers !== undefined) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(response.status).json(response.body);
}
