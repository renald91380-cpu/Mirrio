-- Cadence — migration v8 : paiements anticipés (Stripe / PayPal), phase 1.
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Ce que cette migration ajoute :
--   1. `parametres_paiement` — clés Stripe/PayPal par espace, + une vue
--      `parametres_paiement_public` qui n'expose jamais les colonnes secrètes
--      au navigateur (voir §2, structurel, pas une simple convention côté
--      requête client).
--   2. Colonnes de suivi de paiement sur `rendez_vous` (statut, montant,
--      fournisseur, référence, expiration du verrou de créneau).
--   3. Correction d'un bug préexistant sur `rendez_vous_statut_check` (voir
--      note plus bas) et rattrapage de `handle_new_user()`.
--
-- Cette migration ne construit QUE la surface « demander un paiement depuis
-- l'agenda sur un rendez-vous déjà confirmé » (phase 1 du plan). Les surfaces
-- devis et réservation-en-ligne-avec-auto-confirmation, ainsi que PayPal,
-- viennent dans des passes suivantes — la table/les colonnes ci-dessous sont
-- déjà pensées pour elles (colonnes PayPal présentes dès maintenant), mais
-- rien ne les utilise encore.

-- =====================================================================
-- 1. Clés de paiement par espace
-- =====================================================================
-- Table séparée, même logique que `parametres_facturation`/`parametres_reservation` :
-- un praticien reçoit l'argent sur SON PROPRE compte Stripe/PayPal, jamais sur
-- un compte plateforme unique — chacun colle ses propres clés API. Pas
-- d'onboarding Stripe Connect/OAuth dans cette phase.

create table if not exists public.parametres_paiement (
  owner_id uuid primary key references auth.users on delete cascade,

  stripe_actif boolean not null default false,
  stripe_secret_key text,
  stripe_publishable_key text,
  stripe_webhook_secret text,

  paypal_actif boolean not null default false,
  paypal_client_id text,
  paypal_client_secret text,
  paypal_webhook_id text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.parametres_paiement enable row level security;

drop policy if exists "Un utilisateur voit les clés de paiement de son espace" on public.parametres_paiement;
create policy "Un utilisateur voit les clés de paiement de son espace"
  on public.parametres_paiement for select using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur crée les clés de paiement de son espace" on public.parametres_paiement;
create policy "Un utilisateur crée les clés de paiement de son espace"
  on public.parametres_paiement for insert with check (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur modifie les clés de paiement de son espace" on public.parametres_paiement;
create policy "Un utilisateur modifie les clés de paiement de son espace"
  on public.parametres_paiement for update using (owner_id = public.current_workspace_id());

drop trigger if exists set_parametres_paiement_updated_at on public.parametres_paiement;
create trigger set_parametres_paiement_updated_at
  before update on public.parametres_paiement
  for each row execute procedure public.set_updated_at();

-- =====================================================================
-- 2. Vue publique — sélection explicite des colonnes non sensibles.
--    Tentative initiale : verrouiller ça structurellement en révoquant
--    SELECT sur la table de base pour `authenticated`/`anon`. Ça ne tient
--    PAS sur ce projet Supabase — un mécanisme de la plateforme réapplique
--    les privilèges par défaut (SELECT/INSERT/UPDATE/DELETE à `anon` ET
--    `authenticated`) peu après un `revoke`, hors de notre contrôle en SQL
--    pur (vérifié empiriquement : le revoke tient le temps d'une requête,
--    puis disparaît). Isoler vraiment les colonnes secrètes demanderait un
--    schéma non exposé par l'API PostgREST, ce qui sort du SQL et touche
--    aux réglages du projet Supabase (Exposed schemas) — hors scope ici.
--    Repli assumé : `site/parametres.html` ne sélectionne JAMAIS les
--    colonnes secrètes, uniquement via cette vue — même modèle de confiance
--    que le reste du projet (RLS par `owner_id`, aucun verrouillage colonne
--    par colonne nulle part ailleurs — IBAN/BIC dans `parametres_facturation`
--    suivent déjà ce même principe). À documenter comme limite connue dans
--    CLAUDE.md, pas un oubli.
-- =====================================================================

create or replace view public.parametres_paiement_public
  with (security_invoker = true) as
  select owner_id, stripe_actif, stripe_publishable_key, paypal_actif, paypal_client_id
  from public.parametres_paiement;

grant select on public.parametres_paiement_public to authenticated;

-- =====================================================================
-- 3. Suivi de paiement sur `rendez_vous`
-- =====================================================================
-- Colonnes orthogonales à `statut` (qui reste confirme/annule/en_attente) :
-- un rendez-vous garde son statut de rendez-vous habituel, `paiement_statut`
-- ne fait que suivre l'argent. `expire_le` porte le verrou temporaire du
-- créneau pendant qu'un paiement est en cours (phase réservation-en-ligne,
-- pas encore câblée par cette migration, mais la colonne est prête).

alter table public.rendez_vous
  add column if not exists paiement_statut text,
  add column if not exists paiement_montant numeric,
  add column if not exists paiement_provider text,
  add column if not exists paiement_reference text,
  add column if not exists expire_le timestamptz;

alter table public.rendez_vous alter column paiement_statut set default 'non_requis';
update public.rendez_vous set paiement_statut = 'non_requis' where paiement_statut is null;
alter table public.rendez_vous alter column paiement_statut set not null;

alter table public.rendez_vous drop constraint if exists rendez_vous_paiement_statut_check;
alter table public.rendez_vous add constraint rendez_vous_paiement_statut_check
  check (paiement_statut in ('non_requis','en_attente','paye','echoue'));

alter table public.rendez_vous drop constraint if exists rendez_vous_paiement_provider_check;
alter table public.rendez_vous add constraint rendez_vous_paiement_provider_check
  check (paiement_provider is null or paiement_provider in ('stripe','paypal'));

-- Bug corrigé au passage : cette contrainte, déclarée dans schema.sql, n'a
-- jamais autorisé 'en_attente' — schema-v6-reservation-en-ligne.sql affirmait
-- à tort dans son commentaire qu'aucune contrainte CHECK n'existait sur
-- `statut`. En pratique, toute réservation en ligne échouait silencieusement
-- à l'insert (violation de contrainte, remontée en erreur générique par
-- api/reservation-publique.js). Corrigé ici, en avant, sans réécrire v6.
alter table public.rendez_vous drop constraint if exists rendez_vous_statut_check;
alter table public.rendez_vous add constraint rendez_vous_statut_check
  check (statut in ('confirme','annule','en_attente'));

-- =====================================================================
-- 4. Création automatique à l'inscription + rattrapage
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

  insert into public.parametres_paiement (owner_id)
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

-- Rattrapage pour les comptes créés avant cette migration.
insert into public.parametres_paiement (owner_id)
select p.id from public.profiles p
on conflict (owner_id) do nothing;
