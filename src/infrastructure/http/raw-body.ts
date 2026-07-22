import type { IncomingMessage } from 'node:http';

/**
 * Lee el body crudo (bytes exactos) de un IncomingMessage. Necesario para
 * verificar HMACs de webhooks (p. ej. X-Hub-Signature-256 de Meta, #1
 * hardening), que se calculan sobre el body tal como llegó, no sobre una
 * re-serialización de `req.body` ya parseado.
 *
 * En @vercel/node, `addHelpers()` ya consume el stream original para poblar
 * `req.body`, pero antes de hacerlo reemplaza `req.on`/`req.addListener`/
 * `req.read` por un PassThrough que repite los mismos bytes crudos
 * (ver `restoreBody` en el paquete `@vercel/node`). Por eso leer el stream
 * aquí —sin importar el orden respecto a acceder a `req.body`— sigue
 * devolviendo exactamente el body que envió el proveedor.
 */
export function readRawBody(req: IncomingMessage): Promise<Buffer> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      chunks.push(chunk);
    });
    req.on('end', () => {
      resolve(Buffer.concat(chunks));
    });
    req.on('error', (error: Error) => {
      reject(error);
    });
  });
}
