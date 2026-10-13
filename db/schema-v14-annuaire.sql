-- Cadence — migration v14 : annuaire public (façon Planity).
-- À exécuter une fois dans Supabase : SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Ajoute à `parametres_reservation` deux colonnes :
--   * `visible_annuaire`    — le praticien accepte d'apparaître dans l'annuaire
--                             public (explorer.html). Faux par défaut : rien
--                             n'est jamais listé sans choix explicite.
--   * `description_annuaire` — texte court affiché sur sa fiche.
--
-- Une fiche n'apparaît que si `activee` ET `visible_annuaire` ET `slug` sont
-- réunis (vérifié dans api/annuaire.js, pas par RLS : lecture via service_role).
--
-- Aucune commission n'est prélevée par cette migration : le modèle retenu
-- reste l'abonnement fixe (voir CLAUDE.md §3.15).

alter table public.parametres_reservation
  add column if not exists visible_annuaire boolean not null default false,
  add column if not exists description_annuaire text;

alter table public.parametres_reservation drop constraint if exists parametres_reservation_desc_annuaire_check;
alter table public.parametres_reservation add constraint parametres_reservation_desc_annuaire_check
  check (description_annuaire is null or char_length(description_annuaire) <= 300);
