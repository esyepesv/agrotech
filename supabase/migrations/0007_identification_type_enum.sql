-- APLICADA EN PRODUCCIÓN (verificado el 2026-07-23 contra el esquema que
-- expone PostgREST: el enum public.identification_type existe con sus 6
-- valores). Faltaba la cabecera, no la migración.
--
-- Tipos de documento admitidos por PorcIA. Es un conjunto pequeño y estable,
-- por eso se modela como enum de PostgreSQL en vez de texto con un CHECK.
-- Código de pasaporte: PA (se conserva por compatibilidad con el contrato v1.2).
create type public.identification_type as enum (
  'TI',  -- Tarjeta de Identidad
  'CC',  -- Cédula de Ciudadanía
  'CE',  -- Cédula de Extranjería
  'PPT', -- Permiso por Protección Temporal
  'PEP', -- Permiso Especial de Permanencia
  'PA'   -- Pasaporte
);

alter table public.app_user
  drop constraint if exists app_user_identification_type_check;

alter table public.app_user
  alter column identification_type type public.identification_type
  using identification_type::public.identification_type;

-- JSONB ->> devuelve text. El cast explícito permite que las RPC atómicas
-- continúen insertando en la nueva columna enum.
create or replace function public.register_owner_with_farm(payload jsonb)
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
      (payload->'user'->>'identification_type')::public.identification_type,
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

create or replace function public.register_worker_membership(payload jsonb)
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
      (payload->'user'->>'identification_type')::public.identification_type,
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
