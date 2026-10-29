-- Fiche client technique d'un salon : allergies et contre-indications (sur la fiche client), et un historique de notes de passage avec formule
-- (couleur, produits utilisés, temps de pose…) et photos avant/après. Les photos sont des données personnelles : bucket PRIVÉ `clients-photos`,
-- lisible uniquement par l'espace du salon (dossier = identifiant de l'espace), affiché par liens signés de courte durée, jamais public.
-- Un vendeur (rôle) ne lit ni n'écrit ces notes. Sûr à rejouer en entier. À exécuter après schema-v47-stats-equipe.sql.

alter table public.clients add column if not exists allergies text;
alter table public.clients drop constraint if exists clients_allergies_check;
alter table public.clients add constraint clients_allergies_check check (allergies is null or length(allergies) <= 500);

create table if not exists public.client_notes (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  client_id       uuid not null references public.clients(id) on delete cascade,
  date_note       date not null default current_date,
  titre           text check (titre is null or length(titre) <= 80),
  formule         text check (formule is null or length(formule) <= 400),
  note            text check (note is null or length(note) <= 1000),
  photos          text[] not null default '{}' check (cardinality(photos) <= 6),     -- chemins dans le bucket privé clients-photos
  intervenant_id  uuid,
  created_by      uuid default auth.uid(),
  created_at      timestamptz not null default now()
);
create index if not exists client_notes_client on public.client_notes(client_id, date_note desc);
alter table public.client_notes enable row level security;
drop policy if exists "Fiche technique : l'équipe (hors vendeur) la gère" on public.client_notes;
create policy "Fiche technique : l'équipe (hors vendeur) la gère" on public.client_notes for all
  using (owner_id = public.current_workspace_id() and public.mon_role() is distinct from 'vendeur')
  with check (owner_id = public.current_workspace_id() and public.mon_role() is distinct from 'vendeur');

insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('clients-photos', 'clients-photos', false, 5242880, array['image/jpeg', 'image/png', 'image/webp'])
on conflict (id) do update set public = false, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg', 'image/png', 'image/webp'];

drop policy if exists "Photos clients : lecture par l'espace" on storage.objects;
create policy "Photos clients : lecture par l'espace" on storage.objects for select
  using (bucket_id = 'clients-photos' and (storage.foldername(name))[1] = public.current_workspace_id()::text and public.mon_role() is distinct from 'vendeur');
drop policy if exists "Photos clients : ajout par l'espace" on storage.objects;
create policy "Photos clients : ajout par l'espace" on storage.objects for insert
  with check (bucket_id = 'clients-photos' and (storage.foldername(name))[1] = public.current_workspace_id()::text and public.mon_role() is distinct from 'vendeur');
drop policy if exists "Photos clients : suppression par l'espace" on storage.objects;
create policy "Photos clients : suppression par l'espace" on storage.objects for delete
  using (bucket_id = 'clients-photos' and (storage.foldername(name))[1] = public.current_workspace_id()::text and public.mon_role() is distinct from 'vendeur');
