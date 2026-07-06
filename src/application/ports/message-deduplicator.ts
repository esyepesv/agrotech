/**
 * Autoridad de idempotencia de mensajes entrantes, compartida entre
 * instancias/invocaciones (a diferencia de SeenMessages, que es un fast-path
 * en memoria por proceso y no sirve en serverless). Ver
 * src/infrastructure/persistence/supabase-message-deduplicator.ts.
 */
export interface MessageDeduplicator {
  /**
   * true = primera vez que se ve este messageId → procesar.
   * false = ya se había visto → duplicado, ignorar.
   */
  firstSight(messageId: string): Promise<boolean>;
}
