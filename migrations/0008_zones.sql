-- Bulles de protection C-UAS N'Djamena. VIGILAIR n'émet pas : il détecte, consigne, alerte.

create table if not exists protected_zone (
  id         text primary key,
  name       text not null,
  kind       text not null,
  lat        double precision not null,
  lon        double precision not null,
  radius_km  double precision not null,
  armed      boolean not null default true,
  note       text not null default '',
  created_by text,
  updated_at timestamptz not null default now()
);

create table if not exists zone_breach (
  id         text primary key,
  zone_id    text not null,
  zone_name  text not null,
  track_id   text not null,
  callsign   text not null,
  dist_km    double precision not null,
  kind       text not null,
  uas        boolean not null default true,
  actor      text not null default '',
  created_at timestamptz not null default now()
);
create index if not exists zone_breach_created_at_idx on zone_breach (created_at desc);
create index if not exists zone_breach_zone_idx on zone_breach (zone_id, track_id, created_at desc);

insert into protected_zone (id, name, kind, lat, lon, radius_km, armed, note)
values
  ('fttj', 'FTTJ', 'aerodrome', 12.1336, 15.034, 3.2, true, 'CTR Hassan Djamous'),
  ('palais', 'Palais', 'palais', 12.113, 15.074, 1.6, true, 'Palais de la République'),
  ('kassei', 'Camp Kassai', 'camp', 12.118, 15.038, 1.4, true, 'Camp militaire Kassai'),
  ('nation', 'Place de la Nation', 'ministere', 12.134, 15.049, 0.9, true, 'Place de la Nation'),
  ('chagoua', 'Pont Chagoua', 'pont', 12.102, 15.088, 0.8, true, 'Axe Chagoua')
on conflict (id) do nothing;
