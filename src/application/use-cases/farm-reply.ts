// Salida uniforme de los casos de uso del módulo farm (LogFarmEvent,
// ConfirmFarmEvent, QueryFarmState, Register*): solo el texto a responder.
// Estos casos de uso NO envían por el canal; el orquestador
// (HandleIncomingMessage) es quien entrega, para que la regla de formato
// voz/texto (§2 de PLAN-v1.1.md) viva en un solo lugar y se puedan probar
// sin canal ni síntesis de voz.
export interface FarmReply {
  readonly text: string;
}
