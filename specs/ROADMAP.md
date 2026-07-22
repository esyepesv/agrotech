# Roadmap spec-por-spec — PorcIA v1.2+

> **Cómo se usa este documento.** Es el **índice** de la secuencia de specs hacia la captación de datos productivos como eje central del producto (ver `../arquitectura-v1.2.md`). Cada spec es un corte pequeño e independiente: se escribe el documento (`specs/NNN-nombre.md`, estructura de 5 secciones), se aprueba, y solo entonces se implementa. Este índice **no** contiene el detalle interno de cada spec.
>
> Estructura de cada spec: **Resumen General · Objetivos del Usuario · Alcance Estricto (Incluye v1 / NO incluye v1) · Comportamiento Esperado · Manejo de Errores.**

| # | Spec | Qué resuelve (una frase) | Puertos / casos de uso nuevos | Estado |
|---|---|---|---|---|
| 001 | [`register-farm-and-user`](001-register-farm-and-user.md) | Alta de dueño + granja, granja adicional, y trabajador (solicitud o invitación) con aprobación del dueño — un caso de uso agnóstico de canal | Casos de uso `RegisterFarmAndUser`, `ApproveWorker`; dominio `AppUser`, `Operator` como membresía; extensión de `FarmRepository` | **Escrito — pendiente de aprobación** |
| 002 | `otp-auth-web-session` | Verificación de posesión del celular por OTP (WhatsApp/Telegram) y emisión de sesión JWT propia para la web | Puertos `OtpStore`, `OtpSender`, `SessionIssuer` | Pendiente |
| 003 | `register-conversation-chat` | Adaptador conversacional multi-turno en WhatsApp/Telegram (sin OTP), con botones nativos y respuesta por nota de voz, que alimenta el caso de uso 001 | Caso de uso `RegisterFarmAndUserConversation`; puerto `InteractiveGateway` (botones/listas) + VOs `ReplyOption`/`InteractiveMessage`; variante nueva de `PendingDraft` (reemplaza a `RegisterFarm` en el cableado) | Pendiente |
| 004 | `register-web-api` | Contrato REST (`/register/*`, búsqueda de fincas) + adaptadores HTTP Fastify y funciones Vercel, con CORS | `interfaces/http/register-routes.ts`, `api/register/*` | Pendiente |
| 005 | `register-frontend-app` | App React en `app/` que implementa el wizard del diseño `Registro.dc.html` (rol → cuenta → OTP → finca/búsqueda → equipo → éxito → perfil) | — (consume 004; sin puertos backend nuevos) | Pendiente |
| 006 | `seleccion-granja-activa` | Desambiguación de granja en chat para usuarios con varias membresías (regla de "granja activa") | Extensión del contexto de resolución de operario en `HandleIncomingMessage` (aditiva) | Pendiente |
| 007 | `inventario-consumo-concentrado` | Primer corte funcional del eje de datos: inventario + consumo de concentrado (Corte 1 de v1.1, re-priorizado) | Reutiliza puertos v1.1 (`InventoryRepository`, `EventExtractor`, `FarmEventStore`, …) | Pendiente (código base existe) |
| 008 | `lotes-precebo-ceba` | Ciclo de lote: conversión alimenticia, costo por kg (Corte 2 de v1.1) | — | Pendiente |
| 009 | `cria-individual` | Cría por cerda: días abiertos, partos/año, onboarding progresivo de cerdas (Corte 3 de v1.1) | — | Pendiente |
| 010 | `plan-sanitario-read-back` | Recordatorios de plan sanitario validado (`remind_from_plan`) + suite de seguridad (Corte 4 de v1.1) | `SanitaryPlanProvider` real | Pendiente |
| 011 | `proactividad-read-api` | Push saliente (plantillas WhatsApp aprobadas) + `read-api/` de solo lectura para dashboard | Puerto `Scheduler`; `ReminderPolicy` (dominio) | Pendiente (futuro) |

## Notas de secuencia

- **001–005 forman el ciclo actual** (registro multi-canal completo: backend + chat + web). Se implementan en ese orden; 002–004 son specs cortos porque 001 ya fija el dominio.
- **006** se vuelve necesario en cuanto exista el primer usuario multi-granja; puede adelantarse si el piloto lo exige.
- **007–010** re-priorizan los cortes ya diseñados en `arquitectura-v1.1.md` §16–17 bajo el nuevo eje; sus specs se redactarán referenciando ese documento en lugar de duplicarlo.
- **011** hereda la restricción de plantillas de WhatsApp (`arquitectura-v1.1.md` §13, `arquitectura-v1.2.md` §9).
- Un spec futuro de **login/recuperación de sesión web** (reutiliza `SessionIssuer` + endpoints OTP de 002) se numerará cuando se priorice; hoy está explícitamente fuera de alcance de 001/002.
