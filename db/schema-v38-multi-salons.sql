-- Plusieurs salons par propriétaire, gérés individuellement et vus ensemble.
--
-- Principe : un salon reste un ESPACE (workspace) complet, c'est-à-dire un profil `profiles` : il garde sa propre page de réservation, son
-- catalogue, son équipe, ses clients, ses devis, son compte de paiement. Ajouter un salon crée donc un compte « technique » (sans mot de passe
-- connu, connexion directe bloquée, créé par api/_salons.js) dont le propriétaire du groupe devient GESTIONNAIRE via `salon_gestionnaires`.
-- Le gestionnaire bascule d'un salon à l'autre avec basculer_espace() ; toutes les policies RLS existantes, qui reposent sur
-- current_workspace_id(), fonctionnent donc sans être réécrites.
--
-- Sûr à rejouer en entier. À exécuter après schema-v37-mariage.sql.

alter table public.profiles add column if not exists compte_technique boolean not null default false;
alter table public.profiles add column if not exists cree_par uuid references auth.users(id) on delete set null;

create table if not exists public.salon_gestionnaires (
  salon_id   uuid not null references public.profiles(id) on delete cascade,
  user_id    uuid not null references auth.users(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (salon_id, user_id)
);
alter table public.salon_gestionnaires enable row level security;
drop policy if exists "Voir ses propres salons" on public.salon_gestionnaires;
create policy "Voir ses propres salons" on public.salon_gestionnaires for select using (user_id = auth.uid());
-- Aucune policy d'écriture : seule api/_salons.js (clé service_role) crée ou retire un gestionnaire.

create or replace function public.est_gestionnaire(p_salon uuid)
returns boolean language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.salon_gestionnaires where salon_id = p_salon and user_id = auth.uid());
$$;

-- Espace actif : un collaborateur actif OU un gestionnaire peut y travailler (revalidé à chaque appel, comme avant).
create or replace function public.current_workspace_id()
returns uuid as $$
declare
  souhaite uuid;
begin
  select espace_actif_id into souhaite from public.profiles where id = auth.uid();
  if souhaite is not null and (
    exists (select 1 from public.workspace_members m where m.workspace_id = souhaite and m.user_id = auth.uid() and m.statut = 'actif')
    or exists (select 1 from public.salon_gestionnaires g where g.salon_id = souhaite and g.user_id = auth.uid())
  ) then
    return souhaite;
  end if;
  return auth.uid();
end;
$$ language plpgsql stable security definer set search_path = public;

create or replace function public.basculer_espace(p_espace_id uuid)
returns void as $$
begin
  if p_espace_id is null or p_espace_id = auth.uid() then
    update public.profiles set espace_actif_id = null where id = auth.uid();
    return;
  end if;
  if not exists (select 1 from public.workspace_members where workspace_id = p_espace_id and user_id = auth.uid() and statut = 'actif')
     and not exists (select 1 from public.salon_gestionnaires where salon_id = p_espace_id and user_id = auth.uid()) then
    raise exception 'Vous n''êtes plus membre de cet espace.' using errcode = 'insufficient_privilege';
  end if;
  update public.profiles set espace_actif_id = p_espace_id where id = auth.uid();
end;
$$ language plpgsql security definer set search_path = public;

-- Profil du salon : le gestionnaire le lit et le modifie (identité, métier, apparence), comme le propriétaire d'un salon ordinaire.
-- is_admin reste protégé par le trigger lock_is_admin (schema-v4).
drop policy if exists "Un gestionnaire voit son salon" on public.profiles;
create policy "Un gestionnaire voit son salon" on public.profiles for select using (public.est_gestionnaire(id));
drop policy if exists "Un gestionnaire modifie son salon" on public.profiles;
create policy "Un gestionnaire modifie son salon" on public.profiles for update using (public.est_gestionnaire(id)) with check (public.est_gestionnaire(id));
drop policy if exists "Un gestionnaire crée la ligne de son salon" on public.profiles;
create policy "Un gestionnaire crée la ligne de son salon" on public.profiles for insert with check (public.est_gestionnaire(id));

