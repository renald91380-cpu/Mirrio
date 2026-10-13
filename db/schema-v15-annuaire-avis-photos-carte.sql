-- Cadence — migration v15 : annuaire enrichi (photos, localisation, avis vérifiés).
-- À exécuter après schema-v14-annuaire.sql. Idempotent.
--
--   1. `parametres_reservation` : photos (≤ 6 URL), adresse publique, latitude/longitude.
--   2. `rendez_vous.avis_token` : jeton-capacité envoyé au client pour déposer un avis.
--      Un avis est donc toujours lié à un vrai rendez-vous passé (pas d'avis anonyme).
--   3. `avis` : un avis par rendez-vous, masquable par le praticien, jamais supprimable
--      par lui (il ne peut pas effacer un avis qui lui déplaît, seulement le signaler
--      « masqué » — voir CLAUDE.md §3.15).

alter table public.parametres_reservation
  add column if not exists photos text[] not null default '{}',
  add column if not exists adresse_annuaire text,
  add column if not exists latitude double precision,
  add column if not exists longitude double precision;

alter table public.parametres_reservation drop constraint if exists parametres_reservation_photos_check;
alter table public.parametres_reservation add constraint parametres_reservation_photos_check
  check (coalesce(array_length(photos, 1), 0) <= 6);

alter table public.parametres_reservation drop constraint if exists parametres_reservation_geo_check;
alter table public.parametres_reservation add constraint parametres_reservation_geo_check
  check ((latitude is null and longitude is null)
      or (latitude between -90 and 90 and longitude between -180 and 180));

alter table public.rendez_vous
  add column if not exists avis_token text unique default public.new_feed_token();
-- Rattrapage des rendez-vous existants (le défaut ne s'applique pas aux lignes déjà là).
update public.rendez_vous set avis_token = public.new_feed_token() where avis_token is null;

create table if not exists public.avis (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,   -- l'espace du praticien
  rendez_vous_id uuid not null unique references public.rendez_vous on delete cascade,
  note int not null check (note between 1 and 5),
  commentaire text check (commentaire is null or char_length(commentaire) <= 800),
  auteur text check (auteur is null or char_length(auteur) <= 60),
  masque boolean not null default false,
  created_at timestamptz default now()
);
create index if not exists avis_owner_idx on public.avis (owner_id, created_at desc);

alter table public.avis enable row level security;

drop policy if exists "Un utilisateur voit les avis de son espace" on public.avis;
create policy "Un utilisateur voit les avis de son espace"
  on public.avis for select using (owner_id = public.current_workspace_id());

-- Le praticien peut seulement masquer/démasquer : l'insertion passe par
-- api/avis.js (service_role), et aucune policy de delete n'existe.
drop policy if exists "Un utilisateur masque les avis de son espace" on public.avis;
create policy "Un utilisateur masque les avis de son espace"
  on public.avis for update using (owner_id = public.current_workspace_id())
  with check (owner_id = public.current_workspace_id());

-- Verrou : seule la colonne `masque` est modifiable côté praticien.
create or replace function public.avis_lock_colonnes() returns trigger as $$
begin
  if current_user in ('postgres', 'supabase_admin', 'service_role') then return new; end if;
  new.owner_id := old.owner_id; new.rendez_vous_id := old.rendez_vous_id;
  new.note := old.note; new.commentaire := old.commentaire;
  new.auteur := old.auteur; new.created_at := old.created_at;
  return new;
end; $$ language plpgsql;
drop trigger if exists avis_lock_colonnes on public.avis;
create trigger avis_lock_colonnes before update on public.avis
  for each row execute function public.avis_lock_colonnes();
