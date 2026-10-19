-- Mirrio - migration v22 : SMS de confirmation de rendez-vous (voir api/_sms.js). Idempotent.
-- `rendez_vous.sms_confirmation_le` : horodatage d'envoi, pour qu'un webhook de paiement rejoué ne renvoie pas le SMS.
alter table public.rendez_vous add column if not exists sms_confirmation_le timestamptz;
