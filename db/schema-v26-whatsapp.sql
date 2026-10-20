-- Mirrio - migration v26 : bouton WhatsApp sur la page du salon. Idempotent.
-- `vitrine.whatsapp` : numéro WhatsApp (ou WhatsApp Business) affiché par le salon. Dès qu'il est rempli, la page du salon et la
-- confirmation de réservation proposent un bouton « Écrire sur WhatsApp » (lien wa.me : aucune connexion à l'API WhatsApp nécessaire).
alter table public.vitrine add column if not exists whatsapp text;
alter table public.vitrine drop constraint if exists vitrine_whatsapp_check;
alter table public.vitrine add constraint vitrine_whatsapp_check check (whatsapp is null or char_length(whatsapp) <= 30);
