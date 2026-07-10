# PROGRESO — PorcIA v1.1

## 1. Estado general

- **Corte actual:** Corte 0 — COMPLETADO (DoD verde). Siguiente: Corte 1.
- **Avance del ciclo (Cortes 0–4):** ~25%

## 2. Checklist por corte

### Corte 0 — Esqueleto del módulo farm

- [x] Fase A: PLAN-v1.1.md aprobado (2026-07-09)
- [x] Rama `feat/v1.1-corte-0` + PROGRESO inicial
- [x] `domain/farm/` + `domain/intent/` + tests puros de dominio (2026-07-10)
- [x] Puertos nuevos en `application/ports/` (12, incl. persistence-error) (2026-07-10)
- [x] Fakes in-memory en `test/application/fakes/` (10) (2026-07-10)
- [x] Casos de uso: LogFarmEvent, ConfirmFarmEvent, QueryFarmState, RegisterFarm/Sow/Lot (2026-07-10)
- [x] Cambio aditivo `AnswerQuery.handleResolved()` (suite v1 intacta) (2026-07-09)
- [x] `HandleIncomingMessage` (router + atajo determinista de confirmación) (2026-07-10)
- [x] Tests del orquestador (11) + suite trampa de seguridad (8 + 2 todo para Corte 4) (2026-07-10)
- [x] DoD: typecheck + lint + 118 tests verdes; cero cambio de runtime v1 (2026-07-10)

### Corte 1 — Persistencia real + Inventario end-to-end

- [x] Migración `supabase/migrations/0003_farm_module.sql` (2026-07-10) — **PENDIENTE DE APLICAR por Stiven (B1)**
- [x] Repositorios Supabase (farm, inventory, farm-event, pending-event + sow/lot mínimos) (2026-07-10)
- [x] `LlmIntentClassifier` + `LlmEventExtractor` (OpenRouter + zod; needsVetReview forzado por sistema) (2026-07-10)
- [x] Env vars nuevas (`INTENT_MODEL`, `EXTRACTOR_MODEL`, `PENDING_EVENT_TTL_SECONDS`) + `.env.example` (2026-07-10)
- [x] Cableado en container + dispatcher + runtime serverless (2026-07-10)
- [x] RegisterFarm mínimo con cierre anónimo (`ConfirmFarmEvent.handleAnonymous`) (2026-07-10)
- [x] Pruebas e2e reales (Supabase + OpenRouter): persistencia, clasificador, extractor y flujo inventario compra→consumo→saldo→gasto (2026-07-10)
- [ ] Escenario manual por Telegram (requiere merge + deploy) — pendiente por Stiven
- [x] DoD unitario verde (143 pass / 13 skip); e2e verde salvo escenario Telegram

### Corte 2 — Lotes (pre-cebo/ceba)

- [ ] Ciclo de lote + conversión alimenticia + costo por kg + consultas

### Corte 3 — Cría individual

- [ ] Eventos reproductivos + KPIs (diasAbiertos, partosPorAno) + onboarding por chapeta

### Corte 4 — Plan sanitario (read-back) + seguridad

- [ ] StaticSanitaryPlanProvider + seed + remind_from_plan + suite de seguridad completa

## 3. Decisiones tomadas

