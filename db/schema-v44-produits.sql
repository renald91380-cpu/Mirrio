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

-- ---------------------------------------------------------------------------------------------------------------- stock
-- Suivi facultatif : un produit dont `stock` est renseigné est suivi (décrémenté à chaque vente en caisse, remis en stock par un avoir, ajustable à la main) ;
-- `stock` vide = non suivi. `stock_min` : seuil d'alerte (la caisse et la liste des produits signalent « stock bas » en dessous ou à ce seuil).
alter table public.produits add column if not exists stock numeric(12,2);
alter table public.produits add column if not exists stock_min numeric(12,2) check (stock_min is null or stock_min >= 0);

create table if not exists public.stock_mouvements (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  produit_id  uuid not null references public.produits(id) on delete cascade,
  delta       numeric(12,2) not null check (delta <> 0),
  motif       text not null check (motif in ('vente', 'avoir', 'reception', 'inventaire', 'perte', 'correction')),
  ticket_id   uuid,
  note        text check (note is null or length(note) <= 120),
  par         uuid,
  created_at  timestamptz not null default now()
);
create index if not exists stock_mouvements_produit on public.stock_mouvements(produit_id, created_at desc);
alter table public.stock_mouvements enable row level security;
drop policy if exists "Stock : lire les mouvements de l'espace" on public.stock_mouvements;
create policy "Stock : lire les mouvements de l'espace" on public.stock_mouvements for select using (owner_id = public.current_workspace_id());
-- Aucune écriture directe : les mouvements passent par la caisse (vente, avoir) ou par stock_ajuster().

create or replace function public.stock_ajuster(p_produit uuid, p_delta numeric, p_motif text, p_note text default null)
returns numeric language plpgsql security definer set search_path = public as $$
declare e uuid := public.current_workspace_id(); nouveau numeric;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if not public.est_manager() then raise exception 'Réservé au responsable du salon.' using errcode = 'insufficient_privilege'; end if;
  if p_motif not in ('reception', 'inventaire', 'perte', 'correction') then raise exception 'Motif inconnu.'; end if;
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'Quantité invalide.'; end if;
  update public.produits set stock = coalesce(stock, 0) + p_delta where id = p_produit and owner_id = e returning stock into nouveau;
  if nouveau is null then raise exception 'Produit introuvable.'; end if;
  insert into public.stock_mouvements (owner_id, produit_id, delta, motif, note, par) values (e, p_produit, p_delta, p_motif, left(p_note, 120), auth.uid());
  return nouveau;
end $$;
revoke all on function public.stock_ajuster(uuid, numeric, text, text) from public, anon;
grant execute on function public.stock_ajuster(uuid, numeric, text, text) to authenticated;
