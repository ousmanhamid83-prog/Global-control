-- VIGILAIR sentinelle : une clé VA- = un poste. Copie logiciel / dossier = alerte + coupure + dossier hashé.

create table if not exists device_bindings (
  id          text primary key,
  user_id     text not null,
  key_id      text,
  fp_hash     text not null,
  label       text not null,
  first_seen  timestamptz not null default now(),
  last_seen   timestamptz not null default now()
);
create unique index if not exists device_bindings_user_id_uidx on device_bindings (user_id);
create index if not exists device_bindings_fp_idx on device_bindings (fp_hash);
alter table security_incidents add column if not exists machine_label text;
alter table security_incidents add column if not exists fp_hash text;
alter table security_incidents add column if not exists content_sha256 text;
alter table security_incidents add column if not exists prev_sha256 text;
alter table security_incidents add column if not exists chain_sha256 text;
alter table security_incidents add column if not exists pdf_sha256 text;
alter table security_incidents add column if not exists pdf_b64 text;
alter table security_incidents add column if not exists auto_ejected boolean not null default false;
alter table security_incidents add column if not exists drill boolean not null default false;
