-- Cadence — migration v10 : statut "remboursé" + confirmation atomique d'une
-- réservation payée, phase 3 (réservation en ligne avec auto-confirmation).
-- À exécuter une fois dans Supabase : Project → SQL Editor → New query → coller → Run.
-- Idempotent : peut être rejouée sans casser l'existant.
--
-- Suite de schema-v8-paiements.sql / schema-v9-paiement-devis.sql.
--
-- =====================================================================
-- 1. Statut de paiement "remboursé"
-- =====================================================================
-- La phase 3 peut rembourser automatiquement un paiement quand deux clients
-- arrivent au paiement pour des créneaux qui se chevauchent — voir la
-- fonction ci-dessous et api/paiement-webhook-stripe.js. Sans cette valeur,
-- un rendez-vous remboursé restait marqué 'paye' pour toujours, ce qui
-- aurait été trompeur (l'argent est reparti chez le client).

alter table public.rendez_vous drop constraint if exists rendez_vous_paiement_statut_check;
alter table public.rendez_vous add constraint rendez_vous_paiement_statut_check
  check (paiement_statut in ('non_requis','en_attente','paye','echoue','rembourse'));

-- Même valeur ajoutée sur `documents` par cohérence (même domaine de valeurs
-- que rendez_vous), même si rien ne l'utilise encore de ce côté-là.
alter table public.documents drop constraint if exists documents_paiement_statut_check;
alter table public.documents add constraint documents_paiement_statut_check
  check (paiement_statut in ('non_requis','en_attente','paye','echoue','rembourse'));

-- =====================================================================
-- 2. Confirmation atomique d'une réservation payée
-- =====================================================================
-- Pourquoi une fonction SQL plutôt que des appels REST séquentiels depuis
-- le webhook : le compare-and-swap sur `paiement_statut` (en_attente→paye)
-- suffit à rendre CE rendez-vous idempotent face à un webhook renvoyé, mais
-- ne protège pas contre DEUX rendez-vous DIFFÉRENTS, sur des créneaux qui se
-- chevauchent, payés à quelques secondes d'intervalle — chacun pourrait
-- constater "aucun rendez-vous confirmé en conflit" avant que l'autre ait
-- fini de se confirmer, et les deux se confirmeraient : double réservation
-- malgré le paiement. Une fonction plpgsql peut verrouiller toutes les
-- lignes concernées AVANT de décider, ce qu'une suite de requêtes REST
-- séparées ne peut pas garantir de façon fiable.
--
-- Le verrou porte sur CE rendez-vous ET tout rendez-vous non annulé qui
-- chevauche son créneau (y compris d'autres holds non résolus, pas
-- seulement les rendez-vous déjà confirmés), TOUJOURS DANS LE MÊME ORDRE
-- (`order by id`) quel que soit celui des deux appels qui déclenche le
-- verrouillage en premier — c'est ce qui évite un deadlock entre deux
-- confirmations concurrentes (technique standard PostgreSQL : verrouiller
-- systématiquement dans le même ordre). Une fois les verrous acquis, seul un
-- rendez-vous VRAIMENT confirmé (ni 'annule' ni 'en_attente') compte comme
-- un conflit réel — un simple hold non résolu ne bloque pas cette
-- confirmation.
--
-- `resultat` renvoyé : 'confirme' (fiche client créée, rendez-vous confirmé
-- — ou déjà confirmé par un appel précédent, idempotent), 'conflit' (créneau
-- pris entre-temps, rendez-vous annulé ici, à rembourser côté appelant —
-- cette fonction ne parle jamais à Stripe elle-même), ou 'introuvable'
-- (garde-fou, ne devrait pas arriver en pratique).

create or replace function public.confirmer_reservation_payee(p_rendez_vous_id uuid, p_owner_id uuid)
returns table (
  resultat text,
  client_id uuid,
  prospect_nom text,
  prospect_email text,
  prospect_telephone text,
  prestation_id uuid,
  date_debut timestamptz,
  date_fin timestamptz,
  paiement_montant numeric,
  paiement_reference text
) as $$
declare
  v_fenetre record;
  v_rdv public.rendez_vous;
  v_conflit boolean;
  v_new_client_id uuid;
begin
  -- Fenêtre horaire du créneau : immuable après la création du hold (aucune
  -- fonctionnalité ne permet à un prospect de la modifier), lecture simple
  -- sans verrou nécessaire pour ça.
  select rv.date_debut, rv.date_fin into v_fenetre
    from public.rendez_vous rv where rv.id = p_rendez_vous_id and rv.owner_id = p_owner_id;

  if not found then
    return query select 'introuvable'::text, null::uuid, null::text, null::text, null::text,
      null::uuid, null::timestamptz, null::timestamptz, null::numeric, null::text;
    return;
  end if;

  perform 1 from public.rendez_vous
    where owner_id = p_owner_id
      and statut is distinct from 'annule'
      and (id = p_rendez_vous_id or (date_debut < v_fenetre.date_fin and date_fin > v_fenetre.date_debut))
    order by id
    for update;

  select * into v_rdv from public.rendez_vous where id = p_rendez_vous_id;

  -- Déjà confirmé par un appel précédent (webhook renvoyé après un premier
  -- succès) — idempotent, rien à refaire.
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
