# Porcia — Backend (Asistente Porcícola de Voz)

Backend de **Porcia**. Su eje es la captura de datos productivos de granjas porcinas; el asistente de conocimiento por voz por Telegram o WhatsApp complementa ese flujo y **escala a un veterinario** cuando el tema es sanitario o de medicación. Ver `arquitectura-v1.2.md` para el enfoque actual y `arquitectura.md` para el diseño del asistente.

**Producción:** desplegado en Vercel en `https://agrotech-beryl.vercel.app` (auto-deploy en cada push a `main`, repo conectado a Vercel). Health check: `GET /api/health`.

## Leads de la landing

`POST /api/leads` recibe los formularios de piloto y aliados de `porcia-web`.
Persiste los contactos en `landing_lead` y envía un aviso a
`LEAD_NOTIFICATION_TO` mediante SMTP. La migración
`supabase/migrations/0009_landing_lead.sql` ya está aplicada en producción;
aplíquela también en cada entorno nuevo antes de recibir leads. Incluye el
origen de la landing en `CORS_ALLOWED_ORIGINS`.

| Ruta | Método | Requisitos | Respuesta |
| --- | --- | --- | --- |
| `/api/leads` | `POST` | `Idempotency-Key`, consentimiento y datos del tipo `pilot` o `partner` | `201 { ok: true }` |

El endpoint limita a 5 envíos por IP/hora, valida los payloads con Zod y
acepta un campo trampa `website` para descartar bots. Para desarrollo local,
configura `CORS_ALLOWED_ORIGINS=http://localhost:5173` y usa el prefijo local
`POST /leads`; en Vercel la ruta es `POST /api/leads`.

## Stack

| Capa                    | Elección                                                                                                                    |
| ----------------------- | --------------------------------------------------------------------------------------------------------------------------- |
| Lenguaje                | Node.js 22+, TypeScript `strict`                                                                                            |
| HTTP (desarrollo local) | Fastify (`src/interfaces/http/server.ts`)                                                                                   |
| Producción              | Funciones serverless de Vercel (`api/`) + `@vercel/functions` (`waitUntil`)                                                 |
| Canales                 | Telegram Bot API y WhatsApp Business Cloud API (Meta) — **ambos activos a la vez** si hay credenciales                      |
| LLM (generación)        | Cualquier modelo vía **OpenRouter** (API compatible con OpenAI chat completions); por defecto `anthropic/claude-sonnet-4.5` |
| STT / TTS / Embeddings  | **OpenAI directo**: Whisper (`whisper-1`), **ElevenLabs** TTS (`eleven_multilingual_v2`), `text-embedding-3-small`                             |
| Vector store + datos    | Supabase (Postgres + `pgvector`)                                                                                            |
| Validación              | zod (config y payloads de webhooks)                                                                                         |
| Logging                 | pino                                                                                                                        |
| Tests                   | vitest + adaptadores fake                                                                                                   |
| Lint/format             | ESLint + Prettier                                                                                                           |

## Estructura de carpetas

