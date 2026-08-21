-- Cadence — schéma de base pour l'authentification.
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.

-- Table de profil, liée 1-1 à chaque utilisateur Supabase Auth.
create table if not exists public.profiles (
  id uuid references auth.users on delete cascade primary key,
  full_name text,
  plan text check (plan in ('solo', 'studio')) default 'solo',
  created_at timestamptz default now()
);

alter table public.profiles enable row level security;

create policy "Un utilisateur voit son propre profil"
  on public.profiles for select
  using (auth.uid() = id);

create policy "Un utilisateur modifie son propre profil"
  on public.profiles for update
  using (auth.uid() = id);

-- Crée automatiquement une ligne de profil à chaque inscription,
-- en reprenant le nom et la formule choisis dans le formulaire d'inscription.
create or replace function public.handle_new_user()
returns trigger as $$
begin
  insert into public.profiles (id, full_name, plan)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    coalesce(new.raw_user_meta_data->>'plan', 'solo')
  );
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists on_auth_user_created on auth.users;
create trigger on_auth_user_created
  after insert on auth.users
  for each row execute procedure public.handle_new_user();

-- Fiches clients.
create table if not exists public.clients (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  full_name text not null,
  email text,
  phone text,
  company text,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.clients enable row level security;

create policy "Un utilisateur voit ses propres clients"
  on public.clients for select
  using (auth.uid() = owner_id);

create policy "Un utilisateur crée ses propres clients"
  on public.clients for insert
  with check (auth.uid() = owner_id);

create policy "Un utilisateur modifie ses propres clients"
  on public.clients for update
  using (auth.uid() = owner_id);

create policy "Un utilisateur supprime ses propres clients"
  on public.clients for delete
  using (auth.uid() = owner_id);

create or replace function public.set_updated_at()
returns trigger as $$
begin
  new.updated_at = now();
  return new;
end;
$$ language plpgsql;

drop trigger if exists set_clients_updated_at on public.clients;
create trigger set_clients_updated_at
  before update on public.clients
  for each row execute procedure public.set_updated_at();

-- Agenda. recurring_group_id regroupe les occurrences d'un même rendez-vous
-- récurrent (générées à la création, une ligne par séance) pour permettre
-- une suppression ou une lecture groupée sans logique de calcul de dates.
create table if not exists public.rendez_vous (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  client_id uuid references public.clients on delete set null,
  titre text not null,
  date_debut timestamptz not null,
  date_fin timestamptz not null,
  statut text check (statut in ('confirme', 'annule')) default 'confirme',
  recurring_group_id uuid,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

alter table public.rendez_vous enable row level security;

create policy "Un utilisateur voit ses propres rendez-vous"
  on public.rendez_vous for select
  using (auth.uid() = owner_id);

create policy "Un utilisateur crée ses propres rendez-vous"
  on public.rendez_vous for insert
  with check (auth.uid() = owner_id);

create policy "Un utilisateur modifie ses propres rendez-vous"
  on public.rendez_vous for update
  using (auth.uid() = owner_id);

create policy "Un utilisateur supprime ses propres rendez-vous"
  on public.rendez_vous for delete
  using (auth.uid() = owner_id);

drop trigger if exists set_rendez_vous_updated_at on public.rendez_vous;
create trigger set_rendez_vous_updated_at
  before update on public.rendez_vous
  for each row execute procedure public.set_updated_at();

create index if not exists rendez_vous_owner_date_idx
  on public.rendez_vous (owner_id, date_debut);

-- Devis & factures. Un même modèle sert aux deux (type='devis'|'facture') :
-- un devis accepté se convertit en facture en dupliquant la ligne avec
-- converted_from pointant vers le devis d'origine.
create table if not exists public.documents (
  id uuid primary key default gen_random_uuid(),
  owner_id uuid not null default auth.uid() references auth.users on delete cascade,
  client_id uuid references public.clients on delete set null,
  type text not null check (type in ('devis', 'facture')),
  numero text,
  statut text not null check (statut in ('brouillon', 'envoye', 'accepte', 'paye', 'en_retard', 'refuse')) default 'brouillon',
  date_emission date not null default current_date,
  date_echeance date,
  converted_from uuid references public.documents on delete set null,
  notes text,
  created_at timestamptz default now(),
  updated_at timestamptz default now()
);

create table if not exists public.document_lignes (
  id uuid primary key default gen_random_uuid(),
  document_id uuid not null references public.documents on delete cascade,
  description text not null,
  quantite numeric not null default 1,
  prix_unitaire numeric not null default 0,
  position int not null default 0,
  total_ligne numeric generated always as (quantite * prix_unitaire) stored
);

-- Compteurs de numérotation séquentielle, par utilisateur / type / année
-- (ex. DEV-2026-001, FAC-2026-001), pour une numérotation légale propre.
create table if not exists public.document_counters (
  owner_id uuid not null references auth.users on delete cascade,
  type text not null check (type in ('devis', 'facture')),
  year int not null,
  last_number int not null default 0,
  primary key (owner_id, type, year)
);

alter table public.documents enable row level security;
alter table public.document_lignes enable row level security;
alter table public.document_counters enable row level security;

create policy "Un utilisateur voit ses propres documents"
  on public.documents for select
  using (auth.uid() = owner_id);

create policy "Un utilisateur crée ses propres documents"
  on public.documents for insert
  with check (auth.uid() = owner_id);

create policy "Un utilisateur modifie ses propres documents"
  on public.documents for update
  using (auth.uid() = owner_id);

create policy "Un utilisateur supprime ses propres documents"
  on public.documents for delete
  using (auth.uid() = owner_id);

create policy "Un utilisateur voit les lignes de ses documents"
  on public.document_lignes for select
  using (exists (select 1 from public.documents d where d.id = document_lignes.document_id and d.owner_id = auth.uid()));

create policy "Un utilisateur crée des lignes sur ses documents"
  on public.document_lignes for insert
  with check (exists (select 1 from public.documents d where d.id = document_lignes.document_id and d.owner_id = auth.uid()));

create policy "Un utilisateur modifie les lignes de ses documents"
  on public.document_lignes for update
  using (exists (select 1 from public.documents d where d.id = document_lignes.document_id and d.owner_id = auth.uid()));

create policy "Un utilisateur supprime les lignes de ses documents"
  on public.document_lignes for delete
  using (exists (select 1 from public.documents d where d.id = document_lignes.document_id and d.owner_id = auth.uid()));

create policy "Un utilisateur voit ses propres compteurs"
  on public.document_counters for select
  using (auth.uid() = owner_id);

-- Attribue automatiquement un numéro séquentiel (DEV-2026-001…) à la création,
-- sauf s'il est déjà fourni.
create or replace function public.generate_document_number()
returns trigger as $$
declare
  yr int := extract(year from coalesce(new.date_emission, current_date));
  prefix text := case new.type when 'devis' then 'DEV' else 'FAC' end;
  next_num int;
begin
  if new.numero is not null then
    return new;
  end if;

  insert into public.document_counters (owner_id, type, year, last_number)
  values (new.owner_id, new.type, yr, 1)
  on conflict (owner_id, type, year)
  do update set last_number = document_counters.last_number + 1
  returning last_number into next_num;

  new.numero := prefix || '-' || yr || '-' || lpad(next_num::text, 3, '0');
  return new;
end;
$$ language plpgsql security definer set search_path = public;

drop trigger if exists set_document_number on public.documents;
create trigger set_document_number
  before insert on public.documents
  for each row execute procedure public.generate_document_number();

drop trigger if exists set_documents_updated_at on public.documents;
create trigger set_documents_updated_at
  before update on public.documents
  for each row execute procedure public.set_updated_at();

create index if not exists documents_owner_date_idx
  on public.documents (owner_id, date_emission desc);
create index if not exists document_lignes_document_idx
  on public.document_lignes (document_id);
