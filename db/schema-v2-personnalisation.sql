-- Cadence — migration v2 : personnalisation & connexions agenda.
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Ce que cette migration ajoute :
--   1. Identité, thème et vocabulaire métier sur `profiles`
--   2. `parametres_facturation` — tout ce qui personnalise un devis/facture
--   3. `prestations` — catalogue de prestations réutilisables
--   4. TVA sur les lignes de document
--   5. `calendar_feeds` + `calendar_connections` — abonnement ICS et Google Calendar
--   6. Bucket de stockage `logos` pour le logo et la signature

-- =====================================================================
-- 1. Profil : identité, apparence, vocabulaire métier
-- =====================================================================

alter table public.profiles
  add column if not exists business_name text,
  add column if not exists metier text default 'autre',
  add column if not exists terme_singulier text,
  add column if not exists terme_pluriel text,
  add column if not exists accent text default 'ambre',
  add column if not exists densite text default 'confortable',
  add column if not exists logo_url text,
  add column if not exists updated_at timestamptz default now();

-- Contraintes posées séparément : `add column if not exists` ne rejoue pas
-- un check déjà présent, donc on les (re)crée de façon explicite.
alter table public.profiles drop constraint if exists profiles_metier_check;
alter table public.profiles add constraint profiles_metier_check
  check (metier in ('photographe','coach','formateur','professeur','consultant','therapeute','autre'));

alter table public.profiles drop constraint if exists profiles_accent_check;
alter table public.profiles add constraint profiles_accent_check
  check (accent in ('ambre','marine','ciel','acajou','foret','rose'));

alter table public.profiles drop constraint if exists profiles_densite_check;
alter table public.profiles add constraint profiles_densite_check
  check (densite in ('confortable','compacte'));

-- Il manquait une policy d'insertion : sans elle, un upsert côté client
-- échoue pour un profil dont la ligne n'aurait pas été créée par le trigger.
drop policy if exists "Un utilisateur crée son propre profil" on public.profiles;
create policy "Un utilisateur crée son propre profil"
  on public.profiles for insert
  with check (auth.uid() = id);

drop trigger if exists set_profiles_updated_at on public.profiles;
create trigger set_profiles_updated_at
  before update on public.profiles
  for each row execute procedure public.set_updated_at();

-- =====================================================================
-- 2. Paramètres de facturation (1 ligne par utilisateur)
-- =====================================================================
-- Table séparée plutôt que 25 colonnes de plus sur `profiles` : ces champs
-- ne sont lus que par l'écran Paramètres et par le rendu d'un document,
-- jamais au chargement des écrans Clients ou Agenda.

