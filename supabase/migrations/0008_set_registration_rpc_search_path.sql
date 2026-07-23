-- Las RPC de registro se recrearon en 0007; fijar el search_path evita que
-- dependan del contexto de la sesión que las invoque.
alter function public.register_owner_with_farm(jsonb)
  set search_path = public;

alter function public.register_worker_membership(jsonb)
  set search_path = public;
