-- Export comptable et partage en lecture seule avec le comptable.
--
--   1. compta_json(ws, debut, fin) : fabrique le jeu de données (factures émises, lignes, paiements de caisse, clôtures Z) d'un espace pour une
--      période. Fonction INTERNE : l'exécution est retirée à public / anon / authenticated, seules les deux fonctions ci-dessous (security definer)
--      peuvent l'appeler.
--   2. export_comptable(debut, fin) : pour le propriétaire connecté (espace actif).
--   3. partages_comptable + comptable_donnees(token, debut, fin) : lien secret, révocable, à durée limitée, ouvert sans compte (le comptable),
--      en LECTURE SEULE, plafonné à 366 jours par appel. Le jeton fait l'autorisation à lui seul (même principe que calendar_feeds.token,
--      documents.partage_token) : traiter le lien comme un mot de passe.
-- Sûr à rejouer en entier. À exécuter après schema-v39-caisse.sql.

create or replace function public.compta_json(p_ws uuid, p_debut date, p_fin date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare
  res jsonb;
  total int;
begin
  if p_debut is null or p_fin is null or p_fin < p_debut then raise exception 'Période invalide.'; end if;
  if p_fin - p_debut > 366 then raise exception 'La période ne peut pas dépasser 366 jours.'; end if;

  select count(*) into total from public.documents d
    where d.owner_id = p_ws and d.type = 'facture' and d.statut <> 'brouillon' and d.date_emission between p_debut and p_fin;

  select jsonb_build_object(
    'periode', jsonb_build_object('debut', p_debut, 'fin', p_fin),
    'tronque', total > 5000,
    'salon', (select jsonb_build_object('nom', coalesce(nullif(p.business_name, ''), p.full_name, 'Salon'), 'adresse', f.emetteur_adresse,
                'assujetti_tva', coalesce(f.assujetti_tva, false), 'tva_taux_defaut', coalesce(f.tva_taux_defaut, 20))
              from public.profiles p left join public.parametres_facturation f on f.owner_id = p.id where p.id = p_ws),
    'factures', coalesce((
      select jsonb_agg(x order by x->>'date_emission', x->>'numero') from (
        select jsonb_build_object(
          'numero', d.numero, 'date_emission', d.date_emission, 'statut', d.statut, 'client', c.full_name, 'origine_caisse', d.notes = 'Vente en caisse',
          'lignes', coalesce((select jsonb_agg(jsonb_build_object('description', l.description, 'quantite', l.quantite, 'prix_unitaire', l.prix_unitaire, 'tva_taux', l.tva_taux) order by l.position)
                              from public.document_lignes l where l.document_id = d.id), '[]'::jsonb),
          'paiements', coalesce((select jsonb_agg(jsonb_build_object('mode', cp.mode, 'montant', cp.montant, 'date', cp.created_at) order by cp.created_at)
                              from public.caisse_paiements cp where cp.document_id = d.id), '[]'::jsonb)
        ) as x
        from public.documents d left join public.clients c on c.id = d.client_id
        where d.owner_id = p_ws and d.type = 'facture' and d.statut <> 'brouillon' and d.date_emission between p_debut and p_fin
        order by d.date_emission, d.numero limit 5000
      ) q), '[]'::jsonb),
    'clotures', coalesce((
      select jsonb_agg(jsonb_build_object('ouverte_le', s.ouverte_le, 'cloturee_le', s.cloturee_le, 'rapport', s.rapport) order by s.cloturee_le)
      from public.caisse_sessions s
      where s.owner_id = p_ws and s.cloturee_le is not null and s.cloturee_le::date between p_debut and p_fin), '[]'::jsonb)
  ) into res;
  return res;
end $$;
revoke all on function public.compta_json(uuid, date, date) from public, anon, authenticated;

create or replace function public.export_comptable(p_debut date, p_fin date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  return public.compta_json(public.current_workspace_id(), p_debut, p_fin);
end $$;

create table if not exists public.partages_comptable (
  id             uuid primary key default gen_random_uuid(),
  owner_id       uuid not null,
  libelle        text not null check (length(libelle) between 1 and 80),
  token          text not null unique default public.new_feed_token(),
  expire_le      timestamptz not null,
  actif          boolean not null default true,
  cree_par       uuid references auth.users(id) on delete set null default auth.uid(),
  created_at     timestamptz not null default now(),
  dernier_acces  timestamptz,
  nb_acces       integer not null default 0
);
alter table public.partages_comptable enable row level security;
drop policy if exists "Le salon gère ses partages comptable" on public.partages_comptable;
create policy "Le salon gère ses partages comptable" on public.partages_comptable for all
  using (owner_id = public.current_workspace_id()) with check (owner_id = public.current_workspace_id());

create or replace function public.comptable_donnees(p_token text, p_debut date default null, p_fin date default null)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  p public.partages_comptable;
  d1 date := coalesce(p_debut, date_trunc('year', current_date)::date);
  d2 date := coalesce(p_fin, current_date);
  res jsonb;
begin
  select * into p from public.partages_comptable where token = p_token and actif and expire_le > now();
  if not found then return null; end if;
  update public.partages_comptable set dernier_acces = now(), nb_acces = nb_acces + 1 where id = p.id;
  res := public.compta_json(p.owner_id, d1, d2);
  return res || jsonb_build_object('partage', jsonb_build_object('libelle', p.libelle, 'expire_le', p.expire_le));
end $$;
