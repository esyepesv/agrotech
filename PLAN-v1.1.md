# PLAN — PorcIA v1.1 · Módulo de Gestión de Granja

> Salida de la Fase A de `instrucciones-claude-code-v1.1.md`. Fuente de diseño: `arquitectura-v1.1.md` (raíz de `porcia/`); principios vinculantes: `arquitectura.md`. Aprobado por Stiven el 2026-07-09 (modo autónomo, defaults de §10 aplicados).

## 0. Estado del repo al arrancar (verificado)

- **Repo verde**: `tsc --noEmit` ✓, `eslint .` ✓, `vitest run` → 77 pass / 5 skipped (integración sin credenciales). Working tree limpio en `main` (`06b5992`).
- El repo git es `backend/` (la carpeta `porcia/` es solo contenedor local; ver `docs/superpowers/specs/2026-07-08-porcia-reorganizacion-design.md`).

### Discrepancias documento ↔ código (y cómo se resuelven)

| #   | Doc dice                                                                           | Código real                                                                                                                                                                                                                  | Resolución                                                                                                                                                               |
| --- | ---------------------------------------------------------------------------------- | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| D1  | Migraciones en `scripts/migrations/` (§7 v1.1)                                     | `supabase/migrations/000N_*.sql`, idempotentes, aplicación **manual** (`PENDIENTE DE APLICAR`)                                                                                                                               | Seguir la convención real: `supabase/migrations/0003_farm_module.sql`                                                                                                    |
| D2  | Nueva env `USER_HASH_SECRET` "cierra el hallazgo de hash reversible" (§15 v1.1)    | Ya cerrado: `USER_ID_SALT` (min 16 chars, requerida) + HMAC-SHA256 en `SupabaseConversationLog`                                                                                                                              | **Reutilizar `USER_ID_SALT`** para `operator.channel_user_hash` (el propio §10 pide "mismo hasheo con sal secreta que v1"). No se crea env nueva                         |
| D3  | "los webhooks enrutan a HandleIncomingMessage" (§7 v1.1)                           | Los webhooks NO llaman al caso de uso: lo hacen `AnswerQueryDispatcher.processInBackground()` (Fastify) y `processIncoming()` (`serverless/runtime.ts`, Vercel) — ambos vía `container.answerQuery.handle(message, gateway)` | El punto de inserción son esas **dos líneas** + `Container`. Los webhooks/parsers no se tocan                                                                            |
| D4  | `SafetyPolicy` "se extiende con `assessEvent`" (§12 v1.1)                          | Regla de oro #2: no modificar puertos v1; añadir un método al interface obliga a tocar `RuleBasedSafetyPolicy` y su fake                                                                                                     | **Puerto nuevo separado** `EventSafetyPolicy` (ISP). El v1 queda intacto                                                                                                 |
| D5  | El router clasifica sobre el texto; `AnswerQuery.handle()` transcribe internamente | Delegarle el mensaje de voz re-transcribiría (doble Whisper: costo+latencia)                                                                                                                                                 | Cambio **aditivo** en `AnswerQuery`: extraer un método público `handleResolved(message, gateway, {question, locale})`; `handle()` lo llama y no cambia de comportamiento |
| D6  | v1.1 menciona entrada por **imagen** (OCR)                                         | `MessageType = 'text' \| 'voice'`; ningún corte 0–4 la exige                                                                                                                                                                 | **Imagen diferida** fuera de v1.1 (default P1 aprobado)                                                                                                                  |
| D7  | `INTENT_PROVIDER`/`EVENT_EXTRACTOR_PROVIDER` = anthropic\|openai (§15)             | v1 resuelve LLM vía OpenRouter (`LLM_API_KEY`/`LLM_BASE_URL`) — proveedor-agnóstico por modelo                                                                                                                               | Env vars por **modelo**, no por proveedor: `INTENT_MODEL`, `EXTRACTOR_MODEL` (defaults, mismo cliente OpenRouter)                                                        |

---

## 1. Mapa de impacto en el repo

### Archivos NUEVOS (todo aditivo)

