-- Forfaits beauté (décidés le 29 octobre 2026) : Solo 19 €/mois (1 professionnel), Équipe 39 €/mois (jusqu'à 5 professionnels), Groupe 79 €/mois
-- (jusqu'à 10 salons) ; paiement annuel = deux mois offerts (190 / 390 / 790 €). Valeurs internes : solo = Solo, studio = Équipe (et Groupe).
--   1. profiles.periodicite ('mensuel' | 'annuel') : préférence choisie à l'inscription, pour savoir qui veut payer à l'année. Aucune facturation réelle ici.
--   2. handle_new_user() : reprend celle de schema-v37 et lit `periodicite`.
--   3. inviter_collaborateur() : reprend celle de schema-v38 et plafonne l'équipe à 5 professionnels (propriétaire compris, invitations en attente comprises).
-- Sûr à rejouer en entier. À exécuter après schema-v40-export-comptable.sql.

alter table public.profiles add column if not exists periodicite text not null default 'mensuel';
alter table public.profiles drop constraint if exists profiles_periodicite_check;
alter table public.profiles add constraint profiles_periodicite_check check (periodicite in ('mensuel', 'annuel'));

create or replace function public.handle_new_user()
returns trigger as $$
declare
  jeton text := new.raw_user_meta_data->>'invite_token';
  patisserie boolean := new.raw_user_meta_data->>'activite' = 'patisserie';
  couple boolean := new.raw_user_meta_data->>'activite' = 'mariage';
  membre public.workspace_members;
begin
  insert into public.profiles (id, full_name, plan, business_name, metier, type_compte, periodicite)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    case when patisserie then 'studio' else coalesce(new.raw_user_meta_data->>'plan', 'solo') end,
    new.raw_user_meta_data->>'full_name',
    case when patisserie then 'patisserie' else null end,
    case when couple then 'couple' else 'pro' end,
    case when new.raw_user_meta_data->>'periodicite' = 'annuel' then 'annuel' else 'mensuel' end
  )
  on conflict (id) do nothing;

  insert into public.parametres_facturation (owner_id, emetteur_nom, emetteur_email)
  values (new.id, new.raw_user_meta_data->>'full_name', new.email)
  on conflict (owner_id) do nothing;

  insert into public.parametres_reservation (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  insert into public.parametres_paiement (owner_id)
  values (new.id)
  on conflict (owner_id) do nothing;

  insert into public.calendar_feeds (owner_id, token)
  values (new.id, public.new_feed_token())
  on conflict (owner_id) do nothing;

  if jeton is not null then
    select * into membre from public.workspace_members
      where invite_token = jeton and statut = 'invite'
      for update;

    if found then
      update public.workspace_members
        set user_id = new.id, statut = 'actif', joined_at = now()
        where id = membre.id;
      update public.profiles set espace_actif_id = membre.workspace_id where id = new.id;
    end if;
  end if;

  return new;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.inviter_collaborateur(p_email text)
returns public.workspace_members as $$
declare
  ws uuid := public.current_workspace_id();
  mon_plan text;
  nb_pros integer;
  ligne public.workspace_members;
begin
  if ws <> auth.uid() and not public.est_gestionnaire(ws) then
    raise exception 'Seul le propriétaire ou le gestionnaire du salon peut inviter.' using errcode = 'insufficient_privilege';
  end if;
  select plan into mon_plan from public.profiles where id = ws;
  if mon_plan is distinct from 'studio' then
    raise exception 'Inviter une équipe est réservé au forfait Équipe (jusqu''à 5 professionnels).' using errcode = 'insufficient_privilege';
  end if;
  if p_email is null or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Adresse email invalide.' using errcode = 'invalid_parameter_value';
  end if;
  -- Le propriétaire compte pour un professionnel ; les invitations en attente comptent aussi, sinon on contournerait la limite.
  select 1 + count(*) into nb_pros from public.workspace_members m where m.workspace_id = ws and m.statut in ('actif', 'invite');
  if nb_pros >= 5 then
    raise exception 'Le forfait Équipe comprend jusqu''à 5 professionnels. Contactez-nous pour une équipe plus grande.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.workspace_members (workspace_id, email, role, statut, invite_token)
  values (ws, lower(trim(p_email)), 'collaborateur', 'invite', public.new_feed_token())
  returning * into ligne;
  return ligne;
end;
$$ language plpgsql security definer set search_path = public;
