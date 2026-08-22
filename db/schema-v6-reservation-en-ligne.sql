-- Cadence — migration v6 : réservation en ligne (widget public).
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Ce que cette migration ajoute :
--   1. `parametres_reservation` — réglages de la page/du widget de réservation
--      (un par espace, même logique que `parametres_facturation`).
--   2. Colonnes prospect + prestation sur `rendez_vous`, pour un rendez-vous
--      « en attente » créé depuis le widget, qui n'a pas encore de fiche client.
--   3. Rattrapage de `handle_new_user()` + backfill pour les comptes existants.
--
-- Ce que cette migration N'AJOUTE PAS (choix assumé) : aucune contrainte
-- d'exclusion anti-chevauchement sur `rendez_vous`. Le projet n'a jamais
-- empêché deux rendez-vous de se chevaucher, et l'imposer rétroactivement
-- risquerait de casser sur des données existantes jamais auditées. La
-- protection anti-course reste applicative, dans api/reservation-publique.js
-- (re-vérification du créneau juste avant l'insert).
--
-- Modèle de confiance : le `slug` est un identifiant PUBLIC choisi par le
-- praticien (comme un nom d'utilisateur) — à la différence de
-- `calendar_feeds.token` ou `documents.partage_token` (jetons-capacité
-- opaques, générés par `new_feed_token()`), une page de réservation est faite
-- pour être diffusée largement, pas gardée secrète. Voir CLAUDE.md.

-- =====================================================================
-- 1. Réglages de réservation en ligne (une ligne par espace)
-- =====================================================================
-- Table séparée, même logique que `parametres_facturation` : ces réglages ne
-- sont lus que par l'écran Paramètres et par les deux routes publiques du
-- widget (api/reservation-disponibilites.js, api/reservation-publique.js),
-- jamais au chargement des écrans Clients ou Agenda.

create table if not exists public.parametres_reservation (
  owner_id uuid primary key references auth.users on delete cascade,

  activee boolean not null default false,

  -- Identifiant public. `null` tant que le praticien n'a rien choisi — jamais
  -- généré silencieusement par la migration ou par le trigger d'inscription.
  slug text unique,

  -- Jours ouverts, au format `Date.getDay()` JS (0=dimanche … 6=samedi) : pas
  -- de conversion d'index à faire entre SQL et le JS du widget.
  jours_ouvres int[] not null default array[1,2,3,4,5],

  heure_debut time not null default '09:00',
  heure_fin   time not null default '18:00',

  -- Granularité de la grille de créneaux proposés (indépendante de la durée
  -- de la prestation choisie, qui détermine elle la longueur d'un créneau).
  intervalle_minutes int not null default 30,

  -- Délai minimum avant un rendez-vous (anti réservation de dernière minute)
  -- et horizon maximum (fenêtre de réservation ouverte à l'avance).
  delai_min_heures int not null default 24,
  horizon_jours int not null default 30,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.parametres_reservation drop constraint if exists parametres_reservation_slug_check;
alter table public.parametres_reservation add constraint parametres_reservation_slug_check
  check (slug is null or slug ~ '^[a-z0-9-]{3,40}$');

alter table public.parametres_reservation drop constraint if exists parametres_reservation_heures_check;
alter table public.parametres_reservation add constraint parametres_reservation_heures_check
  check (heure_fin > heure_debut);

alter table public.parametres_reservation enable row level security;

drop policy if exists "Un utilisateur voit les réglages de réservation de son espace" on public.parametres_reservation;
create policy "Un utilisateur voit les réglages de réservation de son espace"
  on public.parametres_reservation for select using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur crée les réglages de réservation de son espace" on public.parametres_reservation;
create policy "Un utilisateur crée les réglages de réservation de son espace"
  on public.parametres_reservation for insert with check (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur modifie les réglages de réservation de son espace" on public.parametres_reservation;
create policy "Un utilisateur modifie les réglages de réservation de son espace"
  on public.parametres_reservation for update using (owner_id = public.current_workspace_id());

-- Pas de policy publique : les deux routes api/reservation-*.js lisent/écrivent
-- avec la clé service_role, exactement comme api/document-public.js lit déjà
-- parametres_facturation d'un émetteur quelconque — même schéma « une seule
-- clé, service_role » pour tout accès public (voir CLAUDE.md).

drop trigger if exists set_parametres_reservation_updated_at on public.parametres_reservation;
create trigger set_parametres_reservation_updated_at
  before update on public.parametres_reservation
  for each row execute procedure public.set_updated_at();

-- =====================================================================
-- 2. Rendez-vous « en attente » créés depuis le widget public
-- =====================================================================
-- Une réservation en ligne crée une ligne `rendez_vous` sans fiche client :
-- `client_id` reste null, les coordonnées transitent par les colonnes
-- `prospect_*` jusqu'à ce que le praticien confirme (et crée alors la fiche
-- client lui-même, depuis site/agenda.html). `statut` n'a jamais eu de
-- contrainte CHECK — 'en_attente' s'ajoute donc à 'annule' sans migration de
-- la colonne elle-même.

alter table public.rendez_vous
  add column if not exists prestation_id uuid references public.prestations(id) on delete set null,
  add column if not exists prospect_nom text,
  add column if not exists prospect_email text,
  add column if not exists prospect_telephone text;

-- Utilisé par le calcul de disponibilité (api/reservation-disponibilites.js)
-- pour trouver rapidement les rendez-vous d'un praticien qui chevauchent une
-- fenêtre donnée, sans balayer toute la table.
create index if not exists rendez_vous_disponibilite_idx
  on public.rendez_vous (owner_id, date_debut, date_fin);

-- =====================================================================
-- 3. Création automatique à l'inscription + rattrapage
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger as $$
declare
  jeton text := new.raw_user_meta_data->>'invite_token';
  membre public.workspace_members;
begin
  insert into public.profiles (id, full_name, plan, business_name)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    coalesce(new.raw_user_meta_data->>'plan', 'solo'),
    new.raw_user_meta_data->>'full_name'
  )
  on conflict (id) do nothing;

  insert into public.parametres_facturation (owner_id, emetteur_nom, emetteur_email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (owner_id) do nothing;

  insert into public.parametres_reservation (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  insert into public.calendar_feeds (owner_id, token)
  values (new.id, public.new_feed_token())
  on conflict (owner_id) do nothing;

  if jeton is not null then
    select * into membre from public.workspace_members
      where invite_token = jeton and statut = 'invite'
      for update;

    if found then
      update public.workspace_members
        set user_id = new.id, statut = 'actif', joined_at = now()
        where id = membre.id;
      update public.profiles set espace_actif_id = membre.workspace_id where id = new.id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

-- Rattrapage pour les comptes créés avant cette migration. `activee` reste à
-- false et `slug` reste null : le praticien doit choisir volontairement un
-- identifiant public, jamais généré silencieusement par la migration.
insert into public.parametres_reservation (owner_id)
select p.id from public.profiles p
on conflict (owner_id) do nothing;
