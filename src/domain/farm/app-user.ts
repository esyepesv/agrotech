export type AppUserId = string;

export type IdentificationType = 'CC' | 'CE' | 'PA';

// Persona registrada (v1.2 separa identidad de persona de membresía de
// granja — arquitectura-v1.2.md §5). Única por (identificationType,
// identificationNumber); channelUserHash (HMAC-SHA256 + USER_ID_SALT, mismo
// mecanismo de v1/v1.1) es la llave de reconocimiento en chat.
//
// channelUserHash es OPCIONAL (ajuste de spec 001: OTP también por
// correo, y verificar solo el correo habilita el registro). Ese hash es lo
// que hace que el bot reconozca a la persona cuando escribe por WhatsApp;
// derivarlo de un celular que nadie verificó permitiría que alguien se
// registre con el número de otra persona (verificando solo su propio
// correo), y que el dueño real del número caiga, sin saberlo, dentro de esa
// cuenta ajena al escribirle al bot. Por eso el hash se guarda SOLO cuando
// el celular quedó verificado (phoneVerifiedAt no nulo); si la persona se
// registró verificando únicamente el correo, queda en NULL y su identidad
// de chat se liga después (ver RegisterFarmAndUser: "completar" el hash de
// una persona existente cuando por fin verifica su celular).
export interface AppUser {
  readonly id: AppUserId;
  readonly identificationType: IdentificationType;
  readonly identificationNumber: string;
  readonly channelUserHash?: string;
  readonly phoneVerifiedAt?: Date;
  readonly emailVerifiedAt?: Date;
  readonly email?: string;
  readonly displayName?: string;
  readonly createdAt: Date;
}
