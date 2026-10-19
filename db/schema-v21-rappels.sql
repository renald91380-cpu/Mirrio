-- Mirrio - migration v21 : rappels de rendez-vous par email et par SMS.
-- À exécuter une fois dans Supabase (SQL Editor). Idempotent.
--
--   * `parametres_reservation.rappel_email` : envoyer un email de rappel la veille (vrai par défaut).
--   * `parametres_reservation.rappel_sms`   : envoyer aussi un SMS (faux par défaut : un SMS coûte de l'argent,
--                                              le salon doit l'activer lui-même).
--   * `rendez_vous.rappel_email_le` / `rappel_sms_le` : horodatage d'envoi, pour ne jamais rappeler deux fois.

alter table public.parametres_reservation
  add column if not exists rappel_email boolean not null default true,
  add column if not exists rappel_sms boolean not null default false;

alter table public.rendez_vous
  add column if not exists rappel_email_le timestamptz,
  add column if not exists rappel_sms_le timestamptz;

create index if not exists rendez_vous_rappel_idx on public.rendez_vous (date_debut)
  where statut is distinct from 'annule';