-- Équipe d'un salon : le gestionnaire invite et révoque comme le propriétaire (formule Studio du SALON, pas du gestionnaire).
drop policy if exists "Le propriétaire gère les membres" on public.workspace_members;
create policy "Le propriétaire gère les membres" on public.workspace_members for all
  using (auth.uid() = workspace_id or public.est_gestionnaire(workspace_id))
  with check (auth.uid() = workspace_id or public.est_gestionnaire(workspace_id));

create or replace function public.inviter_collaborateur(p_email text)
returns public.workspace_members as $$
declare
  ws uuid := public.current_workspace_id();
  mon_plan text;
  ligne public.workspace_members;
begin
  if ws <> auth.uid() and not public.est_gestionnaire(ws) then
    raise exception 'Seul le propriétaire ou le gestionnaire du salon peut inviter.' using errcode = 'insufficient_privilege';
  end if;
  select plan into mon_plan from public.profiles where id = ws;
  if mon_plan is distinct from 'studio' then
    raise exception 'Le partage multi-collaborateurs est réservé à la formule Studio.' using errcode = 'insufficient_privilege';
  end if;
  if p_email is null or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Adresse email invalide.' using errcode = 'invalid_parameter_value';
  end if;
  insert into public.workspace_members (workspace_id, email, role, statut, invite_token)
  values (ws, lower(trim(p_email)), 'collaborateur', 'invite', public.new_feed_token())
  returning * into ligne;
  return ligne;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.revoquer_collaborateur(p_membre_id uuid)
returns void as $$
declare
  ws uuid := public.current_workspace_id();
  cible uuid;
begin
  if ws <> auth.uid() and not public.est_gestionnaire(ws) then
    raise exception 'Membre introuvable dans votre espace.' using errcode = 'no_data_found';
  end if;
  update public.workspace_members set statut = 'revoque', revoked_at = now()
    where id = p_membre_id and workspace_id = ws
    returning user_id into cible;
  if not found then
    raise exception 'Membre introuvable dans votre espace.' using errcode = 'no_data_found';
  end if;
  if cible is not null then
    update public.profiles set espace_actif_id = null where id = cible and espace_actif_id = ws;
  end if;
end;
$$ language plpgsql security definer set search_path = public;

-- Mes salons : le mien, plus ceux que je gère.
create or replace function public.mes_salons()
returns table (id uuid, nom text, metier text, ville text, plan text, principal boolean, actif boolean)
language sql stable security definer set search_path = public as $$
  select p.id, coalesce(nullif(p.business_name, ''), p.full_name, 'Salon'), p.metier, f.emetteur_ville, p.plan,
         (p.id = auth.uid()), (p.id = public.current_workspace_id())
  from public.profiles p
  left join public.parametres_facturation f on f.owner_id = p.id
  where p.id = auth.uid() or exists (select 1 from public.salon_gestionnaires g where g.salon_id = p.id and g.user_id = auth.uid())
  order by (p.id = auth.uid()) desc, 2;
$$;

-- Vue centralisée : chiffres du mois et de la semaine de chaque salon. CA = lignes HT des factures payées émises ce mois-ci.
create or replace function public.groupe_stats()
returns table (salon_id uuid, nom text, nb_clients bigint, rdv_mois bigint, rdv_7j bigint, ca_mois numeric, nb_equipe bigint)
language sql stable security definer set search_path = public as $$
  select s.id, s.nom,
    (select count(*) from public.clients c where c.owner_id = s.id),
    (select count(*) from public.rendez_vous r where r.owner_id = s.id and coalesce(r.statut, 'confirme') = 'confirme'
        and r.date_debut >= date_trunc('month', now()) and r.date_debut < date_trunc('month', now()) + interval '1 month'),
    (select count(*) from public.rendez_vous r where r.owner_id = s.id and coalesce(r.statut, 'confirme') = 'confirme'
        and r.date_debut >= now() and r.date_debut < now() + interval '7 days'),
    (select coalesce(sum(l.total_ligne), 0) from public.documents d join public.document_lignes l on l.document_id = d.id
        where d.owner_id = s.id and d.type = 'facture' and d.statut = 'paye' and d.date_emission >= date_trunc('month', current_date)),
    (select count(*) from public.workspace_members m where m.workspace_id = s.id and m.statut = 'actif')
  from public.mes_salons() s
  order by s.principal desc, s.nom;
$$;
