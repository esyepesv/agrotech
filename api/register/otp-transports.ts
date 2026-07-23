import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getRegistrationConfig,
  getRegistrationHandlers,
} from '../../src/interfaces/serverless/runtime.js';
import { applyCors } from '../../src/interfaces/serverless/cors.js';

// Discrepancia de prefijo /register vs /api/register: ver la nota en
// request-otp.ts (mismo motivo, documentado una sola vez con detalle).
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const config = getRegistrationConfig();
  if (applyCors(req, res, config.corsAllowedOrigins)) {
    return;
  }

  if (req.method !== 'GET') {
    res
      .status(405)
      .json({ error: { code: 'method_not_allowed', message: 'Método no soportado.' } });
    return;
  }

  const response = await getRegistrationHandlers().otpTransports();
  if (response.headers !== undefined) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(response.status).json(response.body);
}
