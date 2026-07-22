-- Registro de usuario + granja (PorcIA v1.2, spec 001) — arquitectura-v1.2.md
-- §5/§6, specs/001-register-farm-and-user.md. Separa identidad de persona
-- (app_user, nueva) de membresía de granja (operator, reestructurada de
-- "identidad de canal" a "usuario × granja × rol"). Aditiva sobre
-- 0003_farm_module.sql: no se borra ni renombra ninguna tabla existente.
--
-- APLICADA EN PRODUCCIÓN el 2026-07-22. Este archivo NO se aplica solo:
-- cualquier cambio posterior hay que aplicarlo a mano en el SQL Editor del
-- panel de Supabase (igual que 0001/0002/0003). Requiere `pgcrypto` (ya
-- creada por 0001_knowledge_chunk.sql) para `gen_random_uuid()`.

-- ── Persona (app_user) ───────────────────────────────────────────────────
-- Única por (identification_type, identification_number): una persona, una
-- cuenta. channel_user_hash es NULLABLE Y ÚNICO (Postgres permite múltiples
-- NULL en una columna unique): queda nulo si la persona se registró
-- verificando solo el correo (spec 001 §4.3) y se completa después, la
-- primera vez que escribe por WhatsApp/Telegram con el celular verificado
-- (RegisterFarmAndUser.resolveExistingUser → attachVerifiedPhone).
create table if not exists app_user (
  id                     uuid primary key default gen_random_uuid(),
  identification_type    text not null check (identification_type in ('CC', 'CE', 'PA')),
  identification_number  text not null,
  channel_user_hash      text unique,
  phone_verified_at      timestamptz,
  email_verified_at      timestamptz,
  email                  text,
  display_name           text,
  created_at             timestamptz not null default now(),
  unique (identification_type, identification_number)
);

create index if not exists app_user_channel_user_hash_idx
  on app_user (channel_user_hash);

-- ── Finca: campos de spec 001, aditivos ─────────────────────────────────
-- Sin unique global en tax_id: multi-granja permite que la misma
-- cédula/NIT tenga varias fincas (arquitectura-v1.2.md §5). Lo que se
-- impide (a nivel de caso de uso, no de esquema) es que la MISMA persona
-- registre dos veces la misma finca (mismo tax_id + mismo nombre).
alter table farm add column if not exists legal_type text check (legal_type in ('natural', 'juridica'));
alter table farm add column if not exists tax_id_type text check (tax_id_type in ('cedula', 'nit'));
alter table farm add column if not exists tax_id text;
alter table farm add column if not exists location text;
alter table farm add column if not exists ceba_capacity int;
alter table farm add column if not exists breeding_capacity int;
alter table farm add column if not exists total_capacity int;
alter table farm add column if not exists sanitary_registry text;

-- ── Operator: de "identidad de canal" a membresía usuario × granja ──────
-- user_id referencia a app_user; único junto con farm_id (una membresía
-- por granja). channel_user_hash deja de ser la llave de identidad (ahora
-- vive en app_user) y de ser NOT NULL/unique global — eso impedía
-- multi-granja (el mismo hash ya no puede repetirse en operator, pero SÍ
-- necesita poder repetirse: una persona con 2 fincas tiene 2 filas de
-- operator para el mismo hash). Se conserva la COLUMNA (nullable, sin
-- unique) porque el flujo legado de v1.1 (RegisterFarm/ConfirmFarmEvent,
-- intacto por la regla de oro) sigue escribiendo directo ahí sin crear un
-- app_user — ver el comentario de operator.ts en el dominio TypeScript.
alter table operator add column if not exists user_id uuid references app_user(id);
alter table operator add column if not exists status text not null default 'activo' check (status in ('activo', 'pendiente'));
-- Expiración perezosa de membresías 'pendiente' a las 72h (spec 001 §5): no
-- hay job de limpieza, se filtra al leer (ApproveWorker.listPending), mismo
-- espíritu que pending_event.expires_at en 0003.
alter table operator add column if not exists pending_expires_at timestamptz;

alter table operator alter column channel_user_hash drop not null;
alter table operator drop constraint if exists operator_channel_user_hash_key;

create unique index if not exists operator_user_farm_unique_idx
  on operator (user_id, farm_id);

-- Migración de valores de rol (D-aprobada por Stiven: sin datos reales en
-- producción, riesgo bajo — CLAUDE.md "Estado operativo").
update operator set role = 'administrador_dueno' where role = 'admin';
update operator set role = 'trabajador' where role = 'operario';

alter table operator alter column role set default 'trabajador';

do $$
begin
  if not exists (
    select 1 from pg_constraint where conname = 'operator_role_check'
  ) then
    alter table operator
      add constraint operator_role_check check (role in ('administrador_dueno', 'trabajador'));
  end if;
end $$;

-- ── Invitación a trabajador (dueño pre-registra a su equipo) ────────────
-- El celular se guarda SOLO hasheado (phone_hash, mismo HMAC+USER_ID_SALT
-- que channel_user_hash) — misma regla de privacidad de v1 (CLAUDE.md
-- "Estado operativo"): nunca se guarda el teléfono en claro.
create table if not exists worker_invitation (
  id                     uuid primary key default gen_random_uuid(),
  farm_id                uuid not null references farm(id),
  display_name           text not null,
  identification_number  text not null,
  phone_hash             text not null,
  created_at             timestamptz not null default now(),
  expires_at             timestamptz,
  consumed_at            timestamptz
);

