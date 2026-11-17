-- Exercice réel : une intrusion dans une bulle par la piste d'exercice d'un de nos drones (vrai vol,
-- joué comme intrus) est versée au journal des bulles, marquée exercice. Elle n'ouvre ni incident de
-- sûreté ni alerte du chef par Signal.

alter table zone_breach add column if not exists exercice boolean not null default false;
