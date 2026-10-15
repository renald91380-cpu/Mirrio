-- Mirrio — migration v9 : paiements anticipés, phase 2 (devis).
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Suite de schema-v8-paiements.sql (phase 1, paiement depuis un rendez-vous
-- déjà confirmé dans l'Agenda). Cette migration ajoute la même mécanique de
-- suivi de paiement, mais sur `documents` : demander un paiement directement
-- sur un devis déjà émis (site/devis-factures.html), qui se convertit
-- automatiquement en facture acquittée dès que le client paie — voir
-- api/paiement-webhook-stripe.js.
--
-- Mêmes colonnes, même sens, que sur `rendez_vous` (pas de `expire_le` ici :
-- payer un devis ne verrouille aucun créneau, rien à libérer si le paiement
-- n'aboutit jamais — la demande reste simplement `en_attente` indéfiniment,
-- et le praticien peut relancer via son propre lien).

alter table public.documents
  add column if not exists paiement_statut text,
  add column if not exists paiement_montant numeric,
  add column if not exists paiement_provider text,
  add column if not exists paiement_reference text;

alter table public.documents alter column paiement_statut set default 'non_requis';
update public.documents set paiement_statut = 'non_requis' where paiement_statut is null;
alter table public.documents alter column paiement_statut set not null;

alter table public.documents drop constraint if exists documents_paiement_statut_check;
alter table public.documents add constraint documents_paiement_statut_check
  check (paiement_statut in ('non_requis','en_attente','paye','echoue'));

alter table public.documents drop constraint if exists documents_paiement_provider_check;
alter table public.documents add constraint documents_paiement_provider_check
  check (paiement_provider is null or paiement_provider in ('stripe','paypal'));
