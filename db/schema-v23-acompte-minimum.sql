-- Mirrio - migration v23 : acompte d'au moins 5 € toujours exigé (voir CLAUDE.md §3.21). Idempotent.
update public.parametres_paiement set acompte_minimum = 5 where acompte_minimum < 5;
alter table public.parametres_paiement drop constraint if exists parametres_paiement_acompte_check;
alter table public.parametres_paiement add constraint parametres_paiement_acompte_check
  check (acompte_minimum >= 5 and acompte_minimum <= 500 and acompte_pourcentage >= 0 and acompte_pourcentage <= 100);
