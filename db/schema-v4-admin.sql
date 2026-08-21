-- Cadence — migration v4 : back-office administrateur.
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Ce que cette migration ajoute :
--   1. `profiles.is_admin` — réservé à l'exploitant de Cadence (toi), jamais
--      modifiable par un utilisateur via l'application (verrouillé par trigger).
--   2. `admin_config` — seuil d'alerte de capacité, réglable depuis l'écran admin.
--   3. Fonctions `admin_*()` : agrégats cross-espaces (comptages, répartition
--      par métier, indicateurs par client) — jamais le détail des devis/
--      factures de chacun, qui reste privé à son espace.
--
-- Définition retenue pour « un client » : un espace de travail, pas un compte.
-- Un collaborateur actuellement actif comme collaborateur dans l'espace d'un
-- autre n'est pas compté une deuxième fois — voir la sous-requête répétée
-- `not exists (... workspace_id <> p.id ...)` dans chaque fonction ci-dessous.

-- =====================================================================
-- 1. Rôle admin — colonne verrouillée
-- =====================================================================

alter table public.profiles
  add column if not exists is_admin boolean not null default false;

-- Le reste de l'app peut mettre à jour son propre profil (policy « Un
-- utilisateur modifie son propre profil », sans WITH CHECK) : sans ce
-- verrou, n'importe qui pourrait s'auto-promouvoir admin par un simple
-- update PostgREST. Le trigger réécrit is_admin à sa valeur précédente sauf
-- quand la requête vient du SQL Editor (rôle `postgres`), ce qui laisse
-- cette migration elle-même libre de poser le premier admin plus bas.
create or replace function public.verrouiller_is_admin()
returns trigger as $$
begin
  if current_user not in ('postgres', 'supabase_admin') then
    new.is_admin := old.is_admin;
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists lock_is_admin on public.profiles;
create trigger lock_is_admin
  before update on public.profiles
  for each row execute procedure public.verrouiller_is_admin();

create or replace function public.admin_est_admin()
returns boolean as $$
  select coalesce((select is_admin from public.profiles where id = auth.uid()), false);
$$ language sql stable security definer set search_path = public;

-- =====================================================================
-- 2. Configuration admin — seuil d'alerte de capacité
-- =====================================================================

create table if not exists public.admin_config (
  id boolean primary key default true,
  seuil_alerte_clients int not null default 40,
  updated_at timestamptz default now(),
  constraint admin_config_singleton check (id)
);

insert into public.admin_config (id) values (true)
  on conflict (id) do nothing;

alter table public.admin_config enable row level security;

drop policy if exists "Admin lit la config" on public.admin_config;
create policy "Admin lit la config"
  on public.admin_config for select
  using (public.admin_est_admin());

drop policy if exists "Admin modifie la config" on public.admin_config;
create policy "Admin modifie la config"
  on public.admin_config for update
  using (public.admin_est_admin());

create or replace function public.admin_definir_seuil(p_seuil int)
returns void as $$
begin
  if not public.admin_est_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = 'insufficient_privilege';
  end if;
  if p_seuil is null or p_seuil < 1 then
    raise exception 'Seuil invalide.' using errcode = 'invalid_parameter_value';
  end if;
  update public.admin_config set seuil_alerte_clients = p_seuil, updated_at = now() where id = true;
end;
$$ language plpgsql security definer set search_path = public;

-- =====================================================================
-- 3. Agrégats cross-espaces
-- =====================================================================

create or replace function public.admin_stats()
returns json as $$
declare
  total_clients bigint;
  total_solo bigint;
  total_studio bigint;
  nouveaux_30j bigint;
  metier_counts json;
  seuil int;
begin
  if not public.admin_est_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = 'insufficient_privilege';
  end if;

  select count(*) into total_clients from public.profiles p
    where not exists (
      select 1 from public.workspace_members m2
      where m2.user_id = p.id and m2.statut = 'actif' and m2.workspace_id <> p.id
    );

  select count(*) into total_solo from public.profiles p
    where p.plan = 'solo' and not exists (
      select 1 from public.workspace_members m2
      where m2.user_id = p.id and m2.statut = 'actif' and m2.workspace_id <> p.id
    );

  select count(*) into total_studio from public.profiles p
    where p.plan = 'studio' and not exists (
      select 1 from public.workspace_members m2
      where m2.user_id = p.id and m2.statut = 'actif' and m2.workspace_id <> p.id
    );

  select count(*) into nouveaux_30j from public.profiles p
    where p.created_at >= now() - interval '30 days'
    and not exists (
      select 1 from public.workspace_members m2
      where m2.user_id = p.id and m2.statut = 'actif' and m2.workspace_id <> p.id
    );

  select coalesce(json_object_agg(t.metier, t.n), '{}'::json) into metier_counts
  from (
    select p.metier, count(*) n from public.profiles p
    where not exists (
      select 1 from public.workspace_members m2
      where m2.user_id = p.id and m2.statut = 'actif' and m2.workspace_id <> p.id
    )
    group by p.metier
  ) t;

  select seuil_alerte_clients into seuil from public.admin_config where id = true;

  return json_build_object(
    'total_clients', total_clients,
    'total_solo', total_solo,
    'total_studio', total_studio,
    'nouveaux_30j', nouveaux_30j,
    'metiers', metier_counts,
    'seuil_alerte', coalesce(seuil, 40)
  );
end;
$$ language plpgsql security definer set search_path = public;

-- Une ligne par espace, avec des indicateurs agrégés — jamais le détail
-- d'un devis ou d'une facture individuelle, qui reste privé à cet espace.
create or replace function public.admin_liste_clients()
returns table (
  id uuid,
  full_name text,
  business_name text,
  metier text,
  plan text,
  email text,
  created_at timestamptz,
  nb_clients bigint,
  nb_devis bigint,
  nb_factures bigint,
  ca_encaisse numeric,
  nb_collaborateurs bigint
) as $$
begin
  if not public.admin_est_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = 'insufficient_privilege';
  end if;

  return query
  select
    p.id,
    p.full_name,
    p.business_name,
    p.metier,
    p.plan,
    u.email,
    p.created_at,
    (select count(*) from public.clients c where c.owner_id = p.id) as nb_clients,
    (select count(*) from public.documents d where d.owner_id = p.id and d.type = 'devis') as nb_devis,
    (select count(*) from public.documents d where d.owner_id = p.id and d.type = 'facture') as nb_factures,
    coalesce((
      select sum(dl.total_ligne) from public.documents d
      join public.document_lignes dl on dl.document_id = d.id
      where d.owner_id = p.id and d.type = 'facture' and d.statut = 'paye'
    ), 0) as ca_encaisse,
    (select count(*) from public.workspace_members m where m.workspace_id = p.id and m.statut = 'actif') as nb_collaborateurs
  from public.profiles p
  join auth.users u on u.id = p.id
  where not exists (
    select 1 from public.workspace_members m2
    where m2.user_id = p.id and m2.statut = 'actif' and m2.workspace_id <> p.id
  )
  order by p.created_at desc;
end;
$$ language plpgsql security definer set search_path = public;

-- =====================================================================
-- 4. Premier administrateur
-- =====================================================================
-- Exécuté par le SQL Editor (rôle `postgres`) : le trigger de verrouillage
-- laisse passer cette ligne. Adapter l'email avant de rejouer sur un autre
-- compte, ou repasser explicitement à false pour retirer un accès admin.

update public.profiles set is_admin = true
where id = (select id from auth.users where email = 'renald91380@gmail.com');
