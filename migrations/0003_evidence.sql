-- VIGILAIR bulletins de preuve — journal de division, PDF hashé, chaîne de custody.
-- user_id TEXT = auteur (Better Auth). Lecture : tout le personnel authentifié.

create table if not exists bulletins (
  id             text primary key,
  user_id        text not null,
  filed_by       text not null,
  role           text not null,
  track_id       text not null,
  callsign       text not null,
  platform_id    text not null,
  origin         text not null,
  confidence     integer not null,
  lat            double precision not null,
  lon            double precision not null,
  alt_m          double precision not null,
  heading        double precision not null,
  speed_kmh      double precision not null,
  sensors        text not null,
  method         text not null,
  launch_lat     double precision,
  launch_lon     double precision,
  launch_at      bigint,
  launch_method  text,
  launch_tile    text,
  c2_lat         double precision,
  c2_lon         double precision,
  c2_method      text,
  c2_tile        text,
  stop_lat       double precision,
  stop_lon       double precision,
  stop_at        bigint,
  stop_method    text,
  stop_tile      text,
  sat_credit     text not null,
  sar_note       text not null,
  scene_note     text not null,
  ew_note        text,
  corridor       text,
  injected       boolean not null default false,
  payload_json   text not null,
  content_sha256 text not null,
  prev_sha256    text,
  chain_sha256   text not null,
  pdf_sha256     text not null,
  pdf_b64        text not null,
  created_at     timestamptz not null default now()
);

create index if not exists bulletins_user_id_idx on bulletins (user_id);
create index if not exists bulletins_created_at_idx on bulletins (created_at desc);
create index if not exists bulletins_track_id_idx on bulletins (track_id);
