-- VIGILAIR quart de veille : un quart ouvert à la fois, gel capteurs réel.
create table if not exists watch_shift (
  id            text primary key,
  opened_by     text not null,
  opened_label  text not null,
  opened_role   text not null,
  opened_team   text not null,
  opened_at     timestamptz not null default now(),
  closed_by     text,
  closed_label  text,
  closed_at     timestamptz,
  status        text not null default 'open',
  snap_in       text not null,
  snap_out      text,
  aar           text,
  note_in       text not null default '',
  note_out      text not null default ''
);
create index if not exists watch_shift_status_idx on watch_shift (status);
create index if not exists watch_shift_opened_at_idx on watch_shift (opened_at desc);
create index if not exists watch_shift_opened_by_idx on watch_shift (opened_by);
