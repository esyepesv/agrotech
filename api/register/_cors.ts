import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Vercel no aplica CORS automáticamente (a diferencia de Fastify, que usa
 * `@fastify/cors` dentro de sus grupos de rutas). Cada handler web de
 * `api/register/*` y `api/account/*` llama a esta función al inicio, con la
 * MISMA lista de orígenes permitidos (`corsAllowedOrigins`, expuesta vía
 * `getRegistrationConfig()` del runtime
 * memoizado) para que las dos superficies compartan un único criterio.
 *
 * Devuelve `true` si la petición era un preflight `OPTIONS` (ya respondida
 * con 204 aquí mismo); el handler debe retornar de inmediato en ese caso.
 * Si `allowedOrigins` está vacío, no se agrega ninguna cabecera CORS (mismo
 * criterio que la superficie Fastify: "si la lista está vacía, no
 * habilites CORS").
 */
export function applyCors(
  req: VercelRequest,
  res: VercelResponse,
  allowedOrigins: readonly string[],
): boolean {
  const origin = req.headers.origin;
  if (typeof origin === 'string' && allowedOrigins.includes(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Methods', 'GET,POST,OPTIONS');
    res.setHeader('Access-Control-Allow-Headers', 'Authorization, Content-Type');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return true;
  }
  return false;
}
