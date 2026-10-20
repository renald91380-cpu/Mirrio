-- Mirrio - migration v25 : fiches « non revendiquées » (salons pas encore sur Mirrio) et suivi de prospection. Idempotent.
--
-- Données publiques d'établissements (OpenStreetMap, ou base Sirene) importées par scripts/importer-fiches.mjs, pour que l'annuaire
-- montre aussi les salons qui ne sont pas encore inscrits. Un client peut « prévenir » un salon, un salon peut revendiquer sa fiche.
-- Rien n'est jamais réservable tant que le salon n'a pas créé son compte.
--
-- Accès : AUCUNE policy publique. Lecture publique via api/_annuaire.js (service_role) qui ne renvoie que des champs publics ;
-- lecture et suivi de prospection réservés à l'admin (policies admin_est_admin()).

create table if not exists public.fiches_externes (
  id uuid primary key default gen_random_uuid(),
  source text not null check (source in ('osm', 'sirene', 'manuel')),
  source_id text not null,
  nom text not null check (char_length(nom) between 1 and 120),
  metier text not null default 'coiffure' check (metier in ('coiffure','barbier','esthetique','onglerie','massage','therapeute','autre')),
  adresse text, code_postal text, ville text, departement text,
  latitude double precision, longitude double precision,
  site_web text, instagram text,
  statut text not null default 'non_revendiquee' check (statut in ('non_revendiquee','en_cours','revendiquee','retiree')),
  revendiquee_email text, revendiquee_le timestamptz,
  -- suivi de prospection (admin)
  contact_statut text not null default 'a_contacter' check (contact_statut in ('a_contacter','contacte','a_repondu','inscrit','refus')),
  contact_note text, contacte_le timestamptz,
  created_at timestamptz not null default now(),
  unique (source, source_id)
);
create index if not exists fiches_externes_ville_idx on public.fiches_externes (lower(ville));
create index if not exists fiches_externes_statut_idx on public.fiches_externes (statut);

-- « Prévenir ce salon » : une demande par visiteur et par fiche (empreinte anonyme, pas d'adresse IP en clair).
create table if not exists public.fiches_demandes (
  fiche_id uuid not null references public.fiches_externes on delete cascade,
  empreinte text not null,
  created_at timestamptz not null default now(),
  primary key (fiche_id, empreinte)
);

alter table public.fiches_externes enable row level security;
alter table public.fiches_demandes enable row level security;

drop policy if exists "Admin voit les fiches externes" on public.fiches_externes;
create policy "Admin voit les fiches externes" on public.fiches_externes for select using (public.admin_est_admin());
drop policy if exists "Admin modifie les fiches externes" on public.fiches_externes;
create policy "Admin modifie les fiches externes" on public.fiches_externes for update using (public.admin_est_admin()) with check (public.admin_est_admin());
drop policy if exists "Admin voit les demandes" on public.fiches_demandes;
create policy "Admin voit les demandes" on public.fiches_demandes for select using (public.admin_est_admin());

-- Nombre de demandes par fiche (pour l'écran de prospection).
create or replace view public.fiches_externes_demandes with (security_invoker = true) as
  select f.*, (select count(*) from public.fiches_demandes d where d.fiche_id = f.id) as nb_demandes
  from public.fiches_externes f;
