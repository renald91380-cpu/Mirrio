-- Mirrio — schema v33 : règlement à la commande au choix de la pâtisserie
-- Idempotent. Dépend de schema-v27.
-- `acompte_integral` : vrai = 100 % du prix à la commande ; faux = `acompte_pourcentage` % (0 = rien à payer d'avance).
-- Le montant dû à la commande est encaissé par carte (Stripe du salon) quand il est actif.
alter table public.parametres_gateaux add column if not exists acompte_integral boolean not null default false;
