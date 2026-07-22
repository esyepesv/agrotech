import type { InteractiveLayout, ReplyOption } from '../../domain/message/reply-option.js';

// Salida uniforme de los casos de uso del módulo farm (LogFarmEvent,
// ConfirmFarmEvent, QueryFarmState, Register*): el texto a responder y,
// opcionalmente (spec 001 §4.1.1), las opciones cerradas del paso vigente.
// Estos casos de uso NO envían por el canal; el orquestador
// (HandleIncomingMessage) es quien entrega, para que la regla de formato
// voz/texto (§2 de PLAN-v1.1.md) y la de botones/fallback numérico vivan en
// un solo lugar y se puedan probar sin canal ni síntesis de voz.
//
// Extensión aditiva: `options`/`layout`/`requestContact` son opcionales, así
// que los casos de uso existentes (LogFarmEvent, ConfirmFarmEvent, ...) que
// solo devuelven `{ text }` siguen compilando y comportándose igual.
export interface FarmReply {
  readonly text: string;
  readonly options?: readonly ReplyOption[];
  readonly layout?: InteractiveLayout;
  // Telegram: pedir el número compartiendo contacto nativo (`request_contact`,
  // spec 001 §4.1.2). Ignorado por canales/gateways que no lo soportan.
  readonly requestContact?: boolean;
}
