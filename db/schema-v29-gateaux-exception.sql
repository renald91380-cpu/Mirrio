-- Mirrio — schema v29 : date « exception » des commandes de gâteaux (+30 %)
-- Idempotent. Dépend de schema-v27 et v28.
--
-- Au-delà de la marge de surcharge (v28), un client qui tient vraiment à une date très chargée peut
-- la demander moyennant une majoration plus forte (30 % par défaut), réglée en intégralité par carte.
--   exception_points      : points acceptés au-delà de capacité + marge de surcharge (0 = jamais)
--   exception_pourcentage : majoration appliquée
alter table public.parametres_gateaux
  add column if not exists exception_points int not null default 3 check (exception_points between 0 and 10),
  add column if not exists exception_pourcentage int not null default 30 check (exception_pourcentage between 0 and 100);
