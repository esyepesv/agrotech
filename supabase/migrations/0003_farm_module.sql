-- Módulo de gestión de granja (PorcIA v1.1, Corte 1) — PLAN-v1.1.md §5,
-- arquitectura-v1.1.md §10. Todas las tablas del módulo se crean de una sola
-- vez, aunque `sow`/`lot`/`sanitary_plan` recién se consuman en los Cortes
-- 2-4: así se evitan migraciones posteriores con cadenas de FKs partidas
-- (p. ej. `inventory_movement.related_lot_id → lot`). Conviven con
-- `knowledge_chunk`/`conversation_turn`/`processed_message` de v1 sin tocarlas.
--
-- PENDIENTE DE APLICAR: este archivo NO se aplica automáticamente. Aplicar
-- manualmente con `supabase db push` o pegando el contenido en el SQL Editor
-- del panel de Supabase (igual que 0001/0002). Requiere `pgcrypto` (ya creada
-- por 0001_knowledge_chunk.sql) para `gen_random_uuid()`.

-- ── Identidad de granja y operario ──────────────────────────────────────
create table if not exists farm (
  id                   uuid primary key default gen_random_uuid(),
  name                 text not null,
  owner_name           text,
  meta_partos_por_ano  numeric default 2.5,
  region               text default 'CO',
  created_at           timestamptz default now()
);

-- channel_user_hash: HMAC-SHA256(channelUserId, USER_ID_SALT) — mismo
-- hasheo con sal secreta que v1 (D2 de PLAN-v1.1.md); nunca el id crudo.
create table if not exists operator (
  id               uuid primary key default gen_random_uuid(),
  farm_id          uuid not null references farm(id),
  channel_user_hash text not null unique,
  display_name     text,
  role             text not null default 'operario'
);

create table if not exists pen (
  id       uuid primary key default gen_random_uuid(),
  farm_id  uuid not null references farm(id),
  kind     text not null check (kind in ('gestacion', 'paridera', 'precebo', 'ceba')),
  capacity int not null
);

-- Cría individual (chapeta = identificador físico de campo, no el id técnico).
create table if not exists sow (
  id                uuid primary key default gen_random_uuid(),
  farm_id           uuid not null references farm(id),
  chapeta           text not null,
  entry_date        date,
  initial_weight_kg numeric,
  initial_cost      numeric,
  genetic_line      text,
  num_pezones       int,
  aplomos           text,
  status            text not null default 'reemplazo',
  current_pen_id    uuid references pen(id),
  unique (farm_id, chapeta)
);

-- Grupo de animales (precebo/ceba), a diferencia de la cría individual (sow).
create table if not exists lot (
  id                    uuid primary key default gen_random_uuid(),
  farm_id               uuid not null references farm(id),
  stage                 text not null check (stage in ('precebo', 'ceba')),
  start_date            date,
  animal_count          int,
  pen_id                uuid references pen(id),
  avg_initial_weight_kg numeric,
  avg_final_weight_kg   numeric,
  status                text not null default 'activo'
);

-- ── Inventario: proyección de saldo (reconstruible desde el ledger, R3) ──
create table if not exists inventory_item (
  id             uuid primary key default gen_random_uuid(),
  farm_id        uuid not null references farm(id),
  kind           text not null check (kind in ('concentrado', 'vacuna', 'insumo')),
  name           text not null,
  brand          text,
  unit           text not null,
  current_qty    numeric not null default 0,
  avg_unit_cost  numeric,
  unique (farm_id, name)
);

-- source: SOLO 'voice'|'text'. La entrada por imagen (OCR) quedó diferida
-- fuera de v1.1 (D6 de PLAN-v1.1.md); se agrega el valor al check cuando se
-- implemente, en migración aditiva.
create table if not exists inventory_movement (
  id             uuid primary key default gen_random_uuid(),
  item_id        uuid not null references inventory_item(id),
  direction      text not null check (direction in ('in', 'out')),
  qty            numeric not null,
  unit_cost      numeric,
  reason         text,
  related_lot_id uuid references lot(id),
  related_sow_id uuid references sow(id),
  occurred_at    timestamptz not null default now(),
  source         text not null check (source in ('voice', 'text')),
  confidence     numeric,
  confirmed_at   timestamptz
);

create index if not exists inventory_movement_item_occurred_idx
  on inventory_movement (item_id, occurred_at);

-- ── Ledger: fuente de verdad, append-only ───────────────────────────────
-- Mismo comentario sobre `source` que inventory_movement (sin 'image').
create table if not exists farm_event (
  id                 uuid primary key default gen_random_uuid(),
  farm_id            uuid not null references farm(id),
  actor_operator_id  uuid references operator(id),
  type               text not null,
  payload            jsonb not null,
  occurred_at        timestamptz not null,
  source             text not null check (source in ('voice', 'text')),
  raw_transcript     text,
  confidence         numeric,
  confirmed_at       timestamptz not null default now()
);

create index if not exists farm_event_farm_occurred_idx
  on farm_event (farm_id, occurred_at);

-- ── Planes sanitarios (estándar validado; override por granja después) ──
create table if not exists sanitary_plan (
  id            uuid primary key default gen_random_uuid(),
  scope         text not null, -- 'standard' o el farm_id como texto (PlanScope)
  stage         text not null,
  validated_by  text,          -- null = no validado; isValidatedPlan() lo exige antes de recordar (§8/§12)
  tasks         jsonb not null
);

-- ── Estado conversacional corto (TTL), PendingEventStore (PLAN-v1.1.md §7) ──
-- La clave NO es un uuid de operator: es el HASH del canal-usuario (mismo
-- channel_user_hash que `operator`), como texto. Esto es deliberado: el
-- pending de un usuario que TODAVÍA no es operario (p. ej. está a mitad del
-- alta de su granja, PendingDraft.kind='register_entity'/'farm') también
-- necesita vivir aquí, y ese usuario aún no tiene fila en `operator` ni id.
-- No es fuente de verdad: filas vencidas se borran de forma perezosa.
create table if not exists pending_event (
  operator_hash text primary key,
  draft         jsonb not null,
  expires_at    timestamptz not null
);

create index if not exists pending_event_expires_at_idx
  on pending_event (expires_at);
