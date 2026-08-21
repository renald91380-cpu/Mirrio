-- Cadence — migration v5 : objectif personnel de capitalisation (« laverie »).
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Ce que cette migration ajoute :
--   1. Deux colonnes sur `admin_config` : le montant d'apport visé (en euros)
--      et l'horizon (en mois) sur lequel l'atteindre.
--   2. `admin_definir_objectif(...)` — réglable depuis l'écran admin, même
--      pattern que `admin_definir_seuil` pour le seuil de capacité.
--   3. `admin_stats()` étendue pour renvoyer l'objectif courant + le MRR
--      actuel calculé à partir des formules Solo (15€) et Studio (29€).
--
-- Ceci n'a rien à voir avec le produit vu par les clients de Cadence : c'est
-- un suivi purement personnel de l'exploitant, visible uniquement sur
-- site/admin.html (jamais sur dashboard.html).

-- =====================================================================
-- 1. Colonnes objectif sur admin_config
-- =====================================================================

alter table public.admin_config
  add column if not exists objectif_apport_eur numeric not null default 28000,
  add column if not exists objectif_horizon_mois int not null default 12;

-- =====================================================================
-- 2. Fonction de mise à jour de l'objectif
-- =====================================================================

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

-- =====================================================================
-- 3. admin_stats() étendue — MRR actuel + objectif courant
-- =====================================================================
-- Prix des formules en dur (15€ / 29€) : à mettre à jour ici si les tarifs
-- changent un jour. Le MRR est calculé sur le nombre de comptes par formule,
-- pas sur un encaissement Stripe réel (pas encore branché).

create or replace function public.admin_stats()
returns json as $$
declare
  total_clients bigint;
  total_solo bigint;
  total_studio bigint;
  nouveaux_30j bigint;
  metier_counts json;
  seuil int;
  objectif_eur numeric;
  horizon_mois int;
  mrr numeric;
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

  select seuil_alerte_clients, objectif_apport_eur, objectif_horizon_mois
    into seuil, objectif_eur, horizon_mois
    from public.admin_config where id = true;

  mrr := coalesce(total_solo, 0) * 15 + coalesce(total_studio, 0) * 29;

  return json_build_object(
    'total_clients', total_clients,
    'total_solo', total_solo,
    'total_studio', total_studio,
    'nouveaux_30j', nouveaux_30j,
    'metiers', metier_counts,
    'seuil_alerte', coalesce(seuil, 40),
    'mrr_actuel', mrr,
    'objectif_apport_eur', coalesce(objectif_eur, 28000),
    'objectif_horizon_mois', coalesce(horizon_mois, 12)
  );
end;
$$ language plpgsql security definer set search_path = public;
