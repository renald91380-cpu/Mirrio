-- Univers « Mariage » : les futurs mariés planifient leur mariage et demandent des devis aux prestataires de l'annuaire Mirrio.
--   1. profiles.type_compte ('pro' | 'couple') : un compte « couple » est gratuit et atterrit sur mon-mariage.html.
--   2. handle_new_user() : reprend celle de schema-v36 et reconnaît activite = 'mariage'.
--   3. Tables mariages, mariage_taches, mariage_budget, mariage_invites : scopées par owner_id = auth.uid() (le couple n'est pas un
--      espace de travail Mirrio, contrairement aux prestataires).
--   4. mariage_demandes : demande de devis d'un couple à un prestataire. Le couple n'insère ni ne modifie rien directement : tout passe
--      par des fonctions security definer qui vérifient l'appartenance. Le prestataire lit les demandes de son espace
--      (current_workspace_id()) et répond via mariage_repondre().
--   5. RSVP invités par jeton (rsvp_lire / rsvp_repondre), appelables sans connexion : ne renvoient que le strict nécessaire.
-- Sûr à rejouer en entier.

-- 1. Type de compte ----------------------------------------------------------------------------------------------------------
alter table public.profiles add column if not exists type_compte text not null default 'pro';
alter table public.profiles drop constraint if exists profiles_type_compte_check;
alter table public.profiles add constraint profiles_type_compte_check check (type_compte in ('pro', 'couple'));

-- 2. Création de compte ------------------------------------------------------------------------------------------------------
create or replace function public.handle_new_user()
returns trigger as $$
declare
  jeton text := new.raw_user_meta_data->>'invite_token';
  patisserie boolean := new.raw_user_meta_data->>'activite' = 'patisserie';
  couple boolean := new.raw_user_meta_data->>'activite' = 'mariage';
  membre public.workspace_members;
begin
  insert into public.profiles (id, full_name, plan, business_name, metier, type_compte)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    case when patisserie then 'studio' else coalesce(new.raw_user_meta_data->>'plan', 'solo') end,
    new.raw_user_meta_data->>'full_name',
    case when patisserie then 'patisserie' else null end,
    case when couple then 'couple' else 'pro' end
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

-- 3. Le mariage et ses outils ------------------------------------------------------------------------------------------------
create table if not exists public.mariages (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null references auth.users(id) on delete cascade default auth.uid(),
  titre          text not null default 'Notre mariage' check (length(titre) <= 120),
  date_mariage   date,
  ville          text check (length(ville) <= 80),
  budget_total   numeric(12,2) check (budget_total >= 0),
  nb_invites     integer check (nb_invites between 0 and 2000),
  created_at     timestamptz not null default now()
);
create unique index if not exists mariages_un_par_compte on public.mariages(owner_id);

create table if not exists public.mariage_taches (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  mariage_id   uuid not null references public.mariages(id) on delete cascade,
  titre        text not null check (length(titre) between 1 and 160),
  categorie    text not null default 'general' check (length(categorie) <= 40),
  echeance     date,
  fait         boolean not null default false,
  notes        text check (length(notes) <= 1000),
  created_at   timestamptz not null default now()
);

create table if not exists public.mariage_budget (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null references auth.users(id) on delete cascade default auth.uid(),
  mariage_id       uuid not null references public.mariages(id) on delete cascade,
  poste            text not null check (length(poste) between 1 and 80),
  prevu            numeric(12,2) not null default 0 check (prevu >= 0),
  montant          numeric(12,2) not null default 0 check (montant >= 0),   -- devis accepté / dépense engagée
  paye             numeric(12,2) not null default 0 check (paye >= 0),
  prestataire      text check (length(prestataire) <= 120),
  echeance_solde   date,
  notes            text check (length(notes) <= 1000),
  created_at       timestamptz not null default now()
);

