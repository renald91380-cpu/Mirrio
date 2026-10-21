-- Mirrio — schema v28 : surcharge et paiement d'avance des commandes de gâteaux
-- À exécuter une fois dans Supabase (SQL Editor). Idempotent. Dépend de schema-v27.
--
-- Une journée déjà chargée peut accepter une commande de plus « en surcharge » : majoration
-- (15 % par défaut) et règlement intégral par carte à la commande, sans acompte.
--   parametres_gateaux.surcharge_points      : points de charge acceptés AU-DELÀ de la capacité normale (0 = jamais)
--   parametres_gateaux.surcharge_pourcentage : majoration appliquée au prix
--   gateaux_commandes.surcharge / surcharge_pourcentage : trace de la majoration
--   gateaux_commandes.paiement_*             : suivi du paiement Stripe (statut `a_payer` jusqu'au webhook)

alter table public.parametres_gateaux
  add column if not exists surcharge_points int not null default 2 check (surcharge_points between 0 and 10),
  add column if not exists surcharge_pourcentage int not null default 15 check (surcharge_pourcentage between 0 and 100);

alter table public.gateaux_commandes
  add column if not exists surcharge boolean not null default false,
  add column if not exists surcharge_pourcentage int,
  add column if not exists paiement_statut text check (paiement_statut is null or paiement_statut in ('en_attente','paye','echoue')),
  add column if not exists paiement_reference text,
  add column if not exists paye_le timestamptz,
  add column if not exists paye_montant numeric(9,2);

alter table public.gateaux_commandes drop constraint if exists gateaux_commandes_statut_check;
alter table public.gateaux_commandes add constraint gateaux_commandes_statut_check
  check (statut in ('a_payer','nouvelle','confirmee','prete','retiree','annulee'));
