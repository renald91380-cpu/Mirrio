-- Cadence — migration v3 : espaces partagés (collaborateurs), relances automatiques.
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Ce que cette migration ajoute :
--   1. Un modèle d'« espace » : plusieurs utilisateurs Supabase distincts travaillent
--      sur les mêmes clients/rendez-vous/documents (offre Studio).
--   2. Les RPC d'invitation, d'acceptation, de révocation et de bascule d'espace.
--   3. La mise à jour de TOUTES les policies RLS existantes pour raisonner en
--      « espace actif » plutôt qu'en `auth.uid()` direct — sans rien changer au
--      comportement d'un compte solo, qui reste son propre espace.
--   4. Les colonnes de suivi nécessaires aux relances automatiques.
--
-- Principe de conception : un « espace » n'est PAS une nouvelle entité avec son
-- propre identifiant. C'est l'espace du compte qui l'a créé : `workspace_id` vaut
-- toujours l'`id` du profil propriétaire. Une ligne `clients.owner_id` créée avant
-- cette migration reste donc valide sans aucune donnée à réécrire — c'est déjà,
-- exactement, un identifiant d'espace à un seul membre.

-- =====================================================================
-- 1. Espace actif de l'utilisateur
-- =====================================================================
-- Un utilisateur solo n'a pas besoin de cette colonne : elle reste NULL et
-- `current_workspace_id()` retombe sur son propre id. Elle ne se remplit que
-- pour quelqu'un qui a rejoint l'espace d'un tiers (ou qui bascule entre
-- plusieurs espaces auxquels il appartient).

alter table public.profiles
  add column if not exists espace_actif_id uuid references public.profiles(id) on delete set null;

-- =====================================================================
-- 1bis. Résolution de l'espace actif — le cœur du modèle
-- =====================================================================
-- Déplacée ici (avant les policies de la section 2) car ces policies
-- référencent la fonction par son nom : Postgres doit pouvoir la résoudre
-- au moment du `create policy`, donc elle doit déjà exister.
--
-- Revalide l'appartenance à CHAQUE appel plutôt que de faire confiance à la
-- colonne stockée : si `profiles.espace_actif_id` pointe vers un espace dont
-- l'utilisateur a été entre-temps révoqué, la fonction l'ignore et retombe sur
-- l'espace personnel. Ainsi aucune policy RLS ne dépend d'une valeur que le
-- client pourrait avoir laissée périmée.
create or replace function public.current_workspace_id()
returns uuid as $$
declare
  souhaite uuid;
begin
  select espace_actif_id into souhaite from public.profiles where id = auth.uid();

  if souhaite is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = souhaite
      and m.user_id = auth.uid()
      and m.statut = 'actif'
  ) then
    return souhaite;
  end if;

  return auth.uid();
end;
$$ language plpgsql stable security definer set search_path = public;

-- =====================================================================
-- 2. Membres d'un espace
-- =====================================================================

create table if not exists public.workspace_members (
  id uuid primary key default gen_random_uuid(),
  workspace_id uuid not null references public.profiles(id) on delete cascade,
  user_id uuid references auth.users on delete cascade,
  email text not null,
  role text not null default 'collaborateur',
  statut text not null default 'invite',
  invite_token text unique,
  invited_at timestamptz default now(),
  joined_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz default now()
);

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check
  check (role in ('proprietaire', 'collaborateur'));

alter table public.workspace_members drop constraint if exists workspace_members_statut_check;
alter table public.workspace_members add constraint workspace_members_statut_check
  check (statut in ('invite', 'actif', 'revoque'));

