-- Boulangerie-pâtisserie : un seul tarif, 29 € par mois, tout inclus (formule interne `studio`).
-- À l'inscription, `activite = 'patisserie'` (métadonnée posée par signup.html) pose le métier `patisserie` ET force la formule `studio` :
-- le choix « Indépendant » (15 €) n'existe pas pour ce métier, même si quelqu'un modifie la requête d'inscription.
-- Le reste de handle_new_user() est celui de schema-v8-paiements.sql, inchangé. Sûr à rejouer.

create or replace function public.handle_new_user()
returns trigger as $$
declare
  jeton text := new.raw_user_meta_data->>'invite_token';
  patisserie boolean := new.raw_user_meta_data->>'activite' = 'patisserie';
  membre public.workspace_members;
begin
  insert into public.profiles (id, full_name, plan, business_name, metier)
  values (
    new.id,
    new.raw_user_meta_data->>'full_name',
    case when patisserie then 'studio' else coalesce(new.raw_user_meta_data->>'plan', 'solo') end,
    new.raw_user_meta_data->>'full_name',
    case when patisserie then 'patisserie' else null end
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
