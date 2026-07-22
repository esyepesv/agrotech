# CLAUDE.md — porcia-backend

## Qué es este proyecto

Backend de **PorcIA**, asistente porcícola para pequeños/medianos productores en Colombia. El **eje central del producto es la captación de datos productivos de la granja** (inventario, eventos, ciclo reproductivo); el **asesor de conocimiento por voz** (RAG + WhatsApp/Telegram) es una capacidad secundaria que coexiste con él. Node.js + TypeScript estricto, arquitectura hexagonal (puertos y adaptadores), Supabase (Postgres + pgvector), canales WhatsApp Cloud API y Telegram Bot API.

## Documentos fuente de la verdad (leer antes de tocar código)

- `arquitectura.md` — v1, el asesor de voz. Principios vinculantes (§3) y ruta de extensión (§17).
- `../arquitectura-v1.1.md` (raíz del monorepo local, fuera de este repo git) — módulo granja: dominio, ledger `farm_event`, confirmación obligatoria, seguridad (§12).
- `arquitectura-v1.2.md` — giro al eje de datos: identidad (`AppUser` + membresías), registro multi-canal, OTP + sesión web.
- `specs/ROADMAP.md` — índice spec-por-spec. `specs/001-register-farm-and-user.md` es el spec activo.
- `PLAN-v1.1.md` / `PROGRESO-v1.1.md` — estado real de implementación de v1.1 (Corte 0/1 código-completo, en pausa).

## Regla de oro (no negociable)

> **Agregar = escribir un adaptador nuevo; nunca modificar el núcleo.** (`arquitectura.md` §17)

- `domain/` y `application/` de versiones anteriores solo se **extienden**, jamás se modifican. `AnswerQuery` y el pipeline RAG están **intactos** y así se quedan.
- La regla de dependencia siempre apunta al centro: `interfaces → application → domain`. Infraestructura implementa puertos definidos en `application/ports/`.
- **Flujo spec-first:** ninguna feature se implementa sin su spec en `specs/` aprobado por Stiven. Al terminar un spec, PARAR y esperar aprobación.

## Convenciones

- TS `strict`, sin `any`. `Result<T, E>` para fallos esperables; excepciones solo para bugs.
- zod valida env (`src/config/env.ts`, fail-fast) y webhooks. Un solo composition root: `src/config/container.ts` (único archivo que conoce clases concretas).
- Tests con vitest: dominio puro sin mocks; casos de uso con **fakes in-memory** (`test/application/fakes/`); adaptadores con tests de integración. Correr `npm test` antes de dar algo por terminado — los tests de v1/v1.1 deben seguir verdes sin modificación.
- Archivos `kebab-case.ts`, clases `PascalCase`, un export principal por archivo. Commits convencionales (`feat:`, `fix:`, …).
- Términos de dominio en español (`porcicultor`, `diasAbiertos`, `chapeta`); ver glosarios de arquitectura.md §final y v1.1 §19.

## Cómo corre

- **Local:** servidor Fastify (`src/interfaces/http/server.ts`), rutas `/webhook/*`, `/health`. `npm run dev`.
- **Producción:** funciones serverless de Vercel en `api/` (`api/webhook/whatsapp.ts`, `api/webhook/telegram.ts`, `api/health.ts`) sobre el runtime memoizado `src/interfaces/serverless/runtime.ts`. Las rutas llevan prefijo `/api/*`. Ambas superficies llaman a los mismos casos de uso — nunca duplicar lógica entre ellas.
- LLM de generación vía OpenRouter (`LLM_BASE_URL`/`LLM_MODEL`); STT (Whisper), TTS y embeddings directo a OpenAI (`OPENAI_API_KEY`). Se registran **todos** los canales cuyas credenciales estén presentes (WhatsApp + Telegram simultáneos).

## Estado operativo a tener en cuenta

- Migraciones en `supabase/migrations/` son idempotentes y se aplican **manualmente**: `0003_farm_module.sql` (y siguientes) **pendientes de aplicar en producción**. Verificar antes de asumir que una tabla existe.
- WhatsApp está limitado a **números de prueba** (Business Verification de Meta pendiente). Telegram es el canal de desarrollo.
- No hay usuarios reales registrados: cambios de contrato de dominio de v1.1 (p. ej. renombrar roles) son de bajo riesgo todavía.
- WhatsApp no permite iniciar conversaciones fuera de la ventana de 24 h sin plantillas pre-aprobadas — ninguna feature puede depender de push saliente (ver `arquitectura-v1.2.md` §9).
- Identidad por `channel_user_hash` = HMAC-SHA256 con `USER_ID_SALT` (`src/infrastructure/security/user-id-hash.ts`). Reutilizar siempre ese mecanismo; nunca guardar teléfonos en claro salvo donde el spec lo defina (OTP, corta vida).

## Guardrails de seguridad (no diluir)

El bot aconseja sobre animales vivos: temas sanitarios/medicación/dosis → `escalate_vet`, siempre. Registrar un hecho ≠ aconsejar (v1.1 §12). La suite de preguntas "trampa" debe pasar siempre. El registro de usuarios (v1.2) no pasa por `SafetyPolicy` porque es identidad, no consejo — pero tampoco debe debilitar nada de lo anterior.