```
src/domain/farm/            farm.ts, operator.ts, sow.ts, lot.ts, pen.ts,
                            inventory-item.ts, inventory-movement.ts,
                            farm-event.ts (unión discriminada + FarmEventDraft),
                            sanitary-plan.ts, plan-task.ts, kpis.ts, farm-context.ts
src/domain/intent/          intent.ts
src/application/ports/      intent-classifier.ts, event-extractor.ts, farm-repository.ts,
                            inventory-repository.ts, sow-repository.ts, lot-repository.ts,
                            farm-event-store.ts, pending-event-store.ts,
                            sanitary-plan-provider.ts, event-safety-policy.ts, clock.ts
src/application/use-cases/  handle-incoming-message.ts, log-farm-event.ts,
                            confirm-farm-event.ts, query-farm-state.ts,
                            register-farm.ts, register-sow.ts, register-lot.ts
src/infrastructure/intent/       llm-intent-classifier.ts
src/infrastructure/extraction/   llm-event-extractor.ts
src/infrastructure/persistence/  supabase-farm-repository.ts, supabase-inventory-repository.ts,
                                 supabase-sow-repository.ts, supabase-lot-repository.ts,
                                 supabase-farm-event-store.ts, supabase-pending-event-store.ts
src/infrastructure/safety/       rule-based-event-safety-policy.ts
src/infrastructure/plans/        static-sanitary-plan-provider.ts
src/infrastructure/time/         system-clock.ts
supabase/migrations/        0003_farm_module.sql (Corte 1)
scripts/                    seed-sanitary-plan.ts (Corte 4)
test/domain/farm/           kpis.spec.ts, farm-event.spec.ts, ...
test/application/           handle-incoming-message.spec.ts, log-farm-event.spec.ts,
                            confirm-farm-event.spec.ts, query-farm-state.spec.ts,
                            farm-safety.spec.ts (suite "trampa")
test/application/fakes/     fake-intent-classifier.ts, fake-event-extractor.ts,
                            fake-inventory-repository.ts, fake-farm-repository.ts,
                            fake-sow-repository.ts, fake-lot-repository.ts,
                            fake-farm-event-store.ts, fake-pending-event-store.ts,
                            fake-event-safety-policy.ts, fake-clock.ts
PLAN-v1.1.md, PROGRESO-v1.1.md
```

### Archivos TOCADOS (mínimos, solo cableado)

| Archivo                                     | Cambio                                                                                                                                 |
| ------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------- |
| `src/config/container.ts`                   | Construye los adaptadores nuevos; `Container` gana `handleIncomingMessage` (mantiene `answerQuery`)                                    |
| `src/config/env.ts`                         | + `INTENT_MODEL`, `EXTRACTOR_MODEL`, `PENDING_EVENT_TTL_SECONDS` (con defaults → no rompe despliegues)                                 |
| `src/interfaces/http/dispatcher.ts`         | 1 línea: `answerQuery.handle(...)` → `handleIncomingMessage.handle(...)`                                                               |
| `src/interfaces/serverless/runtime.ts`      | 1 línea: ídem                                                                                                                          |
| `src/application/use-cases/answer-query.ts` | **Solo aditivo** (D5): se extrae `handleResolved()` público; `handle()` delega en él. Cero cambio de comportamiento; tests v1 intactos |
| `.env.example`                              | Nuevas vars sin valores                                                                                                                |

### NO se toca

- Pipeline RAG completo: `knowledge-retriever`, `pgvector-retriever`, `llm-answer-generator`, `llm-embedder`, `scripts/ingest-knowledge.ts`.
- `SafetyPolicy` (puerto v1) y `RuleBasedSafetyPolicy` + su suite (30 tests).
- Canales (`telegram-gateway`, `whatsapp-gateway`), speech (Whisper/TTS), webhooks/parsers (`*-webhook.ts`), handlers `api/` de Vercel, dedup L1/L2, `meta-signature`, `SupabaseConversationLog`, migraciones 0001/0002.
- `domain/` v1 (message, query, knowledge, safety, shared).

---

## 2. Inserción de `HandleIncomingMessage`

Ambos dispatchers (D3) cambian una línea; la firma exterior es idéntica, así que webhooks y `api/` no se enteran.

```
handle(message, gateway):
  operator = farmRepository.findOperatorByHash(hmac(message.channelUserId))   // null si no registrado
  resolved = resolveText(message, gateway)          // texto directo, o fetchAudio+transcribe (UNA vez)
  if resolved == undefined → mensaje STT_FAILED (igual que v1) y return

  // Atajo determinista ANTES del LLM: si hay pending y el texto es corto
  // afirmación/negación ("sí","no","confirmo","cancela","después") → confirm/cancel
  if operator != null && esConfirmacionCorta(resolved) → ConfirmFarmEvent.handle(...) y return

  intent = intentClassifier.classify(resolved.question, farmContext(operator))
  switch intent.kind:
    question | unknown | baja confianza → answerQuery.handleResolved(message, gateway, resolved)  // v1, rama por defecto
    log_event    → LogFarmEvent      (si operator == null → onboarding: ofrecer RegisterFarm)
    query_state  → QueryFarmState    (ídem)
    onboarding   → RegisterFarm
    confirm/cancel → ConfirmFarmEvent (sin pending → "no tengo nada pendiente")
```

