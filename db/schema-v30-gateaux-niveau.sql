-- Mirrio — schema v30 : une seule commande « surcharge » et une seule « exception » par jour
-- Idempotent. Dépend de schema-v28 et v29.
-- `niveau_charge` mémorise le palier d'une commande majorée, pour que le serveur puisse compter
-- combien de commandes de chaque palier une journée a déjà acceptées.
alter table public.gateaux_commandes
  add column if not exists niveau_charge text check (niveau_charge is null or niveau_charge in ('surcharge','exception'));
update public.gateaux_commandes set niveau_charge = 'surcharge' where surcharge and niveau_charge is null;
