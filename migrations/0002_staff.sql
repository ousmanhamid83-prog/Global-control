-- VIGILAIR division: chef de division, clés d'accès, bots d'alerte.
-- user_id TEXT — Better Auth ids are text (preview 'dev-user').

create table if not exists staff (
  user_id    text primary key,
  role       text not null check (role in ('superadmin', 'admin')),
  label      text not null,
  created_at timestamptz not null default now()
);
create index if not exists staff_role_idx on staff (role);

create table if not exists access_keys (
  id         text primary key,
  key_hash   text not null unique,
  email      text not null unique,
  label      text not null,
  created_by text not null,
  created_at timestamptz not null default now(),
  used_at    timestamptz,
  revoked    boolean not null default false
);
create index if not exists access_keys_created_by_idx on access_keys (created_by);

create table if not exists bot_settings (
  user_id          text primary key,
  telegram_token   text,
  telegram_chat_id text,
  signal_webhook   text,
  updated_at       timestamptz not null default now()
);

create table if not exists alert_dispatch (
  alert_id  text primary key,
  sent_at   timestamptz not null default now(),
  channels  text not null,
  user_id   text not null
);
