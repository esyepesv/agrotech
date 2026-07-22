-- Almacén de OTP (spec 001 §4.1.2/§4.2, arquitectura-v1.2.md §8) — código de
-- 6 dígitos para verificar la posesión de un destino (celular o correo)
-- antes de crear AppUser/Farm/Operator. Vive fuera de `farm`/`operator`
-- porque en el momento de pedir/verificar el código todavía no hay
-- identidad creada.
--
-- La llave es el DESTINO normalizado (E.164 o correo en minúsculas), no el
-- canal de entrega: un mismo celular verificado por WhatsApp, Telegram o
-- SMS es la misma prueba de posesión (`last_transport` solo registra el
-- último medio usado, informativo, no forma parte de la llave).
--
-- PENDIENTE DE APLICAR: este archivo NO se aplica automáticamente. Aplicar
-- manualmente con `supabase db push` o pegando el contenido en el SQL Editor
-- del panel de Supabase (igual que 0001/0002/0003).

create table if not exists otp_code (
  destination      text not null,
  destination_kind text not null check (destination_kind in ('phone', 'email')),
  last_transport    text not null check (last_transport in ('whatsapp', 'telegram', 'sms', 'email')),
  -- HMAC-SHA256 del código con un pepper secreto (otp-code.ts) — el código
  -- en claro NUNCA se persiste.
  code_hash        text not null,
  attempts         int not null default 0,
  max_attempts     int not null default 5,
  expires_at       timestamptz not null,
  verified_at      timestamptz,
  created_at       timestamptz not null default now(),
  primary key (destination)
);

-- Limpieza perezosa de códigos vencidos (mismo patrón que pending_event de
-- 0003): este índice es lo que hace barata la eliminación por expires_at.
create index if not exists otp_code_expires_at_idx on otp_code (expires_at);
