-- Mirrio — migration v12 : objectif personnel de capitalisation (« laverie »).
-- Reprend le contenu de db/schema-v5-objectif-laverie.sql (jamais appliqué,
-- collision de numérotation avec schema-v5-envoi-document.sql) MAIS fusionne
-- son admin_stats() avec la version actuellement en base (posée par
-- schema-v7-admin-activite-geo.sql : actifs/inactifs + répartition pays) au
-- lieu de l'écraser — un simple copier-coller du v5 original aurait fait
-- disparaître les compteurs d'activité/géo du back-office.

alter table public.admin_config
  add column if not exists objectif_apport_eur numeric not null default 28000,
  add column if not exists objectif_horizon_mois int not null default 12;

create or replace function public.admin_definir_objectif(p_objectif numeric, p_horizon int)
returns void as $$
begin
  if not public.admin_est_admin() then
    raise exception 'Réservé aux administrateurs.' using errcode = 'insufficient_privilege';
  end if;
  if p_objectif is null or p_objectif <= 0 then
    raise exception 'Objectif invalide.' using errcode = 'invalid_parameter_value';
  end if;
  if p_horizon is null or p_horizon < 1 then
    raise exception 'Horizon invalide.' using errcode = 'invalid_parameter_value';
  end if;
  update public.admin_config
    set objectif_apport_eur = p_objectif, objectif_horizon_mois = p_horizon, updated_at = now()
    where id = true;
end;
$$ language plpgsql security definer set search_path = public;

-- admin_stats() : version v7 (actifs/inactifs, pays) + ajout MRR/objectif du v5.
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
  objectif_eur numeric;
  horizon_mois int;
  mrr numeric;
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

  select seuil_alerte_clients, objectif_apport_eur, objectif_horizon_mois
    into seuil, objectif_eur, horizon_mois
    from public.admin_config where id = true;

  mrr := coalesce(total_solo, 0) * 15 + coalesce(total_studio, 0) * 29;

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
    'seuil_alerte', coalesce(seuil, 40),
    'mrr_actuel', mrr,
    'objectif_apport_eur', coalesce(objectif_eur, 28000),
    'objectif_horizon_mois', coalesce(horizon_mois, 12)
  );
end;
$$ language plpgsql security definer set search_path = public;