```
src/
├── domain/                      # Núcleo puro: value objects, Result<T,E>, ChannelDeliveryError
├── application/
│   ├── ports/                   # Contratos: Transcriber, SpeechSynthesizer, KnowledgeRetriever,
│   │                             #   Embedder, AnswerGenerator, SafetyPolicy, ChannelGateway, ConversationLog
│   └── use-cases/answer-query.ts
├── infrastructure/               # Adaptadores: Whisper, TTS ElevenLabs, LLM vía OpenRouter, PgVectorRetriever,
│                                 #   RuleBasedSafetyPolicy, TelegramGateway, WhatsAppGateway, SupabaseConversationLog
├── interfaces/
│   ├── http/                    # Servidor Fastify local: server.ts, dispatcher.ts, dedup.ts,
│   │                             #   telegram-webhook.ts, whatsapp-webhook.ts (parsers puros + registro de rutas)
│   └── serverless/runtime.ts    # Runtime compartido por las funciones de api/: container memoizado
│                                 #   entre invocaciones calientes, dedup y processIncoming
├── config/                      # env.ts (validación zod) + container.ts (composition root)
└── shared/                      # logger.ts, errors.ts

api/                              # Funciones serverless de Vercel (producción)
├── health.ts                    # GET /api/health
├── leads.ts                     # POST /api/leads (formularios de porcia-web)
└── webhook/
    ├── telegram.ts               # POST /api/webhook/telegram
    └── whatsapp.ts                # GET (verificación Meta) + POST /api/webhook/whatsapp

scripts/
└── ingest-knowledge.ts           # Pipeline offline de ingestión del corpus (knowledge/*.md → pgvector)

supabase/migrations/
└── 0001_knowledge_chunk.sql      # knowledge_chunk, conversation_turn, función match_knowledge_chunks

knowledge/                        # Documentos semilla del corpus (front matter: topic, source, validado_por, region)

test/                             # vitest: domain/, application/ (fakes in-memory), infrastructure/, interfaces/
```

## Requisitos previos y credenciales

