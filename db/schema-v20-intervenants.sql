-- Mirrio — migration v20 : réservation par intervenant (coiffeur, praticien) et confirmation automatique.
-- À exécuter une fois dans Supabase (SQL Editor). Idempotent.
--
-- Un « intervenant » est une ligne de `vitrine_equipe` (la même équipe que celle
-- présentée sur la vitrine, pas forcément un compte Mirrio). Il n'est proposé à
-- la réservation en ligne que si `reservable` est vrai (faux par défaut : une équipe
-- simplement affichée ne multiplie pas la capacité d'accueil sans que le praticien
-- l'ait décidé).
--
--   1. `vitrine_equipe` : réservable, jours/horaires propres (vides = ceux du salon).
--   2. `prestation_intervenants` : qui assure quelle prestation. Un intervenant SANS ligne assure toutes les prestations.
--   3. `rendez_vous.intervenant_id` : qui assure le rendez-vous.
--   4. `parametres_reservation.validation_auto` : confirmer tout de suite quand le
--      créneau est libre (vrai par défaut).
--   5. `confirmer_reservation_payee()` réécrite : un conflit n'existe plus qu'entre
--      rendez-vous du MÊME intervenant (ou sans intervenant), pas pour tout l'espace.

alter table public.vitrine_equipe
  add column if not exists reservable boolean not null default false,
  add column if not exists jours_ouvres int[],
  add column if not exists heure_debut time,
  add column if not exists heure_fin time;

alter table public.vitrine_equipe drop constraint if exists vitrine_equipe_horaires_check;
alter table public.vitrine_equipe add constraint vitrine_equipe_horaires_check
  check (heure_debut is null or heure_fin is null or heure_fin > heure_debut);

create table if not exists public.prestation_intervenants (
  prestation_id uuid not null references public.prestations on delete cascade,
  intervenant_id uuid not null references public.vitrine_equipe on delete cascade,
  owner_id uuid not null references auth.users on delete cascade,
  primary key (prestation_id, intervenant_id)
);
create index if not exists prestation_intervenants_owner_idx on public.prestation_intervenants (owner_id);

alter table public.prestation_intervenants enable row level security;
drop policy if exists "Voir les affectations de son espace" on public.prestation_intervenants;
create policy "Voir les affectations de son espace" on public.prestation_intervenants for select using (owner_id = public.current_workspace_id());
drop policy if exists "Créer une affectation dans son espace" on public.prestation_intervenants;
create policy "Créer une affectation dans son espace" on public.prestation_intervenants for insert with check (owner_id = public.current_workspace_id());
drop policy if exists "Supprimer une affectation de son espace" on public.prestation_intervenants;
create policy "Supprimer une affectation de son espace" on public.prestation_intervenants for delete using (owner_id = public.current_workspace_id());

alter table public.rendez_vous
  add column if not exists intervenant_id uuid references public.vitrine_equipe on delete set null;
create index if not exists rendez_vous_intervenant_idx on public.rendez_vous (owner_id, intervenant_id, date_debut);

alter table public.parametres_reservation
  add column if not exists validation_auto boolean not null default true;

-- Même fonction que schema-v10, avec un conflit propre à l'intervenant.
create or replace function public.confirmer_reservation_payee(p_rendez_vous_id uuid, p_owner_id uuid)
returns table (
  resultat text, client_id uuid, prospect_nom text, prospect_email text, prospect_telephone text,
  prestation_id uuid, date_debut timestamptz, date_fin timestamptz, paiement_montant numeric, paiement_reference text
) as $$
declare
  v_fenetre record;
  v_rdv public.rendez_vous;
  v_conflit boolean;
  v_new_client_id uuid;
begin
  select rv.date_debut, rv.date_fin into v_fenetre
    from public.rendez_vous rv where rv.id = p_rendez_vous_id and rv.owner_id = p_owner_id;

  if not found then
    return query select 'introuvable'::text, null::uuid, null::text, null::text, null::text,
      null::uuid, null::timestamptz, null::timestamptz, null::numeric, null::text;
    return;
  end if;

  -- Verrou sur l'espace entier (sérialise les confirmations simultanées), la
  -- décision de conflit ci-dessous est, elle, propre à l'intervenant.
  perform 1 from public.rendez_vous
    where owner_id = p_owner_id
      and statut is distinct from 'annule'
      and (id = p_rendez_vous_id or (date_debut < v_fenetre.date_fin and date_fin > v_fenetre.date_debut))
    order by id
    for update;

  select * into v_rdv from public.rendez_vous where id = p_rendez_vous_id;

  if v_rdv.client_id is not null then
    return query select 'confirme'::text, v_rdv.client_id, v_rdv.prospect_nom, v_rdv.prospect_email,
      v_rdv.prospect_telephone, v_rdv.prestation_id, v_rdv.date_debut, v_rdv.date_fin,
      v_rdv.paiement_montant, v_rdv.paiement_reference;
    return;
  end if;

  select exists(
    select 1 from public.rendez_vous
      where owner_id = p_owner_id
        and id <> p_rendez_vous_id
        and statut is distinct from 'annule'
        and statut is distinct from 'en_attente'
        and date_debut < v_rdv.date_fin
        and date_fin > v_rdv.date_debut
        -- Sans intervenant (salon solo, ou rendez-vous saisi à la main sans attribution) :
        -- conflit avec tout. Avec intervenant : seulement avec lui ou avec un rendez-vous non attribué.
        and (v_rdv.intervenant_id is null or intervenant_id is null or intervenant_id = v_rdv.intervenant_id)
  ) into v_conflit;

  if v_conflit then
    update public.rendez_vous set statut = 'annule' where id = p_rendez_vous_id;
    return query select 'conflit'::text, null::uuid, v_rdv.prospect_nom, v_rdv.prospect_email,
      v_rdv.prospect_telephone, v_rdv.prestation_id, v_rdv.date_debut, v_rdv.date_fin,
      v_rdv.paiement_montant, v_rdv.paiement_reference;
    return;
  end if;

  insert into public.clients (full_name, email, phone, owner_id)
    values (v_rdv.prospect_nom, v_rdv.prospect_email, v_rdv.prospect_telephone, p_owner_id)
    returning id into v_new_client_id;

  update public.rendez_vous set client_id = v_new_client_id, statut = null where id = p_rendez_vous_id;

  return query select 'confirme'::text, v_new_client_id, v_rdv.prospect_nom, v_rdv.prospect_email,
    v_rdv.prospect_telephone, v_rdv.prestation_id, v_rdv.date_debut, v_rdv.date_fin,
    v_rdv.paiement_montant, v_rdv.paiement_reference;
end;
$$ language plpgsql security definer set search_path = public;

-- Les slugs demo-barber, demo-coiffure, demo-institut et demo-nouveau sont réservés aux salons fictifs de démonstration (site/demo-mode.js
-- simule leur API côté navigateur) : un vrai salon ne peut pas en choisir un.
alter table public.parametres_reservation drop constraint if exists parametres_reservation_slug_demo_check;
alter table public.parametres_reservation add constraint parametres_reservation_slug_demo_check
  check (slug is null or slug not in ('demo-barber','demo-coiffure','demo-institut','demo-nouveau'));
