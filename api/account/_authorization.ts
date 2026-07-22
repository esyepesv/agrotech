/** Extrae el Bearer header de un request Vercel sin propagar su `any` de tipos. */
export function authorizationHeader(headers: unknown): string | undefined {
  if (typeof headers !== 'object' || headers === null) {
    return undefined;
  }
  const value = (headers as Record<string, unknown>)['authorization'];
  if (typeof value === 'string') {
    return value;
  }
  return Array.isArray(value) && typeof value[0] === 'string' ? value[0] : undefined;
}
