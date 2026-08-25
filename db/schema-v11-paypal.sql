-- Cadence — migration v11 : paiement PayPal, surface « agenda » (rendez-vous
-- déjà confirmé) — miroir de la phase 1 Stripe, mais pour PayPal.
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Suite de schema-v8-paiements.sql, qui avait déjà préparé les colonnes
-- paypal_actif/paypal_client_id/paypal_client_secret/paypal_webhook_id sur
-- `parametres_paiement`, et paiement_provider='paypal' sur `rendez_vous` —
-- rien à changer côté rendez_vous ici, seulement une colonne manquante côté
-- configuration.
--
-- Pourquoi `paypal_sandbox` : contrairement à Stripe (où une clé test
-- sk_test_… et une clé live sk_live_… tapent la MÊME URL d'API, qui déduit
-- elle-même le mode), l'API PayPal utilise deux HÔTES différents selon le
-- mode (api-m.sandbox.paypal.com / api-m.paypal.com) et un identifiant
-- sandbox n'a pas de forme reconnaissable qui permettrait de le déduire
-- automatiquement — il faut donc que le praticien indique lui-même le mode.
-- Par défaut à `true` (sandbox) : un praticien qui vient d'activer PayPal et
-- colle des clés de test ne doit jamais risquer de taper l'API live par
-- erreur avant d'avoir explicitement basculé.

alter table public.parametres_paiement
  add column if not exists paypal_sandbox boolean not null default true;

-- La vue publique doit exposer ce réglage (non sensible — juste "test ou
-- live") pour que site/parametres.html puisse l'afficher : ce n'est PAS une
-- clé secrète, contrairement à paypal_client_secret qui reste hors de cette
-- vue, exactement comme stripe_secret_key/stripe_webhook_secret — voir
-- schema-v8-paiements.sql §2 pour le rappel de ce modèle de confiance.
create or replace view public.parametres_paiement_public
  with (security_invoker = true) as
  select owner_id, stripe_actif, stripe_publishable_key,
         paypal_actif, paypal_client_id, paypal_sandbox
  from public.parametres_paiement;

grant select on public.parametres_paiement_public to authenticated;
