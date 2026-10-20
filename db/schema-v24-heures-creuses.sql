-- Mirrio - migration v24 : « Heures creuses », un prix réduit sur les créneaux que le salon veut remplir. Idempotent.
--
-- Le salon choisit une remise (5 à 50 %) applicable à des jours et une plage horaire. Le client la voit sur chaque créneau
-- concerné AVANT de réserver ; le serveur calcule le prix (jamais le navigateur), l'acompte est calculé sur le prix remisé,
-- et la remise appliquée est conservée sur le rendez-vous (`remise_pct`) pour la facture et les emails.

alter table public.parametres_reservation
  add column if not exists creux_actif boolean not null default false,
  add column if not exists creux_pourcentage int not null default 15,
  add column if not exists creux_jours int[] not null default array[2,3,4],
  add column if not exists creux_heure_debut time not null default '09:00',
  add column if not exists creux_heure_fin time not null default '12:00';

alter table public.parametres_reservation drop constraint if exists parametres_reservation_creux_check;
alter table public.parametres_reservation add constraint parametres_reservation_creux_check
  check (creux_pourcentage between 5 and 50 and creux_heure_fin > creux_heure_debut);

alter table public.rendez_vous
  add column if not exists remise_pct numeric not null default 0;
alter table public.rendez_vous drop constraint if exists rendez_vous_remise_check;
alter table public.rendez_vous add constraint rendez_vous_remise_check check (remise_pct >= 0 and remise_pct <= 50);
