-- Mirrio — schema v27 : coiffure afro + commandes de gâteaux (pâtisseries, boulangeries)
-- À exécuter une fois dans Supabase (SQL Editor). Idempotent.
--
--   1. `parametres_reservation.styles` : spécialités d'un salon de coiffure
--      (pour l'instant `afro`), affichées en badge et filtrables dans l'annuaire.
--   2. Métier `patisserie` accepté par `profiles_metier_check`.
--   3. Commandes de gâteaux : `parametres_gateaux` (réglages), `gateaux_produits`
--      (catalogue) et `gateaux_commandes` (demandes des clients). Tout est scopé
--      par `owner_id = current_workspace_id()` ; les clients, eux, n'ont aucun
--      accès direct : la page publique passe par api/_gateaux.js (service_role).

-- 1. Styles de coiffure --------------------------------------------------
alter table public.parametres_reservation
  add column if not exists styles text[] not null default '{}';
alter table public.parametres_reservation drop constraint if exists parametres_reservation_styles_check;
alter table public.parametres_reservation add constraint parametres_reservation_styles_check
  check (styles <@ array['afro']::text[]);

-- 2. Métier pâtisserie ----------------------------------------------------
alter table public.profiles drop constraint if exists profiles_metier_check;
alter table public.profiles add constraint profiles_metier_check
  check (metier in ('photographe','coach','formateur','professeur','consultant','therapeute',
                    'esthetique','coiffure','barbier','onglerie','massage','patisserie','autre'));

-- 3. Commandes de gâteaux -------------------------------------------------
create table if not exists public.parametres_gateaux (
  owner_id uuid primary key references public.profiles(id) on delete cascade,
  activee boolean not null default false,
  delai_min_jours int not null default 3 check (delai_min_jours between 0 and 60),
  horizon_jours int not null default 120 check (horizon_jours between 7 and 365),
  commandes_max_par_jour int not null default 5 check (commandes_max_par_jour between 1 and 100),
  jours_fermes int[] not null default '{1}',          -- 0 = dimanche … 6 = samedi
  heure_retrait_debut time not null default '08:00',
  heure_retrait_fin time not null default '18:00',
  acompte_pourcentage int not null default 30 check (acompte_pourcentage between 0 and 100),
  adresse_retrait text check (adresse_retrait is null or char_length(adresse_retrait) <= 200),
  message_accueil text check (message_accueil is null or char_length(message_accueil) <= 400),
  updated_at timestamptz not null default now()
);

create table if not exists public.gateaux_produits (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  nom text not null check (char_length(nom) between 2 and 80),
  description text check (description is null or char_length(description) <= 300),
  categorie text check (categorie is null or char_length(categorie) <= 40),
  photo_url text check (photo_url is null or photo_url ~ '^https://'),
  prix_part numeric(8,2) not null check (prix_part >= 0),
  parts_min int not null default 6 check (parts_min >= 1),
  parts_max int not null default 60 check (parts_max >= parts_min),
  actif boolean not null default true,
  position int not null default 0,
  created_at timestamptz not null default now()
);
create index if not exists gateaux_produits_owner on public.gateaux_produits(owner_id, position);

create table if not exists public.gateaux_commandes (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references public.profiles(id) on delete cascade,
  reference text not null default upper(substr(replace(gen_random_uuid()::text,'-',''),1,8)),
  produit_id uuid references public.gateaux_produits(id) on delete set null,
  produit_nom text not null,
  occasion text not null check (occasion in ('mariage','anniversaire','retraite','communion','bapteme','naissance','fiancailles','entreprise','autre')),
  parts int not null check (parts >= 1),
  personnalisation text check (personnalisation is null or char_length(personnalisation) <= 600),
  message_gateau text check (message_gateau is null or char_length(message_gateau) <= 80),
  allergies text check (allergies is null or char_length(allergies) <= 300),
  date_retrait date not null,
  heure_retrait time,
  client_nom text not null check (char_length(client_nom) between 2 and 80),
  client_email text not null check (client_email ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$'),
  client_telephone text check (client_telephone is null or char_length(client_telephone) <= 30),
  statut text not null default 'nouvelle' check (statut in ('nouvelle','confirmee','prete','retiree','annulee')),
  prix_estime numeric(9,2),                            -- parts × prix_part, calculé par le serveur
  prix_final numeric(9,2),                             -- fixé par le pâtissier après échange
  acompte_pourcentage int,
  note_patissier text check (note_patissier is null or char_length(note_patissier) <= 600),
  created_at timestamptz not null default now()
);
create index if not exists gateaux_commandes_owner_date on public.gateaux_commandes(owner_id, date_retrait);

alter table public.parametres_gateaux enable row level security;
alter table public.gateaux_produits enable row level security;
alter table public.gateaux_commandes enable row level security;

drop policy if exists "espace gere ses reglages gateaux" on public.parametres_gateaux;
create policy "espace gere ses reglages gateaux" on public.parametres_gateaux
  for all using (owner_id = public.current_workspace_id()) with check (owner_id = public.current_workspace_id());

drop policy if exists "espace gere ses produits gateaux" on public.gateaux_produits;
create policy "espace gere ses produits gateaux" on public.gateaux_produits
  for all using (owner_id = public.current_workspace_id()) with check (owner_id = public.current_workspace_id());

-- Les commandes sont créées par le serveur (service_role) ; le pâtissier les lit et les met à jour,
-- il n'en crée ni n'en supprime à la main.
drop policy if exists "espace lit ses commandes gateaux" on public.gateaux_commandes;
create policy "espace lit ses commandes gateaux" on public.gateaux_commandes
  for select using (owner_id = public.current_workspace_id());
drop policy if exists "espace met a jour ses commandes gateaux" on public.gateaux_commandes;
create policy "espace met a jour ses commandes gateaux" on public.gateaux_commandes
  for update using (owner_id = public.current_workspace_id()) with check (owner_id = public.current_workspace_id());
