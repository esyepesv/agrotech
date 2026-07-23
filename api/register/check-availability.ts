import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getRegistrationConfig,
  getRegistrationHandlers,
} from '../../src/interfaces/serverless/runtime.js';
import { applyCors } from '../../src/interfaces/serverless/cors.js';

// Discrepancia de prefijo /register vs /api/register: ver la nota en
// request-otp.ts. Es POST (no GET) para no dejar cédulas ni correos en el
// query string de los registros de acceso; la cuota va por IP, igual que la
// búsqueda pública de fincas.
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  const config = getRegistrationConfig();
  if (applyCors(req, res, config.corsAllowedOrigins)) {
    return;
  }

  if (req.method !== 'POST') {
    res
      .status(405)
      .json({ error: { code: 'method_not_allowed', message: 'Método no soportado.' } });
    return;
  }

  const response = await getRegistrationHandlers().checkAvailability({
    body: req.body as unknown,
    ip: clientIp(req),
  });
  if (response.headers !== undefined) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(response.status).json(response.body);
}

/** La IP real llega en `x-forwarded-for` detrás del proxy de Vercel. */
function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = first?.split(',')[0]?.trim();
  return ip !== undefined && ip.length > 0 ? ip : (req.socket.remoteAddress ?? 'unknown');
}
