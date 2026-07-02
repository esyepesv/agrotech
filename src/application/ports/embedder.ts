/**
 * Usado por el retriever en runtime y por el script de ingestión,
 * para que un solo lugar decida cómo se embeben los textos.
 */
export interface Embedder {
  embed(text: string): Promise<number[]>;
}
