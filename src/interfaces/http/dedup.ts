/**
 * Deduplicación de webhooks (sección 14): los proveedores reintentan,
 * así que se ignora un messageId ya visto. Set acotado en memoria con
 * expulsión FIFO; suficiente para el MVP (un proceso).
 */
export class SeenMessages {
  private readonly seen = new Set<string>();
  private readonly order: string[] = [];

  constructor(private readonly capacity = 5_000) {}

  firstSight(id: string): boolean {
    if (this.seen.has(id)) {
      return false;
    }
    this.seen.add(id);
    this.order.push(id);
    if (this.order.length > this.capacity) {
      const evicted = this.order.shift();
      if (evicted !== undefined) {
        this.seen.delete(evicted);
      }
    }
    return true;
  }
}