create table if not exists public.mariage_invites (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null references auth.users(id) on delete cascade default auth.uid(),
  mariage_id   uuid not null references public.mariages(id) on delete cascade,
  nom          text not null check (length(nom) between 1 and 120),
  email        text check (length(email) <= 160),
  groupe       text check (length(groupe) <= 40),
  statut       text not null default 'attente' check (statut in ('attente', 'oui', 'non')),
  nb_personnes integer not null default 1 check (nb_personnes between 1 and 10),
  regime       text check (length(regime) <= 300),     -- régime alimentaire, allergies : à transmettre au traiteur
  rsvp_token   text not null unique default public.new_feed_token(),
  repondu_le   timestamptz,
  created_at   timestamptz not null default now()
);

do $$
declare t text;
begin
  foreach t in array array['mariages', 'mariage_taches', 'mariage_budget', 'mariage_invites'] loop
    execute format('alter table public.%I enable row level security', t);
    execute format('drop policy if exists "Le couple gère son mariage" on public.%I', t);
    execute format('create policy "Le couple gère son mariage" on public.%I for all using (owner_id = auth.uid()) with check (owner_id = auth.uid())', t);
  end loop;
end $$;

-- Un enfant ne peut viser qu'un mariage du même compte (sinon on pourrait accrocher des lignes au mariage d'un autre).
create or replace function public.mariage_enfant_coherent()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.mariages m where m.id = new.mariage_id and m.owner_id = new.owner_id) then
    raise exception 'Mariage introuvable.';
  end if;
  return new;
end $$;
do $$
declare t text;
begin
  foreach t in array array['mariage_taches', 'mariage_budget', 'mariage_invites'] loop
    execute format('drop trigger if exists %I on public.%I', t || '_coherent', t);
    execute format('create trigger %I before insert or update on public.%I for each row execute function public.mariage_enfant_coherent()', t || '_coherent', t);
  end loop;
end $$;

-- 4. Demandes de devis aux prestataires --------------------------------------------------------------------------------------
create table if not exists public.mariage_demandes (
  id                uuid primary key default gen_random_uuid(),
  mariage_id        uuid not null references public.mariages(id) on delete cascade,
  owner_id          uuid not null references auth.users(id) on delete cascade,     -- le couple
  prestataire_id    uuid not null references auth.users(id) on delete cascade,     -- l'espace du prestataire (profiles.id)
  prestataire_nom   text,
  prestataire_slug  text,
  message           text not null check (length(message) between 1 and 2000),
  date_evenement    date,
  nb_invites        integer check (nb_invites between 0 and 2000),
  budget_indicatif  numeric(12,2) check (budget_indicatif >= 0),
  contact_nom       text not null check (length(contact_nom) between 1 and 120),
  contact_email     text not null check (length(contact_email) between 3 and 160),
  contact_telephone text check (length(contact_telephone) <= 30),
  statut            text not null default 'envoyee' check (statut in ('envoyee', 'repondue', 'indisponible', 'acceptee', 'refusee')),
  reponse           text check (length(reponse) <= 2000),
  montant_propose   numeric(12,2) check (montant_propose >= 0),
  repondu_le        timestamptz,
  created_at        timestamptz not null default now()
);
create index if not exists mariage_demandes_prestataire on public.mariage_demandes(prestataire_id, created_at desc);

alter table public.mariage_demandes enable row level security;
drop policy if exists "Le couple lit ses demandes" on public.mariage_demandes;
create policy "Le couple lit ses demandes" on public.mariage_demandes for select using (owner_id = auth.uid());
drop policy if exists "Le prestataire lit les demandes de son espace" on public.mariage_demandes;
create policy "Le prestataire lit les demandes de son espace" on public.mariage_demandes for select using (prestataire_id = public.current_workspace_id());
-- Aucune policy d'écriture : insert / update passent exclusivement par les fonctions ci-dessous.