Claves de diseño:

- **Rama por defecto = v1.** `question`, `unknown` y baja confianza caen en `AnswerQuery`: un usuario no registrado que solo pregunta vive la experiencia v1 exacta.
- **Transcripción única** (D5): el orquestador resuelve el texto y se lo pasa a `AnswerQuery.handleResolved()`.
- Las respuestas de los casos de uso farm respetan la regla de formato v1 (voz→voz, texto→texto) reutilizando `SpeechSynthesizer` con la misma degradación elegante.
- El orquestador registra el turno en `ConversationLog` (puerto v1 reutilizado) para las ramas farm; la rama question ya lo hace dentro de `AnswerQuery`.

## 3. Modelo de dominio (confirmado con ajustes)

Se adopta §6 de `arquitectura-v1.1.md` tal cual (Farm, Operator, Sow, Lot, Pen, InventoryItem, InventoryMovement, FarmEvent, SanitaryPlan, PlanTask; uniones de evento FeedDelivery, InventoryPurchase, InventoryAdjustment, Insemination, HeatConfirmation, PenChange, Weaning, Farrowing, WeightControl, MedicationApplication, SanitaryTaskDone; KPIs `diasAbiertos`, `partosPorAno`, `conversionAlimenticia`, `consumoPorCerda`, `costoPorKg`, `diasParaCierreEstimado`). Ajustes:

1. **`FarmEventDraft`** = unión de payloads + `{ confidence, camposFaltantes: string[], rawTranscript, source: 'voice'|'text' }`. El extractor nunca persiste (guardrail).
2. **`PendingDraft`** (ajuste a §8): lo que guarda `PendingEventStore` es una unión `{ kind: 'farm_event', draft } | { kind: 'register_entity', entity: SowStub|LotStub|FarmStub }` — el onboarding progresivo ("¿La creo?") necesita el mismo mecanismo de confirmación que los eventos.
3. **`FarmContext`** (nuevo VO, insumo del clasificador/extractor): `{ farmId, operatorId, itemNames, chapetas, activeLots, hasPending }`. En Cortes 0/1 basta `itemNames` + `hasPending`.
4. **`MedicationApplication`** lleva `needsVetReview: boolean` (regla dura §12.2).
5. `Intent = { kind: 'question'|'log_event'|'query_state'|'onboarding'|'confirm'|'cancel'|'unknown', confidence }` — se agrega **`cancel`** (separarlo de confirm hace el router explícito).
6. KPIs e `Intent` en `domain/`, puros, con `Clock` inyectado donde hay tiempo; tests sin mocks.

## 4. Puertos nuevos (firmas finales) y consumidores

Firmas de §8 confirmadas, con `Result<T,E>` de v1 (`domain/shared/result.ts`) y estos ajustes:

```ts
// event-safety-policy.ts (NUEVO — reemplaza "extender SafetyPolicy", D4)
export interface EventSafetyPolicy {
  assessEvent(draft: FarmEventDraft): EventSafetyDecision;
}
// EventSafetyDecision = { action: 'register'|'register_flagged'|'escalate_vet'|'refuse', reason }

// pending-event-store.ts — guarda PendingDraft (ajuste 2), TTL por parámetro
export interface PendingEventStore {
  savePending(operatorId, draft: PendingDraft, ttlSeconds): Promise<Result<void, PersistenceError>>;
  takePending(operatorId): Promise<PendingDraft | null>; // lee-y-borra atómico
}

// farm-repository.ts — también resuelve identidad
export interface FarmRepository {
  findOperatorByHash(channelUserHash): Promise<{ operator: Operator; farm: Farm } | null>;
  saveFarm(farm): Promise<Result<void, PersistenceError>>;
  saveOperator(op): Promise<Result<void, PersistenceError>>;
}
```

Resto igual que §8: `IntentClassifier`, `EventExtractor`, `FarmEventStore` (append/listByFarm), `InventoryRepository` (getItem/applyMovement/listItems + `listMovements(farmId, periodo)` para "¿cuánto llevo gastado?"), `SowRepository`, `LotRepository`, `SanitaryPlanProvider`, `Clock`.

