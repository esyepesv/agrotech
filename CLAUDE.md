# CLAUDE.md — porcia-backend

## Qué es este proyecto

Backend de **PorcIA**, asistente porcícola para pequeños/medianos productores en Colombia. El **eje central del producto es la captación de datos productivos de la granja** (inventario, eventos, ciclo reproductivo); el **asesor de conocimiento por voz** (RAG + WhatsApp/Telegram) es una capacidad secundaria que coexiste con él. Node.js + TypeScript estricto, arquitectura hexagonal (puertos y adaptadores), Supabase (Postgres + pgvector), canales WhatsApp Cloud API y Telegram Bot API.

## Documentos fuente de la verdad (leer antes de tocar código)

- `arquitectura.md` — v1, el asesor de voz. Principios vinculantes (§3) y ruta de extensión (§17).
- `../arquitectura-v1.1.md` (raíz del monorepo local, fuera de este repo git) — módulo granja: dominio, ledger `farm_event`, confirmación obligatoria, seguridad (§12).
- `arquitectura-v1.2.md` — giro al eje de datos: identidad (`AppUser` + membresías), registro multi-canal, OTP + sesión web.
- `specs/ROADMAP.md` — índice spec-por-spec. `specs/001-register-farm-and-user.md` es el spec base del ciclo; **`specs/013-endurecimiento-registro-y-sesion.md` fija las reglas vigentes de identidad, duplicados y sesión — léelo antes de tocar registro o login.**
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

- **Local:** servidor Fastify (`src/interfaces/http/server.ts`), rutas `/webhook/*`, `/health` y `/leads`. `npm run dev`.
- **Producción:** funciones serverless de Vercel en `api/` (`api/webhook/whatsapp.ts`, `api/webhook/telegram.ts`, `api/health.ts`, `api/leads.ts`) sobre el runtime memoizado `src/interfaces/serverless/runtime.ts`. Las rutas llevan prefijo `/api/*`. Ambas superficies llaman a los mismos casos de uso — nunca duplicar lógica entre ellas.
- LLM de generación vía OpenRouter (`LLM_BASE_URL`/`LLM_MODEL`); STT (Whisper) y embeddings directo a OpenAI (`OPENAI_API_KEY`). Se registran **todos** los canales cuyas credenciales estén presentes (WhatsApp + Telegram simultáneos).
- **Voz del bot (TTS):** ElevenLabs si `ELEVENLABS_API_KEY` está definida; si falta, cae al TTS de OpenAI (`TTS_MODEL`/`TTS_VOICE`). La elección vive en `buildSynthesizer` (`config/container.ts`), no repetida en cada sitio. Mismo criterio que los canales: una credencial ausente apaga una capacidad, nunca tumba el arranque.

## Contrato HTTP vigente (spec 001 §4.2 + spec 013)

Rutas locales (Fastify) sin prefijo; en Vercel llevan `/api`. Todos los errores viajan como **`{ error: { code, message } }`** — el `message` ya está redactado en español con el tono de marca, así que los clientes deben usarlo en vez de mantener su propia copia.

- `GET /register/otp-transports` · `POST /register/request-otp` · `POST /register/verify-otp`
- `GET /register/farms/search?q=` (cuota por IP)
- `POST /register/check-availability` — `{identificationType, identificationNumber}` o `{email}` → `{available}`. POST y no GET para no dejar cédulas ni correos en los logs de acceso.
- `POST /register` → `201` con sesión; `409 duplicate_identification|duplicate_email|duplicate_farm|already_member`; `404 farm_not_found`; `400 validation`
- `POST /account/request-otp|verify-otp` (autenticados) · **`GET /account/me`** → persona + membresías del token; `401 unauthorized`. **Nunca devuelve el celular**: solo existe hasheado.
- `POST /auth/destinations|request-otp|verify-otp` — login. `destinations` responde igual exista o no la cuenta.

## Estado operativo a tener en cuenta

- Migraciones en `supabase/migrations/` son idempotentes y se aplican **manualmente** (nunca solas). `0001`–`0006` y `0009_landing_lead.sql` están **aplicadas en producción**. Toda migración nueva nace pendiente: verificar antes de asumir que una tabla existe.
- **Despliegue a producción: NO ocurre con `git push`.** La rama de trabajo (`feat/v1.2-spec-001-registro`) no es la de producción del proyecto Vercel `agrotech`, así que empujar solo crea un *preview*. Producción se promueve a mano con `npx vercel --prod` desde `backend/`. Verificarlo siempre después de desplegar (p. ej. `GET /api/account/me` debe dar 401, no 405).
- **La base se vació el 2026-07-23** para probar desde cero: `app_user`, `farm`, `operator`, `worker_invitation`, `otp_code`, `pending_event` y `processed_message` quedaron en 0. `knowledge_chunk` (36 filas, corpus del RAG) y `landing_lead` se conservaron intactos.
- Los contactos de `porcia-web` entran por `POST /api/leads`: conservar la idempotencia, el rate limit y la tabla `landing_lead` con RLS (solo `service_role` inserta). El aviso SMTP va a `LEAD_NOTIFICATION_TO`.
- WhatsApp está limitado a **números de prueba** (Business Verification de Meta pendiente). Telegram es el canal de desarrollo.
- No hay usuarios reales registrados: cambios de contrato de dominio de v1.1 (p. ej. renombrar roles) son de bajo riesgo todavía.
- WhatsApp no permite iniciar conversaciones fuera de la ventana de 24 h sin plantillas pre-aprobadas — ninguna feature puede depender de push saliente (ver `arquitectura-v1.2.md` §9).
- Identidad por `channel_user_hash` = HMAC-SHA256 con `USER_ID_SALT` (`src/infrastructure/security/user-id-hash.ts`). Reutilizar siempre ese mecanismo; nunca guardar teléfonos en claro salvo donde el spec lo defina (OTP, corta vida).

## Respuestas por voz en el registro (no volver a romper)

Contestar el registro por nota de voz debe funcionar igual que por texto o botón. Lo que lo hacía fallar no era la transcripción sino el emparejamiento, así que:

- `matchOption` (`domain/message/reply-option.ts`) empareja, además de por id/número/ordinal/etiqueta, por **afirmación coloquial** (reutiliza `parseShortReply`) y por **palabras distintivas** de cada etiqueta. Whisper devuelve frases naturales con puntuación ("Soy dueño."), no la etiqueta exacta.
- **Ante una respuesta ambigua se repregunta, no se adivina**: "cédula" no puede elegir sola entre ciudadanía y extranjería. Si se agregan opciones nuevas, revisar que cada una tenga al menos una palabra que no comparta con las demás.
- `normalizeSpokenNumber` acepta el número aunque venga con palabras alrededor o con el punto final que agrega Whisper.
- El correo **sí** se dicta ("arroba", "punto") y se lee de vuelta antes de guardarlo, igual que cédula y NIT. Esto revierte la regla de spec 001 §4.1.3.

## Guardrails de seguridad (no diluir)

El bot aconseja sobre animales vivos: temas sanitarios/medicación/dosis → `escalate_vet`, siempre. Registrar un hecho ≠ aconsejar (v1.1 §12). La suite de preguntas "trampa" debe pasar siempre. El registro de usuarios (v1.2) no pasa por `SafetyPolicy` porque es identidad, no consejo — pero tampoco debe debilitar nada de lo anterior.
