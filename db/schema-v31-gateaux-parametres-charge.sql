-- Mirrio — schema v31 : règles de charge réglables par la pâtisserie
-- Idempotent. Dépend de schema-v27 à v30.
-- Ce qui était écrit en dur devient un réglage (Commandes → Réglages) :
--   poids_standard / poids_gros / seuil_gros_parts / poids_mariage : points de charge d'une commande
--   surcharge_max_par_jour / exception_max_par_jour : nombre de commandes majorées acceptées par jour (0 = aucune)
alter table public.parametres_gateaux
  add column if not exists poids_standard int not null default 1 check (poids_standard between 1 and 10),
  add column if not exists poids_gros int not null default 2 check (poids_gros between 1 and 10),
  add column if not exists seuil_gros_parts int not null default 25 check (seuil_gros_parts between 1 and 500),
  add column if not exists poids_mariage int not null default 3 check (poids_mariage between 1 and 10),
  add column if not exists surcharge_max_par_jour int not null default 1 check (surcharge_max_par_jour between 0 and 5),
  add column if not exists exception_max_par_jour int not null default 1 check (exception_max_par_jour between 0 and 5);
