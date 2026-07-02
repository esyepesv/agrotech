/**
 * Errores base para fallos INESPERADOS (bugs, configuración rota).
 * Los fallos esperables del flujo usan Result<T, E> (sección 14).
 */
export class AppError extends Error {
  constructor(
    message: string,
    override readonly cause?: unknown,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ConfigurationError extends AppError {}
