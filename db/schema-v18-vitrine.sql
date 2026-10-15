-- Mirrio — migration v18 : vitrine publique personnalisable ("Ma page") + photos.
-- À exécuter une fois dans Supabase (SQL Editor). Idempotent.
--
--   1. `vitrine`        — réglages de la page publique de chaque praticien/salon
--                         (accroche, à propos, couverture, galerie, style, sections,
--                         réseaux, bandeau d'annonce). Une ligne par espace.
--   2. `vitrine_equipe` — membres présentés sur la page (nom, rôle, photo).
--   3. Bucket de stockage public `vitrines` : lecture publique, écriture réservée
--      au dossier de son propre espace (`<workspace_id>/…`), JPEG/PNG/WebP ≤ 5 Mo.
--
-- La page est servie par api/_vitrine.js (lecture avec service_role) et n'est
-- visible que si la réservation en ligne est activée avec un identifiant public.

create table if not exists public.vitrine (
  owner_id uuid primary key references auth.users on delete cascade,
  accroche text,
  a_propos text,
  cover_url text,
  galerie text[] not null default '{}',
  mise_en_page text not null default 'classique',
  police text not null default 'moderne',
  couleur text,
  fond text not null default 'clair',
  boutons text not null default 'arrondi',
  texte_bouton text,
  bandeau_actif boolean not null default false,
  bandeau_texte text,
  sections jsonb not null default '{"a_propos":true,"prestations":true,"galerie":true,"equipe":true,"avis":true,"horaires":true,"carte":true}',
  ordre text[] not null default array['a_propos','prestations','galerie','equipe','horaires','carte','avis'],
  instagram text, facebook text, tiktok text, site_web text,
  telephone_public text, email_public text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.vitrine drop constraint if exists vitrine_valeurs_check;
alter table public.vitrine add constraint vitrine_valeurs_check check (
  (accroche is null or char_length(accroche) <= 120)
  and (a_propos is null or char_length(a_propos) <= 2000)
  and coalesce(array_length(galerie, 1), 0) <= 12
  and mise_en_page in ('classique','immersif','minimal')
  and police in ('elegante','moderne','douce','editoriale')
  and (couleur is null or couleur ~ '^#[0-9a-fA-F]{6}$')
  and fond in ('clair','creme','sombre')
  and boutons in ('arrondi','carre','pilule')
  and (texte_bouton is null or char_length(texte_bouton) <= 40)
  and (bandeau_texte is null or char_length(bandeau_texte) <= 160)
  and (instagram is null or char_length(instagram) <= 200)
  and (facebook is null or char_length(facebook) <= 200)
  and (tiktok is null or char_length(tiktok) <= 200)
  and (site_web is null or char_length(site_web) <= 200)
  and (telephone_public is null or char_length(telephone_public) <= 30)
  and (email_public is null or char_length(email_public) <= 120)
);

create table if not exists public.vitrine_equipe (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null references auth.users on delete cascade,
  nom text not null check (char_length(nom) between 1 and 60),
  role text check (role is null or char_length(role) <= 60),
  bio text check (bio is null or char_length(bio) <= 200),
  photo_url text,
  position int not null default 0,
  created_at timestamptz default now()
);
create index if not exists vitrine_equipe_owner_idx on public.vitrine_equipe (owner_id, position);

alter table public.vitrine enable row level security;
alter table public.vitrine_equipe enable row level security;

drop policy if exists "Voir la vitrine de son espace" on public.vitrine;
create policy "Voir la vitrine de son espace" on public.vitrine for select using (owner_id = public.current_workspace_id());
drop policy if exists "Créer la vitrine de son espace" on public.vitrine;
create policy "Créer la vitrine de son espace" on public.vitrine for insert with check (owner_id = public.current_workspace_id());
drop policy if exists "Modifier la vitrine de son espace" on public.vitrine;
create policy "Modifier la vitrine de son espace" on public.vitrine for update
  using (owner_id = public.current_workspace_id()) with check (owner_id = public.current_workspace_id());

drop policy if exists "Voir l'équipe affichée de son espace" on public.vitrine_equipe;
create policy "Voir l'équipe affichée de son espace" on public.vitrine_equipe for select using (owner_id = public.current_workspace_id());
drop policy if exists "Créer un membre affiché" on public.vitrine_equipe;
create policy "Créer un membre affiché" on public.vitrine_equipe for insert with check (owner_id = public.current_workspace_id());
drop policy if exists "Modifier un membre affiché" on public.vitrine_equipe;
create policy "Modifier un membre affiché" on public.vitrine_equipe for update
  using (owner_id = public.current_workspace_id()) with check (owner_id = public.current_workspace_id());
drop policy if exists "Supprimer un membre affiché" on public.vitrine_equipe;
create policy "Supprimer un membre affiché" on public.vitrine_equipe for delete using (owner_id = public.current_workspace_id());

-- ---------------------------------------------------------------- stockage
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('vitrines', 'vitrines', true, 5242880, array['image/jpeg','image/png','image/webp'])
on conflict (id) do update
  set public = true, file_size_limit = 5242880, allowed_mime_types = array['image/jpeg','image/png','image/webp'];

-- Lecture : le bucket est public (URL directe). Écriture : uniquement dans
-- le dossier nommé d'après l'espace actif de l'utilisateur.
drop policy if exists "vitrines : ajout dans son dossier" on storage.objects;
create policy "vitrines : ajout dans son dossier" on storage.objects for insert to authenticated
  with check (bucket_id = 'vitrines' and (storage.foldername(name))[1] = public.current_workspace_id()::text);
drop policy if exists "vitrines : modification dans son dossier" on storage.objects;
create policy "vitrines : modification dans son dossier" on storage.objects for update to authenticated
  using (bucket_id = 'vitrines' and (storage.foldername(name))[1] = public.current_workspace_id()::text);
drop policy if exists "vitrines : suppression dans son dossier" on storage.objects;
create policy "vitrines : suppression dans son dossier" on storage.objects for delete to authenticated
  using (bucket_id = 'vitrines' and (storage.foldername(name))[1] = public.current_workspace_id()::text);
