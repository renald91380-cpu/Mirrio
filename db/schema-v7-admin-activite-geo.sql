-- Mirrio — migration v7 : statut d'activité (« a arrêté ») et localisation
-- dans le back-office admin.
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Ce que cette migration ajoute :
--   1. `admin_config.seuil_inactivite_jours` — au bout de combien de jours
--      sans connexion un compte est considéré « arrêté » dans le back-office
--      (réglable depuis admin.html, comme le seuil de capacité existant).
--   2. `admin_liste_clients()` réécrite : ajoute la dernière connexion
--      (`auth.users.last_sign_in_at`), un statut calculé actif/inactif, et la
--      localisation déclarée (ville/pays de `parametres_facturation`).
--   3. `admin_stats()` réécrit : ajoute les compteurs actifs/inactifs et la
--      répartition géographique par pays.
--   4. `admin_definir_seuil_inactivite()` — même patron que
--      `admin_definir_seuil()` (schema-v4), pour le seuil d'inactivité.
--
-- Note assumée sur les « abonnements » : Mirrio n'a aucune intégration de
-- paiement (pas de Stripe) — `plan` (solo/studio) est la seule notion de
-- formule qui existe, déjà affichée dans le back-office (pastille + tarif
-- indicatif). Il n'existe donc pas de statut d'abonnement « résilié » au sens
-- strict : le proxy retenu ici pour « une personne qui a arrêté » est
-- l'inactivité de connexion (pas de connexion depuis N jours), affiché
-- explicitement comme tel dans l'UI plutôt que présenté comme une vraie
-- annulation d'abonnement.
--
-- Note assumée sur la « localisation » : aucune géolocalisation IP n'est
-- faite. La ville/le pays affichés sont l'adresse professionnelle que le
-- praticien a lui-même renseignée dans Paramètres → Devis & factures
-- (`parametres_facturation`) — vide tant qu'il ne l'a pas remplie.

alter table public.admin_config
  add column if not exists seuil_inactivite_jours int not null default 60;

-- Le type de retour change (nouvelles colonnes) : il faut DROP avant de
-- recréer, `create or replace function` seul refuse de changer la shape.
drop function if exists public.admin_liste_clients();

create function public.admin_liste_clients()
returns table (
  id uuid,
  full_name text,
  business_name text,
  metier text,
  plan text,
  email text,
  created_at timestamptz,
  derniere_connexion timestamptz,
  statut_activite text,
  ville text,
  pays text,
  nb_clients bigint,
  nb_devis bigint,
  nb_factures bigint,
  ca_encaisse numeric,
  nb_collaborateurs bigint
) as $$
declare
  seuil int;
begin
  if not public.admin_est_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = 'insufficient_privilege';
  end if;

  select seuil_inactivite_jours into seuil from public.admin_config where id = true;
  seuil := coalesce(seuil, 60);

  return query
  select
    p.id,
    p.full_name,
    p.business_name,
    p.metier,
    p.plan,
    u.email,
    p.created_at,
    u.last_sign_in_at as derniere_connexion,
    case
      when u.last_sign_in_at is null then 'inactif'
      when u.last_sign_in_at < now() - (seuil || ' days')::interval then 'inactif'
      else 'actif'
    end as statut_activite,
    nullif(pf.emetteur_ville, '') as ville,
    nullif(pf.emetteur_pays, '') as pays,
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
  left join public.parametres_facturation pf on pf.owner_id = p.id
  where not exists (
    select 1 from public.workspace_members m2
    where m2.user_id = p.id and m2.statut = 'actif' and m2.workspace_id <> p.id
  )
  order by p.created_at desc;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.admin_stats()
returns json as $$
declare
  total_clients bigint;
  total_solo bigint;
  total_studio bigint;
  nouveaux_30j bigint;
  actifs bigint;
  inactifs bigint;
  metier_counts json;
  pays_counts json;
  seuil int;
  seuil_inactivite int;
begin
  if not public.admin_est_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = 'insufficient_privilege';
  end if;

  select seuil_inactivite_jours into seuil_inactivite from public.admin_config where id = true;
  seuil_inactivite := coalesce(seuil_inactivite, 60);

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

  select
    count(*) filter (where u.last_sign_in_at is not null and u.last_sign_in_at >= now() - (seuil_inactivite || ' days')::interval),
    count(*) filter (where u.last_sign_in_at is null or u.last_sign_in_at < now() - (seuil_inactivite || ' days')::interval)
  into actifs, inactifs
  from public.profiles p
  join auth.users u on u.id = p.id
  where not exists (
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

  select coalesce(json_object_agg(t.pays, t.n), '{}'::json) into pays_counts
  from (
    select coalesce(nullif(pf.emetteur_pays, ''), 'Non renseigné') as pays, count(*) n
    from public.profiles p
    left join public.parametres_facturation pf on pf.owner_id = p.id
    where not exists (
      select 1 from public.workspace_members m2
      where m2.user_id = p.id and m2.statut = 'actif' and m2.workspace_id <> p.id
    )
    group by 1
  ) t;

  select seuil_alerte_clients into seuil from public.admin_config where id = true;

  return json_build_object(
    'total_clients', total_clients,
    'total_solo', total_solo,
    'total_studio', total_studio,
    'nouveaux_30j', nouveaux_30j,
    'actifs', actifs,
    'inactifs', inactifs,
    'seuil_inactivite_jours', seuil_inactivite,
    'metiers', metier_counts,
    'pays', pays_counts,
    'seuil_alerte', coalesce(seuil, 40)
  );
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.admin_definir_seuil_inactivite(p_jours int)
returns void as $$
begin
  if not public.admin_est_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = 'insufficient_privilege';
  end if;
  if p_jours is null or p_jours < 1 then
    raise exception 'Seuil invalide.' using errcode = 'invalid_parameter_value';
  end if;
  update public.admin_config set seuil_inactivite_jours = p_jours, updated_at = now() where id = true;
end;
$$ language plpgsql security definer set search_path = public;
