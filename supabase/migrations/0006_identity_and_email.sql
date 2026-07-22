-- PENDIENTE DE APLICAR. Aditiva sobre 0004: separa "de qué celular dijo ser
-- dueño" (phone_hash, siempre) de "qué identidad de chat quedó probada"
-- (channel_user_hash / telegram_user_hash). Sin esa separación, al quitar el
-- OTP del registro no quedaba ningún dato con el que reconocer a la persona
-- después, porque channel_user_hash solo se escribía si había verificación.

alter table app_user add column if not exists phone_hash text;
alter table app_user add column if not exists telegram_user_hash text;

create unique index if not exists app_user_telegram_user_hash_idx
  on app_user (telegram_user_hash) where telegram_user_hash is not null;

-- phone_hash NO es único: dos personas pueden afirmar el mismo celular
-- mientras ninguna lo pruebe. Lo único que da acceso es la columna probada.
create index if not exists app_user_phone_hash_idx on app_user (phone_hash);

-- Correo obligatorio y único: es identificador de login (tarea 6). No hay
-- usuarios reales en producción, el update solo cubre filas de prueba.
update app_user set email = concat('sin-correo+', id::text, '@porcia.local') where email is null;
alter table app_user alter column email set not null;
create unique index if not exists app_user_email_idx on app_user (lower(email));
