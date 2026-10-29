-- Catalogue de produits d'un salon (shampoings, soins, huiles à barbe…) vendus en caisse, avec leurs tarifs.
-- Un produit est propre à un espace (un salon) et se vend comme une prestation : prix HT + taux de TVA par produit, affiché TTC en caisse.
-- Sûr à rejouer en entier. À exécuter après schema-v43-caisse-certifiable.sql.

create table if not exists public.produits (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null,
  nom           text not null check (length(btrim(nom)) between 1 and 80),
  marque        text check (marque is null or length(marque) <= 60),
  categorie     text check (categorie is null or length(categorie) <= 40),
  reference     text check (reference is null or length(reference) <= 40),     -- code article ou code-barres, libre
  prix_unitaire numeric(12,4) not null check (prix_unitaire >= 0 and prix_unitaire <= 100000),   -- HT ; quatre décimales pour retomber sur un prix TTC rond
  tva_taux      numeric not null default 0 check (tva_taux >= 0 and tva_taux <= 30),
  remise_pct    numeric check (remise_pct is null or (remise_pct > 0 and remise_pct <= 90)),   -- remise que le salon PEUT accorder (jamais appliquée seule)
  actif         boolean not null default true,
  position      int not null default 0,
  created_at    timestamptz not null default now()
);
alter table public.produits add column if not exists remise_pct numeric;
alter table public.produits drop constraint if exists produits_remise_pct_check;
alter table public.produits add constraint produits_remise_pct_check check (remise_pct is null or (remise_pct > 0 and remise_pct <= 90));
create index if not exists produits_owner on public.produits(owner_id, position);
alter table public.produits enable row level security;
drop policy if exists "Produits : l'espace gère son catalogue" on public.produits;
create policy "Produits : l'espace gère son catalogue" on public.produits for all
  using (owner_id = public.current_workspace_id()) with check (owner_id = public.current_workspace_id());
