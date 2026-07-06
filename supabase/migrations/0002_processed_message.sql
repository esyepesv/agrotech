-- Hardening — Idempotencia real de webhooks en serverless (dedup L2).
--
-- SeenMessages (src/interfaces/http/dedup.ts) es solo un fast-path L1 en
-- memoria por proceso: en Vercel cada invocación puede caer en una lambda
-- distinta, así que no sirve como autoridad de deduplicación entre
-- instancias. Esta tabla es esa autoridad compartida: antes de invocar el
-- caso de uso, SupabaseMessageDeduplicator intenta insertar el messageId
-- aquí; una violación de PK (23505) indica que ya se procesó.
--
-- PENDIENTE DE APLICAR: este archivo NO se aplica automáticamente. Aplicar
-- manualmente con `supabase db push` o pegando el contenido en el SQL
-- Editor del panel de Supabase.

create table if not exists processed_message (
  message_id  text primary key,
  received_at timestamptz not null default now()
);
