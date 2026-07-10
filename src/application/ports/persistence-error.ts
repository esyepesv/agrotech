// Error compartido por los repositorios/almacenes nuevos del módulo farm.
export interface PersistenceError {
  readonly kind: 'persistence_failure';
  readonly message: string;
}

export function persistenceError(message: string): PersistenceError {
  return { kind: 'persistence_failure', message };
}
