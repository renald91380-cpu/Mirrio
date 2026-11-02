-- Mirrio — interrupteurs de fonctions modifiables depuis le back-office (admin.html, carte « Fonctionnalités »).
-- À exécuter après schema-v52. Lecture publique (les pages et le plan du site doivent savoir quoi afficher), écriture réservée à admin_est_admin().
-- Lu par site/fonctions-config.js ; une clé absente de la table garde sa valeur par défaut (actif).

create table if not exists public.fonctions_produit (
  cle         text primary key check (cle ~ '^[a-z_]{2,30}$'),
  libelle     text not null check (char_length(libelle) between 2 and 80),
  description text check (char_length(description) <= 300),
  actif       boolean not null default true,
  maj_le      timestamptz not null default now(),
  maj_par     uuid references auth.users(id) on delete set null
);

alter table public.fonctions_produit enable row level security;

drop policy if exists "Tout le monde lit les fonctions" on public.fonctions_produit;
create policy "Tout le monde lit les fonctions" on public.fonctions_produit for select using (true);

drop policy if exists "Un administrateur règle les fonctions" on public.fonctions_produit;
create policy "Un administrateur règle les fonctions" on public.fonctions_produit for all
  using (public.admin_est_admin()) with check (public.admin_est_admin());

create or replace function public.fonctions_produit_maj() returns trigger language plpgsql as $$
begin new.maj_le := now(); new.maj_par := auth.uid(); return new; end $$;
drop trigger if exists fonctions_produit_maj on public.fonctions_produit;
create trigger fonctions_produit_maj before insert or update on public.fonctions_produit
  for each row execute function public.fonctions_produit_maj();

insert into public.fonctions_produit (cle, libelle, description, actif) values
  ('caisse',   'Caisse',                      'Caisse (iPad et PC), terminal de paiement, produits, clôtures, attestation et page « logiciel de caisse ». Affichée « en cours de certification » : le certificat NF525 n''est pas délivré.', true),
  ('fidelite', 'Programme de fidélité',       'Carte à QR code, Apple Wallet et Google Wallet, réglages côté salon et bouton Fidélité de Clients. Les points se créditent depuis un ticket de caisse.', true),
  ('equipe',   'Statistiques d''équipe',      'Onglet Équipe : rendez-vous, taux de remplissage, chiffre d''affaires et commissions par personne (calculés d''après les tickets de caisse).', true)
on conflict (cle) do nothing;
