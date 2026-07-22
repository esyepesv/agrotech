import type { VercelRequest, VercelResponse } from '@vercel/node';
import {
  getRegistrationConfig,
  getRegistrationHandlers,
} from '../../src/interfaces/serverless/runtime.js';
import { applyCors } from './_cors.js';

// Discrepancia de prefijo /register vs /api/register: ver la nota en
// request-otp.ts. Discrepancia ADICIONAL de este endpoint: en Fastify la
// ruta es `/register/farms/search` (anidada); por el ruteo por archivos de
// Vercel (sin crear una carpeta `farms/` con su propio `search.ts`) el
// nombre de archivo que asignó el orquestador es `farms-search.ts`, así que
// aquí queda como `/api/register/farms-search`. No se unifica, solo se
// documenta (mismo criterio que el resto de discrepancias de prefijo).
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

  const response = await getRegistrationHandlers().farmsSearch({
    query: req.query,
    ip: clientIp(req),
  });
  if (response.headers !== undefined) {
    for (const [key, value] of Object.entries(response.headers)) {
      res.setHeader(key, value);
    }
  }
  res.status(response.status).json(response.body);
}

/**
 * Vercel corre detrás de un proxy: la IP real del cliente llega en
 * `x-forwarded-for` (primer valor de la lista), no en `req.socket`. Se usa
 * como llave del rate limiter de búsqueda pública (spec 001, nota de
 * privacidad final) — mismo propósito que `request.ip` en Fastify.
 */
function clientIp(req: VercelRequest): string {
  const forwarded = req.headers['x-forwarded-for'];
  const first = Array.isArray(forwarded) ? forwarded[0] : forwarded;
  const ip = first?.split(',')[0]?.trim();
  return ip !== undefined && ip.length > 0 ? ip : (req.socket.remoteAddress ?? 'unknown');
}
