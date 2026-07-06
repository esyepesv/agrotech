import { createHmac, timingSafeEqual } from 'node:crypto';

const SIGNATURE_PREFIX = 'sha256=';

/**
 * Verifica la firma X-Hub-Signature-256 que Meta añade a los POST de los
 * webhooks de WhatsApp Cloud API (#1 hardening): HMAC-SHA256 del body con
 * el App Secret de la app, codificado como hex con el prefijo `sha256=`.
 *
 * CRÍTICO: `rawBody` debe ser los bytes EXACTOS recibidos (string/Buffer
 * crudo), nunca un JSON re-serializado — cualquier diferencia de espacios,
 * orden de claves o encoding hace que el HMAC no coincida aunque el
 * contenido "signifique" lo mismo.
 *
 * Comparación con timingSafeEqual para evitar timing attacks; maneja
 * longitudes distintas o un header ausente/malformado sin lanzar.
 */
export function verifyMetaSignature(
  rawBody: string | Buffer,
  signatureHeader: string | undefined,
  appSecret: string,
): boolean {
  if (signatureHeader === undefined || !signatureHeader.startsWith(SIGNATURE_PREFIX)) {
    return false;
  }

  const providedHex = signatureHeader.slice(SIGNATURE_PREFIX.length);
  const expectedHex = createHmac('sha256', appSecret).update(rawBody).digest('hex');

  const provided = Buffer.from(providedHex, 'hex');
  const expected = Buffer.from(expectedHex, 'hex');

  // Buffer.from(..., 'hex') no lanza con hex inválido (trunca en el primer
  // carácter no válido); una longitud distinta ya basta para rechazar antes
  // de llamar a timingSafeEqual, que exige buffers del mismo tamaño.
  if (provided.length !== expected.length) {
    return false;
  }
  return timingSafeEqual(provided, expected);
}
