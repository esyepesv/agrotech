/**
 * Despoja el JSON de la salida de un LLM. Aunque se pida
 * `response_format: { type: 'json_object' }`, algunos modelos (en particular
 * Claude vía OpenRouter) envuelven la respuesta en un bloque de código
 * markdown (```json ... ```) o anteponen/añaden texto. Esta función deja
 * únicamente el objeto JSON para `JSON.parse`, sin decidir nada de negocio:
 * es traducción de formato, no lógica.
 */
export function extractJsonObject(raw: string): string {
  const trimmed = raw.trim();

  // Bloque de código markdown: ```json\n{...}\n``` o ```\n{...}\n```
  const fenced = trimmed.match(/```(?:json)?\s*([\s\S]*?)\s*```/i);
  const candidate = fenced?.[1]?.trim() ?? trimmed;

  // Recorta cualquier texto antes del primer `{` o después del último `}`
  // (p. ej. "Aquí tienes: {...}"). Si no hay llaves, se devuelve tal cual
  // para que JSON.parse falle de forma explícita río abajo.
  const start = candidate.indexOf('{');
  const end = candidate.lastIndexOf('}');
  if (start === -1 || end === -1 || end < start) {
    return candidate;
  }
  return candidate.slice(start, end + 1);
}
