-- VIGILAIR commandement : rôles, équipes, journal d'activité, incidents, éjection.
-- Le chef de division voit tout. Les agents ne modifient / n'effacent rien.

alter table staff add column if not exists team text not null default 'cop';
alter table staff add column if not exists ejected boolean not null default false;
alter table staff add column if not exists ejected_at timestamptz;
alter table staff add column if not exists ejected_reason text;
alter table staff add column if not exists last_seen timestamptz;
alter table staff add column if not exists updated_at timestamptz not null default now();

alter table staff drop constraint if exists staff_role_check;

alter table access_keys add column if not exists user_id text;
alter table access_keys add column if not exists role text not null default 'admin';
alter table access_keys add column if not exists team text not null default 'cop';
alter table access_keys add column if not exists ejected boolean not null default false;

create table if not exists ops_log (
  id         text primary key,
  user_id    text not null,
  actor      text not null,
  role       text not null,
  team       text not null,
  kind       text not null,
  title      text not null,
  detail     text not null,
  track_id   text,
  severity   text not null default 'info',
  created_at timestamptz not null default now()
);
create index if not exists ops_log_created_at_idx on ops_log (created_at desc);
create index if not exists ops_log_user_id_idx on ops_log (user_id);
create index if not exists ops_log_kind_idx on ops_log (kind);

create table if not exists security_incidents (
  id         text primary key,
  user_id    text,
  actor      text not null,
  kind       text not null,
  title      text not null,
  detail     text not null,
  work_recap text not null,
  acked      boolean not null default false,
  created_at timestamptz not null default now()
);
create index if not exists security_incidents_created_at_idx on security_incidents (created_at desc);
create index if not exists security_incidents_acked_idx on security_incidents (acked);
