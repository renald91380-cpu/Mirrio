-- Mirrio — schema v34 : tarifs enfant et étudiant (au choix du salon)
-- Idempotent. Dépend de schema-v6 (parametres_reservation) et v24 (remise_pct).
-- Chaque tarif est facultatif, désactivé par défaut, et se règle en pourcentage de réduction sur le prix adulte.
--   tarif_enfant_*   : réduction + âge maximum (« moins de X ans »)
--   tarif_etudiant_* : réduction (justificatif à présenter au salon)
--   rendez_vous.tarif : tarif choisi par le client ('enfant' | 'etudiant'), pour que le salon le voie dans l'agenda
-- La réduction appliquée vit dans rendez_vous.remise_pct (plafond relevé de 50 à 90).
alter table public.parametres_reservation
  add column if not exists tarif_enfant_actif boolean not null default false,
  add column if not exists tarif_enfant_pourcentage int not null default 20 check (tarif_enfant_pourcentage between 1 and 90),
  add column if not exists tarif_enfant_age_max int not null default 12 check (tarif_enfant_age_max between 3 and 17),
  add column if not exists tarif_etudiant_actif boolean not null default false,
  add column if not exists tarif_etudiant_pourcentage int not null default 10 check (tarif_etudiant_pourcentage between 1 and 90);
alter table public.rendez_vous add column if not exists tarif text check (tarif is null or tarif in ('enfant','etudiant'));
alter table public.rendez_vous drop constraint if exists rendez_vous_remise_check;
alter table public.rendez_vous add constraint rendez_vous_remise_check check (remise_pct >= 0 and remise_pct <= 90);