create index if not exists worker_invitation_phone_hash_idx
  on worker_invitation (phone_hash);

-- ── RPC: alta atómica de dueño (+ granja adicional) ─────────────────────
-- Supabase JS no da transacciones multi-tabla; una función plpgsql SÍ es
-- transaccional por defecto, así que AppUser + Farm + Operator (+
-- invitaciones) se crean todos o ninguno. Un solo payload jsonb (en vez de
-- parámetros posicionales) para poder versionar el contrato sin firmas
-- nuevas de función. Sirve dos casos: alta de dueño nuevo (existing_user_id
-- = null, user = {...}) y granja adicional para un dueño ya existente
-- (existing_user_id = uuid, user = null) — RegisterFarmAndUser.
create or replace function register_owner_with_farm(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  if payload->>'existing_user_id' is not null then
    v_user_id := (payload->>'existing_user_id')::uuid;
  else
    insert into app_user (
      id, identification_type, identification_number, channel_user_hash,
      phone_verified_at, email_verified_at, email, display_name, created_at
    )
    select
      (payload->'user'->>'id')::uuid,
      payload->'user'->>'identification_type',
      payload->'user'->>'identification_number',
      payload->'user'->>'channel_user_hash',
      (payload->'user'->>'phone_verified_at')::timestamptz,
      (payload->'user'->>'email_verified_at')::timestamptz,
      payload->'user'->>'email',
      payload->'user'->>'display_name',
      (payload->'user'->>'created_at')::timestamptz
    returning id into v_user_id;
  end if;

  insert into farm (
    id, name, owner_name, meta_partos_por_ano, region, created_at,
    legal_type, tax_id_type, tax_id, location,
    ceba_capacity, breeding_capacity, total_capacity, sanitary_registry
  )
  select
    (payload->'farm'->>'id')::uuid,
    payload->'farm'->>'name',
    payload->'farm'->>'owner_name',
    coalesce((payload->'farm'->>'meta_partos_por_ano')::numeric, 2.5),
    coalesce(payload->'farm'->>'region', 'CO'),
    (payload->'farm'->>'created_at')::timestamptz,
    payload->'farm'->>'legal_type',
    payload->'farm'->>'tax_id_type',
    payload->'farm'->>'tax_id',
    payload->'farm'->>'location',
    (payload->'farm'->>'ceba_capacity')::int,
    (payload->'farm'->>'breeding_capacity')::int,
    (payload->'farm'->>'total_capacity')::int,
    payload->'farm'->>'sanitary_registry';

  insert into operator (id, user_id, farm_id, role, status)
  values (
    (payload->'operator'->>'id')::uuid,
    v_user_id,
    (payload->'farm'->>'id')::uuid,
    payload->'operator'->>'role',
    payload->'operator'->>'status'
  );

  insert into worker_invitation (
    id, farm_id, display_name, identification_number, phone_hash, created_at, expires_at
  )
  select
    (inv->>'id')::uuid,
    (payload->'farm'->>'id')::uuid,
    inv->>'display_name',
    inv->>'identification_number',
    inv->>'phone_hash',
    (inv->>'created_at')::timestamptz,
    (inv->>'expires_at')::timestamptz
  from jsonb_array_elements(coalesce(payload->'invitations', '[]'::jsonb)) as inv;

  return jsonb_build_object('user_id', v_user_id);
end;
$$;

-- ── RPC: alta atómica de trabajador (solicitud o invitación) ────────────
-- Crea el app_user si no existe (o reutiliza existing_user_id) y el
-- operator (membresía) en una sola transacción. Si channel_user_hash
-- coincide con una invitación pendiente sin consumir, la marca consumida
-- en la MISMA transacción (RegisterFarmAndUser ya decidió el status
-- 'activo'/'pendiente' antes de llamar esta RPC, comparando por su cuenta;
-- aquí solo se cierra el ciclo de la invitación para que no se reuse).
create or replace function register_worker_membership(payload jsonb)
returns jsonb
language plpgsql
as $$
declare
  v_user_id uuid;
begin
  if payload->>'existing_user_id' is not null then
    v_user_id := (payload->>'existing_user_id')::uuid;
  else
    insert into app_user (
      id, identification_type, identification_number, channel_user_hash,
      phone_verified_at, email_verified_at, email, display_name, created_at
    )
    select
      (payload->'user'->>'id')::uuid,
      payload->'user'->>'identification_type',
      payload->'user'->>'identification_number',
      payload->'user'->>'channel_user_hash',
      (payload->'user'->>'phone_verified_at')::timestamptz,
      (payload->'user'->>'email_verified_at')::timestamptz,
      payload->'user'->>'email',
      payload->'user'->>'display_name',
      (payload->'user'->>'created_at')::timestamptz
    returning id into v_user_id;
  end if;

  insert into operator (id, user_id, farm_id, role, status, pending_expires_at)
  values (
    (payload->'operator'->>'id')::uuid,
    v_user_id,
    (payload->'operator'->>'farm_id')::uuid,
    payload->'operator'->>'role',
    payload->'operator'->>'status',
    (payload->'operator'->>'pending_expires_at')::timestamptz
  );

  if payload->>'channel_user_hash' is not null then
    update worker_invitation
    set consumed_at = now()
    where phone_hash = payload->>'channel_user_hash'
      and consumed_at is null;
  end if;

  return jsonb_build_object('user_id', v_user_id);
end;
$$;