- **Node.js 22+**
- **Telegram (dev/test):** crear un bot con [@BotFather](https://t.me/BotFather) y copiar el token → `TELEGRAM_BOT_TOKEN`.
- **OpenRouter (LLM):** crear cuenta en [openrouter.ai](https://openrouter.ai), generar una API key → `LLM_API_KEY`. El modelo se elige en `LLM_MODEL` (default `anthropic/claude-sonnet-4.5`); cualquier modelo compatible con chat completions sirve.
- **OpenAI (STT/embeddings):** crear una API key en [platform.openai.com](https://platform.openai.com) → `OPENAI_API_KEY`. Se usa para Whisper y embeddings — **no** para la generación de respuestas.
- **ElevenLabs (TTS):** crear una API key en [elevenlabs.io](https://elevenlabs.io) → `ELEVENLABS_API_KEY`. Se usa para sintetizar las notas de voz de respuesta.
- **Supabase:** crear un proyecto en [supabase.com](https://supabase.com), habilitar la extensión `vector` (la migración ya incluye `create extension if not exists vector`, pero el plan debe soportarla) y copiar `SUPABASE_URL` / `SUPABASE_SERVICE_KEY` (Service Role key, no la `anon`).
- **WhatsApp Cloud API de Meta (opcional, piloto):** crear una app en [developers.facebook.com](https://developers.facebook.com) con el producto **WhatsApp Business Cloud API**, obtener `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`, y definir tú mismo un `WHATSAPP_VERIFY_TOKEN` (string secreto arbitrario). Meta limita a 5 números de prueba hasta pasar la verificación de negocio. Copiar también el **App Secret** de "Configuración básica" de la app → `WHATSAPP_APP_SECRET` (ver sección "Seguridad" abajo).
- **`USER_ID_SALT`** (requerido): pepper secreto (≥16 caracteres, p. ej. 64 hex aleatorios generados con `openssl rand -hex 32`) usado para el HMAC del hash de usuario en `conversation_turn`. Debe mantenerse constante entre despliegues (cambiarlo hace que el mismo usuario genere un `user_hash` distinto).

## Setup local

```bash
npm install
cp .env.example .env
# completar .env con las credenciales reales
```

Aplicar la migración de Supabase (crea `knowledge_chunk`, `conversation_turn` y la función RPC `match_knowledge_chunks`):

```bash
supabase link --project-ref <tu-project-ref>
supabase db push
# o pegar el contenido de supabase/migrations/0001_knowledge_chunk.sql en el SQL Editor del panel
```

Ingestar el corpus semilla (`knowledge/*.md`):

```bash
npm run ingest
```

El script (`scripts/ingest-knowledge.ts`) es idempotente: por cada documento, borra los chunks previos de esa misma fuente antes de insertar los nuevos, así que se puede re-ejecutar cada vez que cambie un `.md` sin duplicar filas.

> Los documentos actuales en `knowledge/` están marcados `validado_por: PENDIENTE zootecnista` — sirven para desarrollar y probar el pipeline, pero **no están aptos para producción con productores reales** hasta esa revisión (ver "Pendientes" abajo).

Levantar el servidor de desarrollo:

```bash
npm run dev
```

Esto arranca Fastify en `http://localhost:$PORT` (por defecto 3000) con:

- `GET /health` → `{ status: 'ok' }`
- `POST /webhook/telegram` — se registra solo si `TELEGRAM_BOT_TOKEN` está definido
- `GET|POST /webhook/whatsapp` — se registra solo si `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID` y `WHATSAPP_VERIFY_TOKEN` están definidos

El servidor registra **cada canal cuyas credenciales estén presentes**, así que puede atender Telegram y WhatsApp a la vez. `ACTIVE_CHANNEL` ya no limita qué webhooks se exponen: solo indica el canal "principal" y determina qué credenciales son obligatorias para que la configuración valide al arranque (`config/env.ts`, zod — si falta algo requerido, el proceso no levanta).

Detalles de arranque a tener en cuenta:

- `server.ts` carga `.env` con `process.loadEnvFile('.env')` si el archivo existe; en producción (Vercel) las variables las provee la plataforma, así que esta carga es opcional y no falla si el archivo no está.
- `loadEnv` trata como **ausente** cualquier variable presente pero vacía (por ejemplo, una copia fresca de `.env.example` sin completar), para que los `.optional()`/`.default()` de zod apliquen en vez de fallar por `.min(1)`/`.url()`.

## Exponer webhooks en local

Para probar contra Telegram/WhatsApp reales desde tu máquina, expón el puerto local con un túnel HTTPS:

```bash
cloudflared tunnel --url http://localhost:3000
# o
ngrok http 3000
```

Registrar el webhook de Telegram con la URL del túnel:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://<tu-tunel>/webhook/telegram"
```

Para WhatsApp, en el panel de Meta configurar la **Callback URL** como `https://<tu-tunel>/webhook/whatsapp` y el **Verify Token** con el mismo valor de `WHATSAPP_VERIFY_TOKEN`; Meta hace un `GET` con `hub.mode=subscribe` que el servidor responde con `hub.challenge` si el token coincide. Suscribirse al campo `messages` del webhook.

## Despliegue en Vercel

En producción, la lógica corre como funciones serverless en `api/` (el servidor Fastify es solo para desarrollo local). Ambos adaptadores de entrada comparten los mismos parsers puros y el mismo caso de uso a través de `src/interfaces/serverless/runtime.ts`, que memoiza el container (clientes de OpenAI/OpenRouter/Supabase) entre invocaciones de una misma instancia caliente — no duplica lógica de negocio. Los handlers responden `200` de inmediato y delegan el procesamiento a `waitUntil` (`@vercel/functions`) para no bloquear la respuesta ni arriesgarse a que la función se recicle antes de terminar de procesar en background.

Rutas expuestas:

- `GET /api/health`
- `POST /api/leads`
- `POST /api/webhook/telegram`
- `GET|POST /api/webhook/whatsapp` (`GET` = verificación de Meta, `POST` = mensajes entrantes)

`vercel.json` fija `maxDuration: 300` en `api/**/*.ts` (margen para las llamadas encadenadas de STT/LLM/TTS) y define un `buildCommand` no-op (Vercel detecta y compila las funciones de `api/` automáticamente; no hay build de servidor propio en producción).

Pasos:

1. Conectar el repositorio en el dashboard de Vercel (Import Project). Con esto, cada push a `main` dispara un deploy automático.
2. En **Settings → Environment Variables**, configurar las mismas claves que en `.env.example`: `TELEGRAM_BOT_TOKEN`, `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`, `WHATSAPP_APP_SECRET`, `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`, `OPENAI_API_KEY`, `STT_MODEL`, `ELEVENLABS_API_KEY`, `ELEVENLABS_VOICE_ID`, `ELEVENLABS_MODEL`, `ELEVENLABS_OUTPUT_FORMAT`, `EMBEDDINGS_MODEL`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`, `USER_ID_SALT`, `RAG_MIN_SCORE`, `LOG_LEVEL`, `ACTIVE_CHANNEL`. `PORT` no aplica en serverless.
3. Desplegar con `vercel --prod` (o dejar que el auto-deploy de `main` lo haga).
4. Registrar los webhooks apuntando al dominio del deploy:
   - Telegram: `https://<tu-deploy>.vercel.app/api/webhook/telegram`
   - WhatsApp: `https://<tu-deploy>.vercel.app/api/webhook/whatsapp` (misma URL como "Callback URL" en el panel de Meta, con el `WHATSAPP_VERIFY_TOKEN` configurado como "Verify Token")

## Seguridad

- **Verificación de firma de webhooks (WhatsApp).** Si `WHATSAPP_APP_SECRET` está configurado, el `POST /webhook/whatsapp` (tanto en Fastify como en la función serverless de Vercel) verifica el header `X-Hub-Signature-256` que Meta calcula como HMAC-SHA256 del **raw body** con el App Secret, usando `src/infrastructure/security/meta-signature.ts` (comparación con `timingSafeEqual`). Si la firma falta o no coincide, responde `401` sin procesar el mensaje. El raw body se obtiene sin re-serializar `req.body`: en Fastify vía el plugin `fastify-raw-body` (acotado a esa ruta), y en Vercel leyendo el stream del request directamente (`src/infrastructure/http/raw-body.ts`), aprovechando que `@vercel/node` deja el stream original re-leíble tras poblar `req.body`. Si `WHATSAPP_APP_SECRET` no está definido, se omite la verificación y se loguea una advertencia (para no romper despliegues existentes mientras se configura). El App Secret nunca se loguea.
- **Hash de usuario con pepper.** `channelUserId` se guarda en `conversation_turn` como `HMAC-SHA256(channelUserId, USER_ID_SALT)` (`src/infrastructure/persistence/supabase-conversation-log.ts`), no como SHA-256 pelado: sin el pepper (`USER_ID_SALT`, requerido, ≥16 caracteres) el hash no es reproducible por fuerza bruta/diccionario.
- **Umbral de relevancia del RAG.** `AnswerQuery` descarta los chunks recuperados con `score < RAG_MIN_SCORE` (default `0.35`) antes de decidir si hay contexto suficiente para responder; si no queda ninguno, responde el mensaje de "no sé" en vez de generar con contexto poco relevante.
- **Guardrail de salida (`reviewAnswer`).** Además del guardrail de entrada (`assessQuestion`, sobre la pregunta), `AnswerQuery` revisa el borrador ya redactado por el LLM con `SafetyPolicy.reviewAnswer` antes de entregarlo: si el borrador contiene contenido de medicación/dosis/síntomas (aunque la pregunta original haya sido permitida), se reemplaza por el mensaje de escalamiento/rechazo y se registra esa acción en `conversation_turn`.
- **Idempotencia de webhooks en dos niveles.** `SeenMessages` (memoria, por proceso) sigue como fast-path L1; `SupabaseMessageDeduplicator` (tabla `processed_message`) es la autoridad L2 compartida entre instancias/invocaciones serverless — necesaria porque cada invocación de Vercel puede caer en una lambda distinta. Si la tabla aún no existe (migración `0002_processed_message.sql` sin aplicar), falla abierto (procesa el mensaje) para no dejar el bot caído.

## Scripts

| Script              | Qué hace                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`       | Levanta el servidor Fastify local con recarga (`tsx watch`)                        |
| `npm run build`     | Compila TypeScript a `dist/`                                                       |
| `npm run start`     | Corre la build compilada (`dist/src/interfaces/http/server.js`)                    |
| `npm run typecheck` | `tsc --noEmit`                                                                     |
| `npm run lint`      | ESLint (incluye la regla de dependencia hexagonal)                                 |
| `npm run format`    | Prettier `--write`                                                                 |
| `npm test`          | Vitest (unitarios + guardrails; los de infraestructura se saltan sin credenciales) |
| `npm run ingest`    | Pipeline offline de ingestión del corpus                                           |

Correr los tests:

```bash
npm test
```

Estado actual: la suite cubre dominio, aplicación, endpoints de registro y el
endpoint de leads. Los tests de integración de infraestructura (LLM,
embeddings, STT/TTS y persistencia en Supabase) usan `describe.skipIf`: se
saltan automáticamente cuando no hay credenciales reales en el entorno, sin
fallar el CI por su ausencia.

## Estado actual y pendientes

### Implementado y desplegado

- Fases 0, 1 y 2 del roadmap original: esqueleto hexagonal con adaptadores fake, pipeline real end-to-end, y ambos canales (Telegram + WhatsApp) sirviendo en producción de forma simultánea.
- RAG contra el corpus en Supabase/pgvector, con búsqueda vectorial exacta.
- Guardrails de escalamiento a veterinario (`RuleBasedSafetyPolicy.assessQuestion`) con suite de tests dedicada.
- Idempotencia de webhooks en dos niveles (dedup por `messageId`: `SeenMessages` en memoria como L1, `SupabaseMessageDeduplicator`/`processed_message` como L2 compartida entre instancias serverless) y patrón responder-200-rápido + procesar en background, tanto en el servidor local como en las funciones serverless.
- Propagación explícita de errores de envío al canal (`ChannelDeliveryError`) en vez de tragarlos en silencio.
- Métricas básicas vía `ConversationLog` (`conversation_turn`: canal, hash del usuario, pregunta, respuesta, acción, latencia).
- Privacidad: `channelUserId` se guarda como HMAC-SHA256 + pepper (`USER_ID_SALT`) en `conversation_turn`, nunca en claro ni con un hash pelado.
- Verificación de firma `X-Hub-Signature-256` en el webhook de WhatsApp (con `WHATSAPP_APP_SECRET`), umbral mínimo de relevancia en el RAG (`RAG_MIN_SCORE`) y guardrail de salida (`reviewAnswer`) cableado en `AnswerQuery` — ver sección "Seguridad".
- Guardrails de escalamiento ampliados con expresiones coloquiales de síntomas ("no come", "no se levanta", "cojea", "hinchado", etc.) sin bloquear preguntas de manejo rutinario.
- Captura de leads de la landing: tabla `landing_lead` con RLS, inserción solo
  desde `service_role`, idempotencia, rate limit, CORS y notificación SMTP.

### Pendientes conocidos

1. **Corpus sin validar por un zootecnista** (el mayor pendiente de valor). Solo hay 3 documentos de ejemplo en `knowledge/`, todos marcados `validado_por: PENDIENTE zootecnista`. No usar con productores reales hasta que un profesional los revise y apruebe.
2. **WhatsApp limitado a 5 números de prueba** hasta completar la verificación de negocio de Meta (`Business Verification`).
3. **Migración `supabase/migrations/0002_processed_message.sql` (tabla `processed_message`, dedup L2) pendiente de aplicar manualmente** (`supabase db push` o pegarla en el SQL Editor de Supabase). Mientras no se aplique, `SupabaseMessageDeduplicator` falla abierto (trata cada mensaje como primera vez) y el bot sigue funcionando igual que antes de este cambio.
4. **Métricas avanzadas / PostHog** no construidas. Hoy las métricas viven únicamente en `conversation_turn` (Supabase); no hay dashboard ni un `AnalyticsSink` separado.
