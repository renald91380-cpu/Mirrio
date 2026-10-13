-- Cadence — migration v17 : vertical beauté (coiffure, barbier, esthétique, onglerie, massage).
-- À exécuter une fois dans Supabase (SQL Editor). Idempotent.
--
--   1. `profiles_metier_check` : autorise enfin coiffure, esthetique, onglerie
--      (proposés dans l'interface depuis plusieurs versions mais refusés par la
--      base — l'enregistrement du métier échouait) et ajoute barbier, massage.
--   2. `prestations.public_cible` : Femme / Homme / Mixte (filtre de l'annuaire
--      et onglets de la page de réservation).
--   3. `prestations.categorie` : regroupement libre (Coupe, Couleur, Soin visage…).

alter table public.profiles drop constraint if exists profiles_metier_check;
alter table public.profiles add constraint profiles_metier_check
  check (metier in ('photographe','coach','formateur','professeur','consultant','therapeute',
                    'esthetique','coiffure','barbier','onglerie','massage','autre'));

alter table public.prestations
  add column if not exists public_cible text not null default 'mixte',
  add column if not exists categorie text;

alter table public.prestations drop constraint if exists prestations_public_cible_check;
alter table public.prestations add constraint prestations_public_cible_check
  check (public_cible in ('mixte','femme','homme'));

alter table public.prestations drop constraint if exists prestations_categorie_check;
alter table public.prestations add constraint prestations_categorie_check
  check (categorie is null or char_length(categorie) <= 40);
