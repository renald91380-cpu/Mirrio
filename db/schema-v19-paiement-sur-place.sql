-- Mirrio — migration v19 : choix CB ou espèces à la réservation, avec acompte.
-- À exécuter une fois dans Supabase (SQL Editor). Idempotent.
--
-- Principe : à la réservation en ligne, le client choisit
--   * « CB »      : il règle le prix total tout de suite par carte (comportement existant) ;
--   * « Espèces » : il règle seulement un ACOMPTE par carte (garantie anti no-show),
--                   et le SOLDE se règle en espèces au salon.
--
--   1. `parametres_paiement` : acompte minimum (5 € par défaut), pourcentage
--      optionnel, interrupteur « espèces sur place ». Ajoutés aussi à la vue
--      publique (aucune colonne secrète).
--   2. `rendez_vous` : mode de paiement choisi, total TTC, solde dû sur place,
--      date d'encaissement du solde, et lien vers la facture générée.

alter table public.parametres_paiement
  add column if not exists especes_actif boolean not null default true,
  add column if not exists acompte_minimum numeric not null default 5,
  add column if not exists acompte_pourcentage numeric not null default 0;

alter table public.parametres_paiement drop constraint if exists parametres_paiement_acompte_check;
alter table public.parametres_paiement add constraint parametres_paiement_acompte_check
  check (acompte_minimum >= 0 and acompte_minimum <= 500 and acompte_pourcentage >= 0 and acompte_pourcentage <= 100);

-- La vue doit être recréée pour exposer les nouvelles colonnes (aucune clé secrète).
drop view if exists public.parametres_paiement_public;
create view public.parametres_paiement_public
  with (security_invoker = true) as
  select owner_id, stripe_actif, stripe_publishable_key, paypal_actif, paypal_client_id,
         paypal_sandbox, especes_actif, acompte_minimum, acompte_pourcentage
  from public.parametres_paiement;
grant select on public.parametres_paiement_public to authenticated;

alter table public.rendez_vous
  add column if not exists paiement_mode text,
  add column if not exists total_ttc numeric,
  add column if not exists reste_sur_place numeric not null default 0,
  add column if not exists reste_encaisse_le timestamptz,
  add column if not exists document_id uuid references public.documents on delete set null;

alter table public.rendez_vous drop constraint if exists rendez_vous_paiement_mode_check;
alter table public.rendez_vous add constraint rendez_vous_paiement_mode_check
  check (paiement_mode is null or paiement_mode in ('en_ligne','sur_place'));
