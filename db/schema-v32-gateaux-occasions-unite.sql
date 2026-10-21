-- Mirrio — schema v32 : liste complète d'événements et unité de vente des créations de pâtisserie
-- Idempotent. Dépend de schema-v27.
--   gateaux_commandes.occasion          : liste étendue (cérémonies, fêtes personnelles, vie professionnelle, fêtes de l'année) + 'autre'
--   gateaux_commandes.occasion_precision: texte libre quand l'occasion est « Autre »
--   gateaux_produits.unite              : 'part' (entremets, tartes…) ou 'piece' (éclairs, macarons, mignardises…)
alter table public.gateaux_commandes drop constraint if exists gateaux_commandes_occasion_check;
alter table public.gateaux_commandes add constraint gateaux_commandes_occasion_check check (occasion in (
  'mariage','anniversaire_mariage','fiancailles','bapteme','communion','bar_mitsva',
  'anniversaire','anniversaire_enfant','naissance','gender_reveal','diplome','cremaillere','reunion_famille',
  'retraite','pot_depart','entreprise',
  'epiphanie','saint_valentin','paques','fete_parents','noel','fete_religieuse','autre'));
alter table public.gateaux_commandes add column if not exists occasion_precision text check (occasion_precision is null or char_length(occasion_precision) <= 80);
alter table public.gateaux_produits add column if not exists unite text not null default 'part' check (unite in ('part','piece'));
