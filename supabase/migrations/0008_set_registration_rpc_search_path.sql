-- APLICADA EN PRODUCCIÓN junto con 0007 (las RPC responden). El search_path
-- no es observable desde la API REST; si algún día hay dudas, se revisa con
-- `\df+` sobre la base.
--
-- Las RPC de registro se recrearon en 0007; fijar el search_path evita que
-- dependan del contexto de la sesión que las invoque.
alter function public.register_owner_with_farm(jsonb)
  set search_path = public;

alter function public.register_worker_membership(jsonb)
  set search_path = public;