-- Un utilisateur déjà membre actif ne peut pas être ré-invité en double sur le
-- même espace (l'index partiel autorise en revanche plusieurs lignes 'revoque'
-- dans l'historique, et plusieurs invitations à la même adresse si la précédente
-- a été révoquée ou n'a pas encore été acceptée par ce user_id).
create unique index if not exists workspace_members_actif_unique
  on public.workspace_members (workspace_id, user_id)
  where statut = 'actif' and user_id is not null;

alter table public.workspace_members enable row level security;

-- Lecture : le propriétaire et les membres actifs voient tout le trombinoscope
-- de l'espace où ils travaillent actuellement ; par ailleurs, chacun voit aussi
-- ses propres lignes d'appartenance dans n'importe quel espace (nécessaire pour
-- lister « les espaces auxquels vous appartenez » dans le sélecteur de bascule).
drop policy if exists "Voir les membres de son espace" on public.workspace_members;
create policy "Voir les membres de son espace"
  on public.workspace_members for select
  using (
    workspace_id = public.current_workspace_id()
    or user_id = auth.uid()
  );

-- Gestion (inviter/modifier/révoquer) : réservée au propriétaire de l'espace.
-- Volontairement restrictif — un collaborateur ne peut pas en inviter un autre.
drop policy if exists "Le propriétaire gère les membres" on public.workspace_members;
create policy "Le propriétaire gère les membres"
  on public.workspace_members for all
  using (auth.uid() = workspace_id)
  with check (auth.uid() = workspace_id);

-- =====================================================================
-- 3. Résolution de l'espace actif — le cœur du modèle
-- =====================================================================
-- Revalide l'appartenance à CHAQUE appel plutôt que de faire confiance à la
-- colonne stockée : si `profiles.espace_actif_id` pointe vers un espace dont
-- l'utilisateur a été entre-temps révoqué, la fonction l'ignore et retombe sur
-- l'espace personnel. Ainsi aucune policy RLS ne dépend d'une valeur que le
-- client pourrait avoir laissée périmée.
create or replace function public.current_workspace_id()
returns uuid as $$
declare
  souhaite uuid;
begin
  select espace_actif_id into souhaite from public.profiles where id = auth.uid();

  if souhaite is not null and exists (
    select 1 from public.workspace_members m
    where m.workspace_id = souhaite
      and m.user_id = auth.uid()
      and m.statut = 'actif'
  ) then
    return souhaite;
  end if;

  return auth.uid();
end;
$$ language plpgsql stable security definer set search_path = public;

-- =====================================================================
-- 4. RPC : inviter, accepter, révoquer, basculer
-- =====================================================================

-- Seul le propriétaire invite, et seulement si son offre est Studio — c'est un
-- garde-fou d'usage cohérent avec le reste du projet (aucun paiement Stripe
-- n'est encore branché nulle part), pas un contrôle de facturation réel.
create or replace function public.inviter_collaborateur(p_email text)
returns public.workspace_members as $$
declare
  mon_plan text;
  ligne public.workspace_members;
begin
  select plan into mon_plan from public.profiles where id = auth.uid();
  if mon_plan is distinct from 'studio' then
    raise exception 'Le partage multi-collaborateurs est réservé à la formule Studio.'
      using errcode = 'insufficient_privilege';
  end if;

  if p_email is null or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Adresse email invalide.' using errcode = 'invalid_parameter_value';
  end if;

  insert into public.workspace_members (workspace_id, email, role, statut, invite_token)
  values (auth.uid(), lower(trim(p_email)), 'collaborateur', 'invite', public.new_feed_token())
  returning * into ligne;

  return ligne;
end;
$$ language plpgsql security definer set search_path = public;

-- Appelée par la personne invitée une fois connectée, avec le jeton reçu.
create or replace function public.accepter_invitation(p_token text)
returns public.workspace_members as $$
declare
  ligne public.workspace_members;
begin
  select * into ligne from public.workspace_members
    where invite_token = p_token and statut = 'invite'
    for update;

  if not found then
    raise exception 'Cette invitation est introuvable ou a déjà été utilisée.'
      using errcode = 'no_data_found';
  end if;

  update public.workspace_members
    set user_id = auth.uid(), statut = 'actif', joined_at = now()
    where id = ligne.id
    returning * into ligne;

  update public.profiles set espace_actif_id = ligne.workspace_id where id = auth.uid();

  return ligne;
end;
$$ language plpgsql security definer set search_path = public;

-- Réservée au propriétaire. Un membre révoqué qui travaillait dans cet espace
-- en est ramené vers son propre espace au prochain chargement.
create or replace function public.revoquer_collaborateur(p_membre_id uuid)
returns void as $$
declare
  cible uuid;
begin
  update public.workspace_members
    set statut = 'revoque', revoked_at = now()
    where id = p_membre_id and workspace_id = auth.uid()
    returning user_id into cible;

  if not found then
    raise exception 'Membre introuvable dans votre espace.' using errcode = 'no_data_found';
  end if;

  if cible is not null then
    update public.profiles set espace_actif_id = null
      where id = cible and espace_actif_id = auth.uid();
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- Change l'espace dans lequel l'utilisateur travaille. `null` revient à son
-- espace personnel. Refuse silencieusement une cible dont il n'est pas membre
-- actif — current_workspace_id() l'aurait de toute façon ignorée, mais lever
-- une erreur ici donne un retour clair à l'écran plutôt qu'un échec muet.
create or replace function public.basculer_espace(p_espace_id uuid)
returns void as $$
begin
  if p_espace_id is null then
    update public.profiles set espace_actif_id = null where id = auth.uid();
    return;
  end if;

  if not exists (
    select 1 from public.workspace_members
    where workspace_id = p_espace_id and user_id = auth.uid() and statut = 'actif'
  ) then
    raise exception 'Vous n''êtes plus membre de cet espace.' using errcode = 'insufficient_privilege';
  end if;

  update public.profiles set espace_actif_id = p_espace_id where id = auth.uid();
end;
$$ language plpgsql security definer set search_path = public;

-- Rattachement automatique à l'inscription : si le lien d'invitation a été
-- suivi avant de créer le compte, `signup.html` transmet le jeton en métadonnée
-- et ce trigger, déjà en charge de créer le profil, referme la boucle sans
-- second aller-retour du navigateur.
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

-- =====================================================================
-- 5. RLS : raisonner en espace plutôt qu'en compte
-- =====================================================================
-- Chaque policy `auth.uid() = owner_id` devient `owner_id = current_workspace_id()`.
-- Un compte solo n'y voit aucune différence : sa fonction renvoie son propre id.

-- ---- clients ----
drop policy if exists "Un utilisateur voit ses propres clients" on public.clients;
create policy "Un utilisateur voit les clients de son espace"
  on public.clients for select using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur crée ses propres clients" on public.clients;
create policy "Un utilisateur crée des clients dans son espace"
  on public.clients for insert with check (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur modifie ses propres clients" on public.clients;
create policy "Un utilisateur modifie les clients de son espace"
  on public.clients for update using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur supprime ses propres clients" on public.clients;
create policy "Un utilisateur supprime les clients de son espace"
  on public.clients for delete using (owner_id = public.current_workspace_id());

-- ---- rendez_vous ----
drop policy if exists "Un utilisateur voit ses propres rendez-vous" on public.rendez_vous;
create policy "Un utilisateur voit les rendez-vous de son espace"
  on public.rendez_vous for select using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur crée ses propres rendez-vous" on public.rendez_vous;
create policy "Un utilisateur crée des rendez-vous dans son espace"
  on public.rendez_vous for insert with check (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur modifie ses propres rendez-vous" on public.rendez_vous;
create policy "Un utilisateur modifie les rendez-vous de son espace"
  on public.rendez_vous for update using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur supprime ses propres rendez-vous" on public.rendez_vous;
create policy "Un utilisateur supprime les rendez-vous de son espace"
  on public.rendez_vous for delete using (owner_id = public.current_workspace_id());

-- ---- documents ----
drop policy if exists "Un utilisateur voit ses propres documents" on public.documents;
create policy "Un utilisateur voit les documents de son espace"
  on public.documents for select using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur crée ses propres documents" on public.documents;
create policy "Un utilisateur crée des documents dans son espace"
  on public.documents for insert with check (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur modifie ses propres documents" on public.documents;
create policy "Un utilisateur modifie les documents de son espace"
  on public.documents for update using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur supprime ses propres documents" on public.documents;
create policy "Un utilisateur supprime les documents de son espace"
  on public.documents for delete using (owner_id = public.current_workspace_id());

-- ---- document_lignes (accès via le document parent) ----
drop policy if exists "Un utilisateur voit les lignes de ses documents" on public.document_lignes;
create policy "Un utilisateur voit les lignes des documents de son espace"
  on public.document_lignes for select
  using (exists (select 1 from public.documents d
                 where d.id = document_lignes.document_id
                   and d.owner_id = public.current_workspace_id()));

drop policy if exists "Un utilisateur crée des lignes sur ses documents" on public.document_lignes;
create policy "Un utilisateur crée des lignes dans son espace"
  on public.document_lignes for insert
  with check (exists (select 1 from public.documents d
                       where d.id = document_lignes.document_id
                         and d.owner_id = public.current_workspace_id()));

drop policy if exists "Un utilisateur modifie les lignes de ses documents" on public.document_lignes;
create policy "Un utilisateur modifie les lignes de son espace"
  on public.document_lignes for update
  using (exists (select 1 from public.documents d
                 where d.id = document_lignes.document_id
                   and d.owner_id = public.current_workspace_id()));

drop policy if exists "Un utilisateur supprime les lignes de ses documents" on public.document_lignes;
create policy "Un utilisateur supprime les lignes de son espace"
  on public.document_lignes for delete
  using (exists (select 1 from public.documents d
                 where d.id = document_lignes.document_id
                   and d.owner_id = public.current_workspace_id()));

-- ---- document_counters ----
drop policy if exists "Un utilisateur voit ses propres compteurs" on public.document_counters;
create policy "Un utilisateur voit les compteurs de son espace"
  on public.document_counters for select using (owner_id = public.current_workspace_id());

-- generate_document_number() insère avec `security definer` et n'est pas
-- soumis à RLS côté écriture, donc aucune policy insert/update à ajouter ici.

-- ---- prestations ----
drop policy if exists "Un utilisateur voit ses prestations" on public.prestations;
create policy "Un utilisateur voit les prestations de son espace"
  on public.prestations for select using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur crée ses prestations" on public.prestations;
create policy "Un utilisateur crée des prestations dans son espace"
  on public.prestations for insert with check (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur modifie ses prestations" on public.prestations;
create policy "Un utilisateur modifie les prestations de son espace"
  on public.prestations for update using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur supprime ses prestations" on public.prestations;
create policy "Un utilisateur supprime les prestations de son espace"
  on public.prestations for delete using (owner_id = public.current_workspace_id());

-- ---- parametres_facturation ----
drop policy if exists "Un utilisateur voit ses paramètres de facturation" on public.parametres_facturation;
create policy "Un utilisateur voit les paramètres de facturation de son espace"
  on public.parametres_facturation for select using (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur crée ses paramètres de facturation" on public.parametres_facturation;
create policy "Un utilisateur crée les paramètres de facturation de son espace"
  on public.parametres_facturation for insert with check (owner_id = public.current_workspace_id());

drop policy if exists "Un utilisateur modifie ses paramètres de facturation" on public.parametres_facturation;
create policy "Un utilisateur modifie les paramètres de facturation de son espace"
  on public.parametres_facturation for update using (owner_id = public.current_workspace_id());

-- ---- profiles (lecture seule pour un collaborateur) ----
-- Politique additive, pas un remplacement : la policy `auth.uid() = id` posée
-- par la migration d'origine reste en place (chacun voit son propre profil).
-- Celle-ci l'étend en OR, comme toute policy RLS permissive additionnelle :
-- un membre actif d'un espace peut aussi lire le profil du PROPRIÉTAIRE de cet
-- espace, pour afficher et imprimer le bon nom commercial / logo / vocabulaire
-- métier — jamais les siens propres, souvent vierges. Aucun droit d'écriture
-- n'est accordé ici : l'identité de marque reste modifiable par son seul
-- propriétaire, une décision volontaire plutôt qu'un oubli.
drop policy if exists "Un membre voit le profil de l'espace" on public.profiles;
create policy "Un membre voit le profil de l'espace"
  on public.profiles for select
  using (
    exists (
      select 1 from public.workspace_members m
      where m.workspace_id = profiles.id
        and m.user_id = auth.uid()
        and m.statut = 'actif'
    )
  );

-- ---- calendar_feeds / calendar_connections ----
-- Restent volontairement liés au compte (`owner_id`), pas à l'espace : le flux
-- iCalendar et la connexion Google Calendar sont personnels à l'agenda de
-- CHAQUE utilisateur, même quand plusieurs personnes partagent les mêmes
-- clients — un collaborateur ne doit pas hériter du Google Agenda du
-- propriétaire. Aucune policy à changer ici.

-- =====================================================================
-- 6. Suivi des relances automatiques
-- =====================================================================

alter table public.documents
  add column if not exists derniere_relance_at timestamptz,
  add column if not exists nombre_relances int not null default 0;

alter table public.parametres_facturation
  add column if not exists relances_activees boolean not null default true,
  add column if not exists relance_delai_jours int not null default 7;

-- Index utilisé par le cron quotidien pour cibler uniquement les factures en
-- attente de paiement, sans balayer toute la table à chaque passage.
create index if not exists documents_relance_idx
  on public.documents (owner_id, type, statut, date_echeance)
  where type = 'facture';
