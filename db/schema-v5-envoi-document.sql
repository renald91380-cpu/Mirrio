-- Mirrio — migration v5 : envoi d'un devis/facture par email au client.
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Aucune génération PDF côté serveur (choix assumé, voir CLAUDE.md §3 et §3.7
-- pour le back-office admin qui suit le même principe) : le client reçoit un
-- lien vers une page de lecture publique (`site/voir-document.html`), pas une
-- pièce jointe. `documents.partage_token` est le jeton de cette URL-capacité —
-- même idiome que `calendar_feeds.token`, généré par la fonction existante
-- `public.new_feed_token()` (schema-v2-personnalisation.sql), pas une nouvelle
-- fonction.

alter table public.documents
  add column if not exists partage_token text unique,
  add column if not exists dernier_envoi_le timestamptz;

create index if not exists documents_partage_token_idx
  on public.documents (partage_token) where partage_token is not null;

-- Pas de nouvelle policy RLS : la page publique passe par `api/document-public.js`,
-- qui lit avec la clé service_role (même schéma que `api/agenda.js` pour le
-- flux iCalendar) — le jeton est vérifié dans le code de la fonction, pas par
-- Postgres. `api/envoyer-document.js` écrit `partage_token`/`dernier_envoi_le`
-- de la même façon, après avoir vérifié lui-même que le document appartient à
-- l'espace de l'appelant.