| Puerto                                                                                           | Consumido por                                                          |
| ------------------------------------------------------------------------------------------------ | ---------------------------------------------------------------------- |
| IntentClassifier                                                                                 | HandleIncomingMessage                                                  |
| EventExtractor                                                                                   | LogFarmEvent                                                           |
| EventSafetyPolicy                                                                                | LogFarmEvent (pre-pending) y ConfirmFarmEvent (re-chequeo barato)      |
| PendingEventStore                                                                                | LogFarmEvent, ConfirmFarmEvent, Register*                              |
| FarmEventStore                                                                                   | ConfirmFarmEvent (append), QueryFarmState (lecturas)                   |
| InventoryRepository                                                                              | ConfirmFarmEvent (proyección), QueryFarmState                          |
| FarmRepository                                                                                   | HandleIncomingMessage (identidad), RegisterFarm                        |
| SowRepository / LotRepository                                                                    | RegisterSow/RegisterLot, ConfirmFarmEvent, QueryFarmState (Cortes 2–3) |
| SanitaryPlanProvider                                                                             | QueryFarmState ("¿qué tengo pendiente?", Corte 4)                      |
| Clock                                                                                            | KPIs, TTL, HandleIncomingMessage                                       |
| (v1, reutilizados) Transcriber, SpeechSynthesizer, ChannelGateway, ConversationLog, SafetyPolicy | HandleIncomingMessage / AnswerQuery                                    |

## 5. Esquema BD y migraciones

- **`supabase/migrations/0003_farm_module.sql`** (Corte 1, D1): todas las tablas de §10 (`farm`, `operator`, `pen`, `sow`, `lot`, `inventory_item`, `inventory_movement`, `farm_event`, `sanitary_plan`) **más** `pending_event (operator_id uuid pk, draft jsonb, expires_at timestamptz)`. Idempotente (`create table if not exists`), encabezado `-- PENDIENTE DE APLICAR` como 0001/0002. Se crean todas de una vez aunque sow/lot/sanitary_plan se usen en Cortes 2–4: evita cadenas de FKs partidas (`inventory_movement.related_lot_id → lot`).
- Índices: los de §10 + unique `operator(channel_user_hash)`, `farm_event(farm_id, occurred_at)`, `inventory_movement(item_id, occurred_at)`, `pending_event(expires_at)`.
- Convivencia con v1: tablas nuevas junto a `knowledge_chunk`, `conversation_turn`, `processed_message`; cero cambios a las existentes.
- **Aplicación manual** (igual que 0002): requiere que Stiven la aplique (SQL Editor o `supabase db push`) antes de probar el Corte 1 end-to-end → bloqueo conocido B1.

## 6. Extractor e intent classifier

- **Proveedor**: mismo cliente OpenRouter de v1 (D7). Env: `INTENT_MODEL` (default `anthropic/claude-haiku-4.5`, barato/rápido), `EXTRACTOR_MODEL` (default = `LLM_MODEL`).
- **Formato de salida**: JSON estructurado, **validado con zod** en el adaptador; el schema zod refleja la unión discriminada de `FarmEventDraft`. JSON inválido o tipo desconocido → `err(ExtractionError)` → el caso de uso pide reformular (nunca adivina).
- **Campos faltantes**: el prompt exige `camposFaltantes[]`; si no está vacío, `LogFarmEvent` pregunta por lo que falta (guarda el draft parcial como pending para completarlo en el siguiente turno).
- **Baja confianza**: umbral constante (0.6). Intent < umbral → rama `question` (v1). Extracción dudosa → la confirmación obligatoria ES el mitigador (re-lee lo entendido antes de persistir).
- **Tests**: `FakeIntentClassifier` / `FakeEventExtractor` deterministas (mapa texto→salida fija programable por test). La suite unitaria jamás llama a un LLM real; los adaptadores LLM tienen specs de integración skip-sin-credenciales, como v1.

## 7. Estado conversacional (`PendingEventStore`)

- **Dónde vive**: tabla `pending_event` en Supabase. En memoria NO sirve: en Vercel cada mensaje puede caer en una lambda distinta (misma razón del dedup L2).
- **TTL**: `PENDING_EVENT_TTL_SECONDS` (default 600). `savePending` calcula `expires_at`; upsert por `operator_id` (un pending por operario; el nuevo pisa al viejo).
- **`takePending`**: `delete ... where operator_id = ? and expires_at > now() returning draft` — atómico, lee-y-borra.
- **Si expira**: el "sí" tardío encuentra null → "No tengo nada pendiente de confirmar. ¿Me repites el registro?". Filas vencidas se borran de forma perezosa en el siguiente save/take (sin cron).

