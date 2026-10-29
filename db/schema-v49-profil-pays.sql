-- Profil pays d'un salon : choisit la monnaie, les taux de TVA proposés, les mentions légales, la durée de conservation des archives et les moyens de paiement en ligne
-- proposés (voir site/pays-profils.js, qui porte les valeurs). Par défaut FR : rien ne change pour les salons existants.
-- Sûr à rejouer en entier. À exécuter après schema-v48-fiche-client.sql.
alter table public.parametres_facturation add column if not exists profil_pays text not null default 'FR';
alter table public.parametres_facturation drop constraint if exists parametres_facturation_profil_pays_check;
alter table public.parametres_facturation add constraint parametres_facturation_profil_pays_check check (profil_pays in ('FR', 'BE', 'CH', 'MA'));
