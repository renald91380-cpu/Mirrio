-- Mirrio — migration v16 : attribuer un rendez-vous à un membre de l'équipe.
-- À exécuter une fois dans Supabase (SQL Editor). Idempotent.
--
-- `rendez_vous.collaborateur_id` : le membre qui assure le rendez-vous.
-- `null` = non attribué → affiché dans la colonne du propriétaire de l'espace
-- (c'est le cas de tous les rendez-vous existants et des réservations en ligne).
-- Les policies RLS ne changent pas : l'isolation reste faite par `owner_id`.

alter table public.rendez_vous
  add column if not exists collaborateur_id uuid references auth.users on delete set null;

create index if not exists rendez_vous_collab_idx on public.rendez_vous (owner_id, collaborateur_id, date_debut);