## 8. Plan de seguridad

- `EventSafetyPolicy.assessEvent` (puerto nuevo, D4) + `RuleBasedEventSafetyPolicy` con la tabla §12: manejo/consumo/reproductivo → `register`; `MedicationApplication` → `register_flagged` (persiste el hecho con `needsVetReview`, sin validar ni comentar la dosis); nada en v1.1 genera consejo clínico nuevo.
- El asesor v1 (`RuleBasedSafetyPolicy.assessQuestion`) sigue cubriendo la rama `question` sin cambios: consejo sanitario ad-hoc y cálculo de dosis siguen → `escalate_vet`.
- `remind_from_plan` (Corte 4): solo cita `PlanTask` de un `SanitaryPlan` con `validatedBy` no nulo; sin plan validado, el caso de uso rehúsa el recordatorio.
- Confirmación obligatoria universal: ningún `FarmEvent` (sanitario o no) llega al ledger sin el "sí" del operario.

**Suite "trampa" (`test/application/farm-safety.spec.ts`)**:

1. "¿qué le doy a la cerda con fiebre?" → intent question → `escalate_vet` (v1).
2. "¿cuántos ml de oxitetraciclina le pongo a la 214?" → `escalate_vet`, aunque mencione una chapeta registrada.
3. "le apliqué 5 ml de X a la 214" → se registra como hecho (`register_flagged`); la respuesta NO valida ni corrige la dosis.
4. Recordatorio sanitario sin plan validado → rehúsa.
5. "vacuné al lote 7" con plan validado → registra `SanitaryTaskDone`, sin consejo adicional.
6. Draft de medicación pendiente + "sí" → persiste con `needsVetReview`; con "no" → descarta.
7. Regresión: las 30 pruebas de `safety.spec.ts` v1 siguen verdes sin modificación.
8. Ambigua salud/registro ("la cerda no come y no le di comida") → clasifica question → escala (prioridad salud).

## 9. Secuencia de cortes (ramas/PRs)

Rama por corte: `feat/v1.1-corte-N`; commits convencionales. DoD por corte: typecheck+lint+tests verdes, v1 sin cambios de comportamiento, `PROGRESO-v1.1.md` al día.

### Corte 0 — Esqueleto del módulo farm (todo en memoria)

1. Rama `feat/v1.1-corte-0`; `PROGRESO-v1.1.md` inicial.
2. `domain/farm/` completo (§3) + `domain/intent/intent.ts`. Tests puros de dominio (uniones de evento, KPIs con `FakeClock`).
3. Puertos (§4) en `application/ports/` (11 archivos).
4. Fakes in-memory en `test/application/fakes/` (10 fakes).
5. Casos de uso: `LogFarmEvent`, `ConfirmFarmEvent`, `QueryFarmState` (inventario básico), `RegisterFarm`, `RegisterSow`, `RegisterLot` (stubs mínimos progresivos).
6. Cambio aditivo en `AnswerQuery`: extraer `handleResolved()` (D5); suite v1 verde sin tocar sus tests.
7. `HandleIncomingMessage` con el router de §2 (atajo determinista de confirmación + clasificador).
8. **El Corte 0 no altera producción**: el container sigue exponiendo solo v1; el orquestador se cablea con fakes únicamente en tests. El cableado real llega en Corte 1.
9. Tests de `handle-incoming-message.spec.ts`: ruteo por intención; registrar→confirmar→persistir (fakes); "no" cancela; campos faltantes → pregunta; pregunta de conocimiento → `AnswerQuery`; usuario desconocido + intent farm → ofrece registro; pending expirado → mensaje claro.
10. DoD: flujo end-to-end en memoria; tests verdes; diff de runtime = solo el método aditivo en `AnswerQuery`.

### Corte 1 — Persistencia real + Inventario end-to-end

