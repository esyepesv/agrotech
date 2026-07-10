# PROGRESO — PorcIA v1.1

## 1. Estado general

- **Corte actual:** Corte 0 — Esqueleto del módulo farm (en memoria)
- **Avance del ciclo (Cortes 0–4):** ~5% (Fase A cerrada, Corte 0 arrancando)

## 2. Checklist por corte

### Corte 0 — Esqueleto del módulo farm
- [x] Fase A: PLAN-v1.1.md aprobado (2026-07-09)
- [x] Rama `feat/v1.1-corte-0` + PROGRESO inicial
- [ ] `domain/farm/` + `domain/intent/` + tests puros de dominio
- [ ] Puertos nuevos en `application/ports/` (11)
- [ ] Fakes in-memory en `test/application/fakes/` (10)
- [ ] Casos de uso: LogFarmEvent, ConfirmFarmEvent, QueryFarmState, RegisterFarm/Sow/Lot
- [ ] Cambio aditivo `AnswerQuery.handleResolved()` (suite v1 intacta)
- [ ] `HandleIncomingMessage` (router + atajo determinista de confirmación)
- [ ] Tests del orquestador (ruteo, registrar→confirmar→persistir, "no" cancela, campos faltantes, pregunta→AnswerQuery, desconocido→ofrece registro, pending expirado)
- [ ] DoD: typecheck + lint + tests verdes; cero cambio de runtime v1

### Corte 1 — Persistencia real + Inventario end-to-end
- [ ] Migración `supabase/migrations/0003_farm_module.sql`
- [ ] Repositorios Supabase (farm, inventory, farm-event, pending-event)
- [ ] `LlmIntentClassifier` + `LlmEventExtractor` (OpenRouter + zod)
- [ ] Env vars nuevas (`INTENT_MODEL`, `EXTRACTOR_MODEL`, `PENDING_EVENT_TTL_SECONDS`) + `.env.example`
- [ ] Cableado en container + dispatcher + runtime serverless
- [ ] RegisterFarm mínimo + siembra de inventario conversacional
- [ ] Escenario manual por Telegram (compra → consumo voz → confirmar → saldo → gasto)
- [ ] DoD

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

## 4. Bloqueos y preguntas abiertas

- **B1 (futuro, Corte 1):** la migración `0003_farm_module.sql` es de aplicación manual — Stiven debe aplicarla en Supabase (SQL Editor o `supabase db push`) antes de la prueba end-to-end. Se avisará aquí cuando esté lista.
- Sin bloqueos activos para el Corte 0.

## 5. Próximo paso concreto

Implementar el esqueleto del Corte 0: dominio `farm` + `intent`, puertos, fakes, casos de uso y router, con tests verdes.

## 6. Última actualización

- **2026-07-09 ~00:15** — Fase A cerrada (PLAN-v1.1.md escrito y aprobado); creado PROGRESO-v1.1.md; arrancando Corte 0.
