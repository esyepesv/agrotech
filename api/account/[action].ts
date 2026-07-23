import type { VercelRequest, VercelResponse } from '@vercel/node';
import { getAuthHandlers, getRegistrationConfig } from '../../src/interfaces/serverless/runtime.js';
import { applyCors } from '../../src/interfaces/serverless/cors.js';
function authorization(headers: unknown): string | undefined {
  if (typeof headers !== 'object' || headers === null) return undefined;
  const value = (headers as Record<string, unknown>).authorization;
  return typeof value === 'string'
    ? value
    : Array.isArray(value) && typeof value[0] === 'string'
      ? value[0]
      : undefined;
}
export default async function handler(req: VercelRequest, res: VercelResponse): Promise<void> {
  if (applyCors(req, res, getRegistrationConfig().corsAllowedOrigins)) return;
  const action = Array.isArray(req.query.action) ? req.query.action[0] : req.query.action;
  // `me` es de lectura (GET); las demás acciones siguen siendo POST.
  const expectedMethod = action === 'me' ? 'GET' : 'POST';
  if (req.method !== expectedMethod) {
    res
      .status(405)
      .json({ error: { code: 'method_not_allowed', message: 'Método no soportado.' } });
    return;
  }
  const input = { body: req.body as unknown, authorization: authorization(req.headers) };
  const handlers = getAuthHandlers();
  const response =
    action === 'me'
      ? await handlers.me(input)
      : action === 'request-otp'
        ? await handlers.accountRequestOtp(input)
        : action === 'verify-otp'
          ? await handlers.accountVerifyOtp(input)
          : { status: 404, body: { error: { code: 'not_found', message: 'Ruta no encontrada.' } } };
  if (response.headers)
    for (const [key, value] of Object.entries(response.headers)) res.setHeader(key, value);
  res.status(response.status).json(response.body);
}
