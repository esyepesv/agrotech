# Asistente Porcícola de Voz

Asistente de conocimiento por voz para porcicultores pequeños/medianos en Colombia. Recibe preguntas de manejo por WhatsApp o Telegram (texto o nota de voz), las responde con base en un corpus curado (RAG) y escala a un veterinario cuando el tema es sanitario o de medicación. Ver `arquitectura.md` para la especificación completa (arquitectura hexagonal, puertos y adaptadores).

## Requisitos

- Node.js 22+
- Un proyecto de Supabase (Postgres + extensión `pgvector`)
- Una API key de OpenRouter (LLM) y una de OpenAI (Whisper STT, TTS, embeddings)
- Un bot de Telegram (dev/test) y/o una app de WhatsApp Business Cloud API (Meta) para el piloto

## Instalación

```bash
npm install
cp .env.example .env
# completar .env con las credenciales reales (ver sección "Variables de entorno")
```

## Variables de entorno

Ver `.env.example` para la lista completa. Resumen:

| Variable                                                                    | Para qué                                                     |
| --------------------------------------------------------------------------- | ------------------------------------------------------------ |
| `TELEGRAM_BOT_TOKEN`                                                        | Canal Telegram (dev/test)                                    |
| `WHATSAPP_TOKEN`, `WHATSAPP_PHONE_NUMBER_ID`, `WHATSAPP_VERIFY_TOKEN`       | Canal WhatsApp (Fase 2)                                      |
| `LLM_API_KEY`, `LLM_BASE_URL`, `LLM_MODEL`                                  | LLM vía OpenRouter (generación de respuestas)                |
| `OPENAI_API_KEY`, `STT_MODEL`, `TTS_MODEL`, `TTS_VOICE`, `EMBEDDINGS_MODEL` | Whisper (STT), TTS y embeddings, directo a OpenAI            |
| `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`                                      | Postgres + pgvector + logs de conversación                   |
| `PORT`, `LOG_LEVEL`, `ACTIVE_CHANNEL`                                       | Config de la app (`ACTIVE_CHANNEL`: `telegram` o `whatsapp`) |

La configuración se valida al arranque (`config/env.ts`, zod): si falta una variable requerida para el canal activo, el proceso no levanta.

## Correr en desarrollo

```bash
npm run dev
```

Levanta el servidor Fastify en `http://localhost:$PORT` (por defecto 3000) con:

- `GET /health` → `{ status: 'ok' }`
- `POST /webhook/telegram` o `POST /webhook/whatsapp` (según `ACTIVE_CHANNEL`)
- `GET /webhook/whatsapp` (verificación del webhook de Meta, solo si `ACTIVE_CHANNEL=whatsapp`)

## Aplicar la migración de Supabase

La migración `supabase/migrations/0001_knowledge_chunk.sql` crea:

- `knowledge_chunk` (corpus vectorizado, con índice `ivfflat`)
- `conversation_turn` (registro de conversaciones para métricas)
- la función RPC `match_knowledge_chunks` (recuperación por similitud coseno)

Aplicarla con el CLI de Supabase (recomendado):

```bash
supabase link --project-ref <tu-project-ref>
supabase db push
```

O pegar el contenido del archivo directamente en el SQL Editor del panel de Supabase.

## Ingestar el corpus de conocimiento

Los documentos semilla viven en `knowledge/*.md`. Cada uno debe llevar procedencia y validador en su encabezado (front matter `topic`, `source`, `validado_por`, `region`). **Los documentos actuales están marcados `validado por: PENDIENTE zootecnista` — no están aptos para producción hasta esa revisión.**

```bash
npm run ingest
```

El script (`scripts/ingest-knowledge.ts`) es idempotente: por cada documento, borra los chunks previos de esa misma fuente antes de insertar los nuevos, así que se puede re-ejecutar cada vez que cambie un `.md` sin duplicar filas.

## Configurar el webhook de Telegram

1. Crear un bot con [@BotFather](https://t.me/BotFather) y copiar el token a `TELEGRAM_BOT_TOKEN`.
2. Exponer el servidor local a internet (por ejemplo con un túnel: `ngrok http 3000`) o desplegarlo.
3. Registrar el webhook:

```bash
curl "https://api.telegram.org/bot$TELEGRAM_BOT_TOKEN/setWebhook?url=https://<tu-dominio>/webhook/telegram"
```

4. Enviar una nota de voz o un mensaje de texto al bot y verificar que responde en el mismo formato.

## Configurar el webhook de WhatsApp (Fase 2)

1. Crear una app de Meta con el producto **WhatsApp Business Cloud API** y obtener `WHATSAPP_TOKEN` y `WHATSAPP_PHONE_NUMBER_ID`.
2. Definir un `WHATSAPP_VERIFY_TOKEN` propio (cualquier string secreto que tú elijas).
3. En el panel de Meta, configurar la URL del webhook como `https://<tu-dominio>/webhook/whatsapp` y el "Verify Token" con el mismo valor de `WHATSAPP_VERIFY_TOKEN`. Meta hará un `GET` con `hub.mode=subscribe`; el servidor responde el `hub.challenge` si el token coincide.
4. Suscribirse al campo `messages` del webhook.
5. Poner `ACTIVE_CHANNEL=whatsapp` en `.env` y reiniciar el servidor.

## Scripts

| Script              | Qué hace                                                                           |
| ------------------- | ---------------------------------------------------------------------------------- |
| `npm run dev`       | Levanta el servidor con recarga (`tsx watch`)                                      |
| `npm run build`     | Compila TypeScript a `dist/`                                                       |
| `npm run start`     | Corre la build compilada                                                           |
| `npm run typecheck` | `tsc --noEmit`                                                                     |
| `npm run lint`      | ESLint (incluye la regla de dependencia hexagonal)                                 |
| `npm run format`    | Prettier `--write`                                                                 |
| `npm test`          | Vitest (unitarios + guardrails; los de infraestructura se saltan sin credenciales) |
| `npm run ingest`    | Pipeline offline de ingestión del corpus                                           |

## Pasos manuales pendientes

Estos pasos no los puede hacer un agente de código porque requieren cuentas, aprobaciones o decisiones humanas:

1. **Crear el bot de Telegram** en BotFather y obtener `TELEGRAM_BOT_TOKEN`.
2. **Crear el proyecto de Supabase**, obtener `SUPABASE_URL`/`SUPABASE_SERVICE_KEY`, habilitar la extensión `vector` (la migración ya incluye `create extension if not exists vector`, pero el plan de Supabase debe soportarla) y aplicar la migración `0001_knowledge_chunk.sql`.
3. **Obtener la API key de OpenRouter** (`LLM_API_KEY`) y elegir el modelo (`LLM_MODEL`, por defecto `anthropic/claude-sonnet-4.5`).
4. **Obtener la API key de OpenAI** (`OPENAI_API_KEY`) para Whisper (STT), TTS y embeddings.
5. **Crear la app de Meta para WhatsApp Business Cloud API**, pasar la revisión/aprobación de Meta y obtener `WHATSAPP_TOKEN`/`WHATSAPP_PHONE_NUMBER_ID` (Fase 2 — piloto con productores reales).
6. **Validación del corpus por un zootecnista.** Los documentos en `knowledge/` están marcados `validado por: PENDIENTE zootecnista`; deben ser revisados y aprobados por un profesional antes de usarse con productores reales.
7. **Desplegar el servidor** en un host accesible por HTTPS (los webhooks de Telegram/Meta requieren HTTPS público) y configurar ahí las variables de entorno de producción.
