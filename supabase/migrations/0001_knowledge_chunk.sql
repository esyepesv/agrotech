-- Etapa 7 — Base de conocimiento (sección 12 de arquitectura.md).
-- Corpus curado vectorizado (knowledge_chunk) + registro de conversaciones
-- (conversation_turn, sección 9/15) + función RPC de recuperación por
-- similitud coseno usada por PgVectorRetriever.

create extension if not exists vector;
create extension if not exists pgcrypto; -- gen_random_uuid()

-- ── Corpus curado ────────────────────────────────────────────────────────
create table if not exists knowledge_chunk (
  id           uuid primary key default gen_random_uuid(),
  content      text not null,
  embedding    vector(1536),
  source       text not null,
  topic        text,
  validated_by text,
  region       text default 'CO',
  updated_at   timestamptz default now()
);

-- Búsqueda vectorial EXACTA para el corpus del MVP (pocos cientos de chunks):
-- un seq scan sobre `<=>` siempre devuelve el top-k correcto. NO se usa un
-- índice ivfflat: al ser aproximado y particionar en "listas", con un corpus
-- pequeño la mayoría de consultas caen en listas vacías y no recuperan nada.
-- Cuando el corpus crezca a miles de chunks, crear un índice HNSW (alto recall,
-- sin entrenamiento):
--   create index knowledge_chunk_embedding_idx
--     on knowledge_chunk using hnsw (embedding vector_cosine_ops);

create index if not exists knowledge_chunk_source_idx on knowledge_chunk (source);

-- ── Registro de conversaciones (métricas, sección 15) ───────────────────
-- user_hash: SHA-256 de channelUserId. Nunca se guarda el identificador del
-- usuario en claro (privacidad, sección 9).
create table if not exists conversation_turn (
  id            uuid primary key default gen_random_uuid(),
  channel       text not null,
  user_hash     text not null,
  question_text text not null,
  answer_text   text not null,
  action        text not null,
  latency_ms    integer not null,
  created_at    timestamptz not null default now()
);

create index if not exists conversation_turn_created_at_idx
  on conversation_turn (created_at desc);

-- ── Recuperación por similitud coseno ────────────────────────────────────
-- pgvector's `<=>` es distancia coseno; similarity = 1 - distancia.
create or replace function match_knowledge_chunks(
  query_embedding vector(1536),
  match_count int default 5
)
returns table (
  id           uuid,
  content      text,
  source       text,
  topic        text,
  validated_by text,
  region       text,
  updated_at   timestamptz,
  similarity   float
)
language sql stable
as $$
  select
    knowledge_chunk.id,
    knowledge_chunk.content,
    knowledge_chunk.source,
    knowledge_chunk.topic,
    knowledge_chunk.validated_by,
    knowledge_chunk.region,
    knowledge_chunk.updated_at,
    1 - (knowledge_chunk.embedding <=> query_embedding) as similarity
  from knowledge_chunk
  where knowledge_chunk.embedding is not null
  order by knowledge_chunk.embedding <=> query_embedding
  limit match_count;
$$;
