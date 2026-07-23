export type AppUserId = string;

// Códigos de `public.identification_type` en Postgres. Mantener este
// catálogo sincronizado con la migración 0007: es el contrato entre dominio,
// API, conversación y base de datos.
export const IDENTIFICATION_TYPES = ['TI', 'CC', 'CE', 'PPT', 'PEP', 'PA'] as const;

export type IdentificationType = (typeof IDENTIFICATION_TYPES)[number];

export function isIdentificationType(value: string): value is IdentificationType {
  return (IDENTIFICATION_TYPES as readonly string[]).includes(value);
}

// Persona registrada (v1.2 separa identidad de persona de membresía de
// granja — arquitectura-v1.2.md §5). Única por (identificationType,
// identificationNumber).
//
// (hashed-zooming-flame.md, Tarea 1) Separa dos conceptos que antes vivían
// en una sola columna:
// - phoneHash: de qué celular dijo ser dueño. SIEMPRE se escribe al
//   registrar, verificado o no — no sirve para reconocer a nadie en chat,
//   solo para el emparejamiento explícito de invitaciones de trabajador
//   (spec 001 §4.3).
// - channelUserHash / telegramUserHash: identidad de chat PROBADA por el
//   canal (WhatsApp: el channelUserId ES el celular; Telegram: solo tras
//   "Compartir mi número"). Son las ÚNICAS columnas que HandleIncomingMessage
//   usa para reconocer a alguien — así se conserva la garantía de que
//   registrarse con el número de otra persona no da acceso a su chat.
//
// Antes de esta separación, channelUserHash solo se escribía si el celular
// quedaba verificado; al sacar el OTP del registro (giro de producto v1.2)
// eso habría dejado a cualquier persona sin NINGÚN dato con el que el bot
// pudiera reconocerla después.
export interface AppUser {
  readonly id: AppUserId;
  readonly identificationType: IdentificationType;
  readonly identificationNumber: string;
  readonly phoneHash: string;
  readonly channelUserHash?: string;
  readonly telegramUserHash?: string;
  readonly phoneVerifiedAt?: Date;
  readonly emailVerifiedAt?: Date;
  readonly email: string;
  readonly displayName?: string;
  readonly createdAt: Date;
}
