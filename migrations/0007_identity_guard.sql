-- Identité opérationnelle (e-mail, grade, unité) + garde anti-intrusion.
-- VIGILAIR ne riposte pas en réseau : il coupe, consigne, alerte.

alter table staff add column if not exists email text;
alter table staff add column if not exists grade text not null default '';
alter table staff add column if not exists phone text not null default '';
alter table staff add column if not exists unit text not null default '';

create unique index if not exists staff_email_uq
  on staff (email);

create table if not exists auth_guard (
  id             text primary key,
  kind           text not null,
  identity_hash  text not null,
  identity_shown text not null default '',
  fp_hash        text,
  ok             boolean not null default false,
  detail         text not null default '',
  created_at     timestamptz not null default now()
);
create index if not exists auth_guard_created_at_idx on auth_guard (created_at desc);
create index if not exists auth_guard_hash_idx on auth_guard (identity_hash, created_at desc);

create table if not exists cop_lock (
  id       text primary key,
  locked   boolean not null default false,
  reason   text not null default '',
  by_label text,
  at       timestamptz not null default now()
);

insert into cop_lock (id, locked, reason)
values ('global', false, '')
on conflict (id) do nothing;
