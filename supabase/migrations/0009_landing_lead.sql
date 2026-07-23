-- Contactos captados desde porcia-web. Pendiente de aplicar manualmente en Supabase.
create table if not exists landing_lead (
  id uuid primary key default gen_random_uuid(),
  lead_type text not null check (lead_type in ('pilot', 'partner')),
  name text not null,
  whatsapp text,
  email text,
  organization text,
  farm_details text,
  interested_in_management boolean not null default false,
  message text,
  consented_at timestamptz not null,
  source text not null default 'porcia-web',
  idempotency_key text not null unique,
  created_at timestamptz not null default now(),
  check ((lead_type = 'pilot' and whatsapp is not null) or (lead_type = 'partner' and email is not null and organization is not null))
);

create index if not exists landing_lead_created_at_idx on landing_lead (created_at desc);

-- Los contactos contienen PII y solo los manipula el backend con service_role.
alter table public.landing_lead enable row level security;
revoke all on table public.landing_lead from anon, authenticated;
grant select, insert, update, delete on table public.landing_lead to service_role;
