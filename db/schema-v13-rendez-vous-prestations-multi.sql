-- Cadence — migration v13 : plusieurs prestations sur un même rendez-vous.
-- Nécessaire pour que la réservation en ligne (site/reservation.html) laisse
-- un client choisir plusieurs prestations d'un coup (ex. Coupe + Couleur) et
-- que la durée totale (donc les créneaux proposés) et le prix total en
-- tiennent compte.
--
-- `rendez_vous.prestation_id` (colonne existante, singulière) N'EST PAS
-- supprimée : elle continue de porter la PREMIÈRE prestation choisie, pour
-- rétrocompatibilité avec tout le code qui la lit encore telle quelle
-- (site/agenda.html — sélecteur/affichage d'une seule prestation par
-- rendez-vous saisi à la main, dashboard, back-office). La table ci-dessous
-- porte la liste complète ; le code qui a besoin du total (créneaux,
-- montant à payer, lignes de la facture générée) la lit en priorité et ne
-- retombe sur la colonne singulière que pour un rendez-vous plus ancien qui
-- n'a jamais eu de ligne ici.

create table if not exists public.rendez_vous_prestations (
  id uuid primary key default gen_random_uuid(),
  rendez_vous_id uuid not null references public.rendez_vous(id) on delete cascade,
  prestation_id uuid not null references public.prestations(id) on delete restrict,
  position int not null default 0,
  created_at timestamptz not null default now()
);

create index if not exists rendez_vous_prestations_rdv_idx
  on public.rendez_vous_prestations (rendez_vous_id);

alter table public.rendez_vous_prestations enable row level security;

drop policy if exists "Un utilisateur voit les prestations des rendez-vous de son espace" on public.rendez_vous_prestations;
create policy "Un utilisateur voit les prestations des rendez-vous de son espace"
  on public.rendez_vous_prestations for select using (
    exists (select 1 from public.rendez_vous rv where rv.id = rendez_vous_id and rv.owner_id = public.current_workspace_id())
  );

drop policy if exists "Un utilisateur ajoute des prestations aux rendez-vous de son espace" on public.rendez_vous_prestations;
create policy "Un utilisateur ajoute des prestations aux rendez-vous de son espace"
  on public.rendez_vous_prestations for insert with check (
    exists (select 1 from public.rendez_vous rv where rv.id = rendez_vous_id and rv.owner_id = public.current_workspace_id())
  );

drop policy if exists "Un utilisateur retire des prestations des rendez-vous de son espace" on public.rendez_vous_prestations;
create policy "Un utilisateur retire des prestations des rendez-vous de son espace"
  on public.rendez_vous_prestations for delete using (
    exists (select 1 from public.rendez_vous rv where rv.id = rendez_vous_id and rv.owner_id = public.current_workspace_id())
  );

-- Pas de policy publique : comme rendez_vous lui-même, les deux routes
-- api/reservation-*.js écrivent avec la clé service_role.
