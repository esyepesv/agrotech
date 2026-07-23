import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getRegistrationConfig,
  getRegistrationHandlers,
} from '../../src/interfaces/serverless/runtime.js';
import { applyCors } from '../../src/interfaces/serverless/cors.js';

// NOTA de prefijo (spec 001 §7 / CLAUDE.md "cómo corre"): en Fastify esta
// ruta vive en `/register/request-otp`; aquí, por el ruteo por archivos de
// Vercel, queda bajo `/api/register/request-otp`. Es la misma discrepancia
// de prefijo que ya existe entre `src/interfaces/http/*-webhook.ts` (rutas
// `/webhook/*`) y `api/webhook/*.ts` (rutas `/api/webhook/*`) — no se
// unifica aquí, solo se documenta.
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

  const response = await getRegistrationHandlers().requestOtp({ body: req.body });
  if (response.headers !== undefined) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(response.status).json(response.body);
}