-- Le couple envoie une demande à un salon / prestataire de l'annuaire (visible_annuaire, opt-in strict).
create or replace function public.mariage_demander(
  p_mariage uuid, p_slug text, p_message text, p_date date, p_nb integer, p_budget numeric,
  p_nom text, p_email text, p_tel text)
returns uuid language plpgsql security definer set search_path = public as $$
declare
  cible uuid; nom_pro text; nouvelle uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if not exists (select 1 from public.mariages where id = p_mariage and owner_id = auth.uid()) then
    raise exception 'Mariage introuvable.';
  end if;
  select pr.owner_id into cible from public.parametres_reservation pr
    where pr.slug = lower(p_slug) and pr.activee and pr.visible_annuaire;
  if cible is null then raise exception 'Ce prestataire n''accepte pas de demandes.'; end if;
  if exists (select 1 from public.mariage_demandes d where d.mariage_id = p_mariage and d.prestataire_id = cible and d.statut in ('envoyee', 'repondue')) then
    raise exception 'Une demande est déjà en cours avec ce prestataire.';
  end if;
  if (select count(*) from public.mariage_demandes d where d.owner_id = auth.uid() and d.created_at > now() - interval '1 day') >= 15 then
    raise exception 'Trop de demandes aujourd''hui, réessayez demain.';
  end if;
  select coalesce(business_name, full_name) into nom_pro from public.profiles where id = cible;
  insert into public.mariage_demandes (mariage_id, owner_id, prestataire_id, prestataire_nom, prestataire_slug, message,
      date_evenement, nb_invites, budget_indicatif, contact_nom, contact_email, contact_telephone)
    values (p_mariage, auth.uid(), cible, nom_pro, lower(p_slug), p_message, p_date, p_nb, p_budget, p_nom, p_email, p_tel)
    returning id into nouvelle;
  return nouvelle;
end $$;

-- Le prestataire répond (devis ou indisponibilité).
create or replace function public.mariage_repondre(p_demande uuid, p_statut text, p_reponse text, p_montant numeric)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_statut not in ('repondue', 'indisponible') then raise exception 'Statut invalide.'; end if;
  update public.mariage_demandes
    set statut = p_statut, reponse = p_reponse, montant_propose = p_montant, repondu_le = now()
    where id = p_demande and prestataire_id = public.current_workspace_id() and statut in ('envoyee', 'repondue');
  if not found then raise exception 'Demande introuvable.'; end if;
end $$;

-- Le couple accepte ou refuse la réponse reçue.
create or replace function public.mariage_decider(p_demande uuid, p_statut text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_statut not in ('acceptee', 'refusee') then raise exception 'Statut invalide.'; end if;
  update public.mariage_demandes set statut = p_statut
    where id = p_demande and owner_id = auth.uid() and statut = 'repondue';
  if not found then raise exception 'Demande introuvable.'; end if;
end $$;

-- 5. RSVP des invités (sans connexion, par jeton) ---------------------------------------------------------------------------
create or replace function public.rsvp_lire(p_token text)
returns jsonb language sql security definer set search_path = public as $$
  select jsonb_build_object('invite', i.nom, 'statut', i.statut, 'nb_personnes', i.nb_personnes, 'regime', i.regime,
                            'titre', m.titre, 'date_mariage', m.date_mariage, 'ville', m.ville)
  from public.mariage_invites i join public.mariages m on m.id = i.mariage_id
  where i.rsvp_token = p_token;
$$;

create or replace function public.rsvp_repondre(p_token text, p_statut text, p_nb integer, p_regime text)
returns void language plpgsql security definer set search_path = public as $$
begin
  if p_statut not in ('oui', 'non') then raise exception 'Réponse invalide.'; end if;
  update public.mariage_invites
    set statut = p_statut, nb_personnes = greatest(1, least(coalesce(p_nb, 1), 10)),
        regime = left(nullif(trim(p_regime), ''), 300), repondu_le = now()
    where rsvp_token = p_token;
  if not found then raise exception 'Invitation introuvable.'; end if;
end $$;