1. Migración `0003_farm_module.sql` (§5). **Stiven la aplica en Supabase (B1).**
2. Repositorios Supabase: `farm`, `inventory`, `farm-event-store`, `pending-event-store` (sow/lot en Cortes 2–3; el esquema ya existe).
3. `LlmIntentClassifier` + `LlmEventExtractor` (OpenRouter + zod, §6). Specs de integración skip-sin-credenciales.
4. `env.ts` + `.env.example`: `INTENT_MODEL`, `EXTRACTOR_MODEL`, `PENDING_EVENT_TTL_SECONDS` (todas con default).
5. `container.ts`: construir adaptadores reales, exponer `handleIncomingMessage`; cambiar la línea en `dispatcher.ts` y `runtime.ts`.
6. `RegisterFarm` mínimo (nombre granja + operario por hash) y siembra de inventario vía `InventoryPurchase`/`InventoryAdjustment` conversacional.
7. Identidad: hash del operario = HMAC-SHA256 con `USER_ID_SALT` (helper compartido extraído de forma aditiva, sin tocar `SupabaseConversationLog`).
8. Escenario manual por Telegram (DoD funcional): registrar compra → consumo por voz "di 3 bultos de X a la ceba" → confirmar → ledger + descuento → "¿cuánto me queda?" y "¿cuánto llevo gastado?".
9. DoD: escenario verde; ledger↔proyección consistentes; typecheck/lint/tests.

### Corte 2 — Lotes (pre-cebo/ceba)

Ciclo de lote (abrir, PenChange, WeightControl, cerrar), `SupabaseLotRepository`, `conversionAlimenticia` y `costoPorKg`, consultas de lote, onboarding progresivo de lotes.

### Corte 3 — Cría individual

`SupabaseSowRepository`, eventos reproductivos (Insemination, HeatConfirmation, Farrowing, Weaning), KPIs `diasAbiertos`/`partosPorAno`, onboarding progresivo por chapeta ("no tengo la 214, ¿la creo?").

### Corte 4 — Plan sanitario (read-back) + seguridad

`StaticSanitaryPlanProvider` + `scripts/seed-sanitary-plan.ts`, `remind_from_plan` solo con `validatedBy`, "¿qué tengo pendiente hoy?" (derivación bajo demanda, sin push), suite de seguridad §8 completa.

_(Corte 5 — proactividad/read-api: v1.2, fuera de este ciclo.)_

## 10. Riesgos y preguntas abiertas

**Preguntas — defaults aplicados por aprobación en modo autónomo (2026-07-09); Stiven puede revertir cualquiera:**

- **P1 — Imagen**: diferida fuera de v1.1; `MessageType` se extiende de forma aditiva cuando toque.
- **P2 — Usuario desconocido**: el asesor responde igual que v1 (anónimo); solo al intentar registrar/consultar granja se ofrece `RegisterFarm`.
- **P3 — Modelos**: `anthropic/claude-haiku-4.5` para intención; `LLM_MODEL` para extracción. Ajustable por env.
- **P4 — Alta de granjas**: auto-servicio por chat (es piloto).
- **P5 — Canal del piloto**: DoD del Corte 1 por Telegram; WhatsApp queda activo sin prueba manual dedicada.

**Riesgos:**

- **B1 — Migraciones manuales**: sin `0003` aplicada en Supabase, el Corte 1 no se prueba end-to-end. Se avisa en `PROGRESO-v1.1.md` cuando esté lista para aplicar.
- **R1 — Latencia/costo del router**: cada mensaje pasa por un LLM extra. Mitigación: modelo pequeño, prompt corto, atajos deterministas (confirmaciones sin LLM) y `question` como rama por defecto ante fallo del clasificador (v1 nunca queda peor).
- **R2 — Clasificación errónea**: "registro" clasificado como pregunta → v1 responde (inofensivo); "pregunta sanitaria" clasificada como registro → cubierto por suite trampa #8 + confirmación obligatoria.
- **R3 — Consistencia ledger↔proyección**: `append` + `applyMovement` son 2 escrituras sin transacción (PostgREST). Mitigación v1.1: orden fijo (ledger primero; si la proyección falla se loguea error con el eventId; la proyección es reconstruible desde el ledger por diseño). RPC transaccional queda anotada como mejora futura.
- **R4 — `handleResolved` aditivo en `AnswerQuery`**: única línea gris de "no tocar v1". La alternativa (re-transcribir) duplica costo Whisper por mensaje de voz. Se hace con la suite v1 como red.

## Verificación (cada corte)

`npm run typecheck && npm run lint && npm test` verdes; suite v1 sin modificar sus asserts; Corte 1 además: escenario manual por Telegram (compra → consumo por voz → confirmación → saldo → gasto) y consistencia ledger↔proyección verificada consultando Supabase.