- **2026-07-09 — Migraciones en `supabase/migrations/`** (no `scripts/migrations/`): es la convención real del repo (0001/0002), aplicación manual documentada.
- **2026-07-09 — Reutilizar `USER_ID_SALT`** para el hash del operario: el hallazgo de hash reversible ya estaba cerrado en v1 con HMAC-SHA256; §10 del doc pide "mismo hasheo que v1".
- **2026-07-09 — Puerto nuevo `EventSafetyPolicy`** en vez de extender `SafetyPolicy` v1: respeta la regla de oro "agregar, no modificar" e ISP.
- **2026-07-09 — `AnswerQuery.handleResolved()` aditivo** para evitar doble transcripción Whisper cuando el router ya resolvió el texto.
- **2026-07-09 — Env por modelo (`INTENT_MODEL`, `EXTRACTOR_MODEL`)** en vez de por proveedor: v1 ya es proveedor-agnóstico vía OpenRouter.
- **2026-07-09 — Defaults P1–P5 aprobados en modo autónomo**: imagen diferida; desconocidos viven v1; haiku para intención; alta de granja auto-servicio; prueba manual por Telegram.
- **2026-07-09 — Corte 0 no toca producción**: el container sigue exponiendo solo v1; el orquestador se cablea con fakes solo en tests hasta el Corte 1.
- **2026-07-10 — `PlanScope` como unión discriminada** (`{kind:'standard'} | {kind:'farm', farmId}`) en vez de `'standard' | FarmId`: ese literal colapsa a `string` (lint lo rechazó) y la unión hace tipado el chequeo de override.
- **2026-07-10 — `parseShortReply` en dominio** (`domain/intent/short-reply.ts`): atajo determinista de confirmación/cancelación sin LLM, ≤4 palabras, normaliza tildes/signos.
- **2026-07-10 — Casos de uso farm devuelven `FarmReply` (texto), no envían por gateway**: la entrega (voz/texto) y el registro del turno viven solo en el orquestador; se prueban sin canal.
- **2026-07-10 — `idGenerator` inyectado** en ConfirmFarmEvent/RegisterFarm: application no importa `node:crypto`; el container inyectará `randomUUID` en Corte 1.
- **2026-07-10 — Turnos farm se registran con `action: 'answer'`**: `ConversationTurn.action` solo admite acciones de SafetyDecision v1; distinguir ramas farm en métricas queda para más adelante si hace falta.
- **2026-07-10 — Cierre del alta de granja para usuario 100% anónimo queda en Corte 1** (el "sí" de un no-operario no puede resolver ConfirmFarmEvent aún): coincide con "RegisterFarm mínimo" listado en el Corte 1 del plan.
- **2026-07-10 — `ConfirmFarmEvent.handleAnonymous(reply, hash)`**: el pending de un usuario no registrado vive bajo el hash del canal y solo puede ser un alta de granja; cualquier otro pending anónimo se descarta. El orquestador usa `pendingKey = operatorId | hash`.
- **2026-07-10 — Repos Supabase de sow/lot creados ya en Corte 1** (el plan los difería a Cortes 2–3): `ConfirmFarmEvent` los exige en deps y las tablas ya existen; evita adaptadores no-op.
- **2026-07-10 — `cleanFarmName` quita frases de intención** ("quiero registrar mi granja X" → "X"); si no queda nada, pregunta el nombre.
- **2026-07-10 — needsVetReview siempre true por sistema** en el extractor (regla dura §12.2 reforzada): el modelo nunca decide ese campo.
- **2026-07-10 — Bug e2e corregido: fences markdown en salida LLM.** Claude vía OpenRouter envuelve el JSON en ```json ... ``` aunque se pida `json_object`; se añadió `extractJsonObject` (`src/infrastructure/llm/json-output.ts`) que despoja fences/texto antes de `JSON.parse`. Sin esto, TODA rama farm por LLM fallaba en producción. Detectado solo por la prueba e2e real (la suite unitaria usa fakes).
- **2026-07-10 — "¿cuánto llevo gastado?" = consumo valorado, no compras.** QueryFarmState suma qty×costo de los movimientos `out` del mes (coincide con arquitectura-v1.1 §1 "cuánto llevo gastado en el lote 7" = costo imputado). En el e2e: comprar 10 y consumir 3 → gasto $285.000 (3×95.000), no $950.000. Es intencional; si Stiven prefiere "dinero desembolsado" (compras), es un cambio de una consulta.

## 4. Bloqueos y preguntas abiertas

- **B1 (ACTIVO):** `supabase/migrations/0003_farm_module.sql` ya está lista y **debe aplicarla Stiven** en Supabase (SQL Editor o `supabase db push`) antes de probar el Corte 1 end-to-end por Telegram. Hasta entonces, el bot en producción con el nuevo router respondería con errores de persistencia en las ramas farm (las preguntas de conocimiento siguen funcionando: caen en AnswerQuery).
- Limitación conocida (Corte 1): si un usuario anónimo responde el nombre de su granja en un turno separado ("¿Cómo se llama tu granja?" → "Villa Clara"), depende de que el clasificador marque ese texto como onboarding; si lo marca unknown, cae al asesor. El flujo multi-turno robusto queda anotado como mejora.

## 5. Próximo paso concreto

**Esperando a Stiven (B1): aplicar `0003_farm_module.sql` en Supabase.** En cuanto esté:

1. Correr los specs de integración reales (`vitest` con `.env` local: Supabase + OpenRouter) y ajustar lo que falle.
2. Merge de PR #1 (Corte 0) y PR #2 (Corte 1) → deploy en Vercel.
3. Escenario manual por Telegram (guion en el PR #2) y ajustes.
4. Solo entonces se cierra el Corte 1 y arranca el Corte 2.

Regla nueva (2026-07-10, pedida por Stiven): **cada corte cierra con pruebas end-to-end reales**, no solo la suite unitaria.

## 6. Última actualización

- **2026-07-10 ~13:05** — Migración aplicada (B1 resuelto). Pruebas e2e reales corridas: encontrado y corregido el bug de fences markdown (`ed2eb43`); flujo inventario completo verde contra Supabase+OpenRouter. DoD unitario 143 pass. Falta solo el escenario manual por Telegram (requiere merge+deploy). Los 2 fallos de la suite con credenciales son tests de integración de v1 (llm-answer-generator, speech-roundtrip) por timeout de 5s, no regresiones.
- **2026-07-10 ~12:55** — Corte 1 código-completo (`aca5ef5`): cableado de producción, alta anónima, 137 tests verdes. PR #2 abierto (stacked sobre PR #1). Sonda confirma que la migración 0003 AÚN NO está aplicada en Supabase (spec de integración se salta) → esperando B1 para e2e.
- **2026-07-10 ~08:20** — Corte 0 COMPLETADO (`24caa38`): 6 casos de uso, orquestador, RuleBasedEventSafetyPolicy, 21 tests nuevos (118 pass total). DoD verde. Producción v1 sin tocar.
- **2026-07-10 ~07:55** — Fase 1 del Corte 0 commiteada (`0572db8`, 40 archivos): dominio farm/intent, 12 puertos, 10 fakes, 22 tests nuevos. Typecheck/lint/tests verdes (99 pass). Corregido `PlanScope` (lint). Avance ~10%.
- **2026-07-09 ~00:15** — Fase A cerrada (PLAN-v1.1.md escrito y aprobado); creado PROGRESO-v1.1.md; arrancando Corte 0.
