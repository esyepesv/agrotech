import type { VercelRequest, VercelResponse } from '@vercel/node';

/**
 * Health check para el despliegue serverless en Vercel (equivalente a
 * GET /health en el servidor Fastify local). Responde para cualquier método.
 */
export default function handler(_req: VercelRequest, res: VercelResponse): void {
  res.status(200).json({ status: 'ok' });
}