create table if not exists public.parametres_facturation (
  owner_id uuid primary key references auth.users on delete cascade,

  -- Émetteur (obligatoire sur toute facture française)
  emetteur_nom text,
  emetteur_adresse text,
  emetteur_cp text,
  emetteur_ville text,
  emetteur_pays text default 'France',
  emetteur_email text,
  emetteur_tel text,

  -- Mentions légales
  forme_juridique text,
  siret text,
  tva_numero text,
  rcs_ville text,
  assujetti_tva boolean not null default false,
  tva_taux_defaut numeric not null default 20,

  -- Paiement
  iban text,
  bic text,
  delai_paiement_jours int not null default 30,
  conditions_paiement text,
  penalites_retard text,
  mentions_pied text,

  -- Numérotation
  prefixe_devis text not null default 'DEV',
  prefixe_facture text not null default 'FAC',

  -- Apparence du document
  modele text not null default 'moderne',
  couleur_document text not null default 'theme',
  afficher_logo boolean not null default true,
  afficher_mention_cadence boolean not null default true,
  signature_url text,

  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.parametres_facturation drop constraint if exists parametres_facturation_modele_check;
alter table public.parametres_facturation add constraint parametres_facturation_modele_check
  check (modele in ('moderne','classique'));

alter table public.parametres_facturation enable row level security;

drop policy if exists "Un utilisateur voit ses paramètres de facturation" on public.parametres_facturation;
create policy "Un utilisateur voit ses paramètres de facturation"
  on public.parametres_facturation for select using (auth.uid() = owner_id);

drop policy if exists "Un utilisateur crée ses paramètres de facturation" on public.parametres_facturation;
create policy "Un utilisateur crée ses paramètres de facturation"
  on public.parametres_facturation for insert with check (auth.uid() = owner_id);

drop policy if exists "Un utilisateur modifie ses paramètres de facturation" on public.parametres_facturation;
create policy "Un utilisateur modifie ses paramètres de facturation"
  on public.parametres_facturation for update using (auth.uid() = owner_id);

drop trigger if exists set_parametres_facturation_updated_at on public.parametres_facturation;
create trigger set_parametres_facturation_updated_at
  before update on public.parametres_facturation
  for each row execute procedure public.set_updated_at();

-- =====================================================================
-- 3. Catalogue de prestations réutilisables
-- =====================================================================
-- Un coach saisit « Séance individuelle 60 min — 60 € » une fois ; elle est
-- ensuite proposée à la création d'un rendez-vous comme d'une ligne de devis.

create table if not exists public.prestations (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  libelle text not null,
  description text,
  prix_unitaire numeric not null default 0,
  duree_minutes int not null default 60,
  tva_taux numeric not null default 0,
  actif boolean not null default true,
  position int not null default 0,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.prestations enable row level security;

drop policy if exists "Un utilisateur voit ses prestations" on public.prestations;
create policy "Un utilisateur voit ses prestations"
  on public.prestations for select using (auth.uid() = owner_id);

drop policy if exists "Un utilisateur crée ses prestations" on public.prestations;
create policy "Un utilisateur crée ses prestations"
  on public.prestations for insert with check (auth.uid() = owner_id);

drop policy if exists "Un utilisateur modifie ses prestations" on public.prestations;
create policy "Un utilisateur modifie ses prestations"
  on public.prestations for update using (auth.uid() = owner_id);

drop policy if exists "Un utilisateur supprime ses prestations" on public.prestations;
create policy "Un utilisateur supprime ses prestations"
  on public.prestations for delete using (auth.uid() = owner_id);

drop trigger if exists set_prestations_updated_at on public.prestations;
create trigger set_prestations_updated_at
  before update on public.prestations
  for each row execute procedure public.set_updated_at();

create index if not exists prestations_owner_idx on public.prestations (owner_id, position);

-- =====================================================================
-- 4. TVA sur les lignes de document
-- =====================================================================
-- Le taux vit sur la ligne (et non sur le document) parce qu'une facture
-- peut légalement mélanger plusieurs taux. Défaut 0 : les documents déjà
-- créés restent inchangés et continuent de totaliser comme avant.

alter table public.document_lignes
  add column if not exists tva_taux numeric not null default 0;

-- =====================================================================
-- 5. Connexions agenda
-- =====================================================================

-- 5a. Flux ICS sortant : une URL secrète par utilisateur, à laquelle
-- Google Agenda / Apple Calendrier / Outlook peuvent s'abonner.
-- Le jeton est une capacité : qui l'a peut lire l'agenda, d'où la
-- possibilité de le régénérer (`rotate_calendar_feed_token`).

create table if not exists public.calendar_feeds (
  owner_id uuid primary key references auth.users on delete cascade,
  token text not null unique,
  created_at timestamptz default now(),
  last_access_at timestamptz
);

alter table public.calendar_feeds enable row level security;

drop policy if exists "Un utilisateur voit son flux" on public.calendar_feeds;
create policy "Un utilisateur voit son flux"
  on public.calendar_feeds for select using (auth.uid() = owner_id);

drop policy if exists "Un utilisateur crée son flux" on public.calendar_feeds;
create policy "Un utilisateur crée son flux"
  on public.calendar_feeds for insert with check (auth.uid() = owner_id);

drop policy if exists "Un utilisateur régénère son flux" on public.calendar_feeds;
create policy "Un utilisateur régénère son flux"
  on public.calendar_feeds for update using (auth.uid() = owner_id);

-- 64 caractères hexadécimaux tirés de deux UUID v4 : assez d'entropie pour
-- une URL-capacité, sans dépendre de l'extension pgcrypto.
create or replace function public.new_feed_token()
returns text as $$
  select replace(gen_random_uuid()::text, '-', '') || replace(gen_random_uuid()::text, '-', '');
$$ language sql volatile;

create or replace function public.rotate_calendar_feed_token()
returns text as $$
declare
  t text := public.new_feed_token();
begin
  insert into public.calendar_feeds (owner_id, token)
  values (auth.uid(), t)
  on conflict (owner_id) do update set token = t, created_at = now();
  return t;
end;
$$ language plpgsql security definer set search_path = public;

-- 5b. Connexion Google Calendar (poussée des rendez-vous vers l'agenda Google).
create table if not exists public.calendar_connections (
  owner_id uuid primary key references auth.users on delete cascade,
  provider text not null default 'google',
  account_email text,
  calendar_id text default 'primary',
  actif boolean not null default true,
  connected_at timestamptz default now(),
  last_sync_at timestamptz,
  last_error text
);

alter table public.calendar_connections drop constraint if exists calendar_connections_provider_check;
alter table public.calendar_connections add constraint calendar_connections_provider_check
  check (provider in ('google'));

alter table public.calendar_connections enable row level security;

drop policy if exists "Un utilisateur voit sa connexion agenda" on public.calendar_connections;
create policy "Un utilisateur voit sa connexion agenda"
  on public.calendar_connections for select using (auth.uid() = owner_id);

drop policy if exists "Un utilisateur crée sa connexion agenda" on public.calendar_connections;
create policy "Un utilisateur crée sa connexion agenda"
  on public.calendar_connections for insert with check (auth.uid() = owner_id);

drop policy if exists "Un utilisateur modifie sa connexion agenda" on public.calendar_connections;
create policy "Un utilisateur modifie sa connexion agenda"
  on public.calendar_connections for update using (auth.uid() = owner_id);

drop policy if exists "Un utilisateur supprime sa connexion agenda" on public.calendar_connections;
create policy "Un utilisateur supprime sa connexion agenda"
  on public.calendar_connections for delete using (auth.uid() = owner_id);

-- Identifiant de l'évènement côté Google, pour pouvoir mettre à jour ou
-- supprimer l'évènement poussé plutôt que d'en recréer un doublon.
alter table public.rendez_vous
  add column if not exists google_event_id text,
  add column if not exists synced_at timestamptz;

create index if not exists rendez_vous_google_event_idx
  on public.rendez_vous (owner_id, google_event_id);

-- =====================================================================
-- 6. Stockage du logo et de la signature
-- =====================================================================
-- Bucket public en lecture (le logo apparaît sur des documents envoyés à des
-- clients, donc il doit être lisible sans session) mais en écriture strictement
-- limitée au dossier de l'utilisateur : `logos/<uid>/…`.

insert into storage.buckets (id, name, public)
values ('logos', 'logos', true)
on conflict (id) do nothing;

drop policy if exists "Logos lisibles par tous" on storage.objects;
create policy "Logos lisibles par tous"
  on storage.objects for select
  using (bucket_id = 'logos');

drop policy if exists "Un utilisateur dépose dans son dossier" on storage.objects;
create policy "Un utilisateur dépose dans son dossier"
  on storage.objects for insert
  with check (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Un utilisateur remplace dans son dossier" on storage.objects;
create policy "Un utilisateur remplace dans son dossier"
  on storage.objects for update
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

drop policy if exists "Un utilisateur supprime dans son dossier" on storage.objects;
create policy "Un utilisateur supprime dans son dossier"
  on storage.objects for delete
  using (bucket_id = 'logos' and (storage.foldername(name))[1] = auth.uid()::text);

-- =====================================================================
-- 7. Création automatique des lignes annexes à l'inscription
-- =====================================================================

create or replace function public.handle_new_user()
returns trigger as $$
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

  insert into public.calendar_feeds (owner_id, token)
  values (new.id, public.new_feed_token())
  on conflict (owner_id) do nothing;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Rattrapage pour les comptes créés avant cette migration.
insert into public.parametres_facturation (owner_id, emetteur_nom)
select p.id, p.full_name from public.profiles p
on conflict (owner_id) do nothing;

insert into public.calendar_feeds (owner_id, token)
select p.id, public.new_feed_token() from public.profiles p
on conflict (owner_id) do nothing;

update public.profiles
set business_name = full_name
where business_name is null;
