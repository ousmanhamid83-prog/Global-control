-- Bulletins de preuve : retrait des champs que seules les pistes simulées remplissaient (source de
-- commandement « gonio », arrêt prévu, effet RF, appui SAR, plots SRC / TEL / ARR). Sur une piste
-- réelle ils restaient vides. Un bulletin déjà versé ne perd rien : son contenu complet reste dans
-- payload_json (celui que hache content_sha256) et dans son PDF.

alter table bulletins drop column if exists c2_lat;
alter table bulletins drop column if exists c2_lon;
alter table bulletins drop column if exists c2_method;
alter table bulletins drop column if exists c2_tile;
alter table bulletins drop column if exists stop_lat;
alter table bulletins drop column if exists stop_lon;
alter table bulletins drop column if exists stop_at;
alter table bulletins drop column if exists stop_method;
alter table bulletins drop column if exists stop_tile;
alter table bulletins drop column if exists ew_note;
alter table bulletins drop column if exists sar_note;
alter table bulletins drop column if exists scene_note;
alter table bulletins drop column if exists sat_credit;
