-- Grandes équipes : plus de 5 professionnels dans un salon, et des rôles par personne.
--   1. Forfait Équipe : 39 €/mois pour 5 professionnels, puis 5 €/mois par professionnel en plus, jusqu'à 20 (propriétaire compris, invitations en attente comprises).
--      Aucune facturation réelle : la limite se contente d'être appliquée ici, le prix est affiché sur l'accueil et dans les CGU.
--   2. Rôles d'un membre : manager (tout, sauf la gestion du compte et des invitations), collaborateur (agenda, clients, caisse),
--      vendeur (agenda et caisse). Le propriétaire et le gestionnaire d'un groupe gardent tous les droits.
--   3. Les clés de paiement (Stripe, PayPal) ne sont plus lisibles que par un responsable : jusqu'ici tout membre de l'espace pouvait les lire.
-- Le reste des droits (écrans masqués, réglages de la caisse, avoirs, archives) s'appuie sur mon_role() / est_manager() (définies dans schema-v43).
-- Sûr à rejouer en entier. À exécuter après schema-v44-produits.sql (et schema-v43, qui définit mon_role).

alter table public.workspace_members drop constraint if exists workspace_members_role_check;
alter table public.workspace_members add constraint workspace_members_role_check check (role in ('proprietaire', 'manager', 'collaborateur', 'vendeur'));

drop function if exists public.inviter_collaborateur(text);
create or replace function public.inviter_collaborateur(p_email text, p_role text default 'collaborateur')
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
    raise exception 'Inviter une équipe est réservé au forfait Équipe (5 professionnels inclus, puis 5 € par mois et par professionnel).' using errcode = 'insufficient_privilege';
  end if;
  if p_email is null or p_email !~ '^[^\s@]+@[^\s@]+\.[^\s@]+$' then
    raise exception 'Adresse email invalide.' using errcode = 'invalid_parameter_value';
  end if;
  if coalesce(p_role, 'collaborateur') not in ('manager', 'collaborateur', 'vendeur') then
    raise exception 'Rôle inconnu.' using errcode = 'invalid_parameter_value';
  end if;
  -- Le propriétaire compte pour un professionnel ; les invitations en attente comptent aussi, sinon on contournerait la limite.
  select 1 + count(*) into nb_pros from public.workspace_members m where m.workspace_id = ws and m.statut in ('actif', 'invite');
  if nb_pros >= 20 then
    raise exception 'Un salon compte 20 professionnels au plus. Contactez-nous pour une équipe plus grande.' using errcode = 'insufficient_privilege';
  end if;
  insert into public.workspace_members (workspace_id, email, role, statut, invite_token)
  values (ws, lower(trim(p_email)), coalesce(p_role, 'collaborateur'), 'invite', public.new_feed_token())
  returning * into ligne;
  return ligne;
end;
$$ language plpgsql security definer set search_path = public;

create or replace function public.changer_role_collaborateur(p_membre_id uuid, p_role text)
returns void as $$
declare ws uuid := public.current_workspace_id();
begin
  if ws <> auth.uid() and not public.est_gestionnaire(ws) then
    raise exception 'Seul le propriétaire ou le gestionnaire du salon peut changer un rôle.' using errcode = 'insufficient_privilege';
  end if;
  if p_role not in ('manager', 'collaborateur', 'vendeur') then raise exception 'Rôle inconnu.' using errcode = 'invalid_parameter_value'; end if;
  update public.workspace_members set role = p_role where id = p_membre_id and workspace_id = ws and statut in ('actif', 'invite');
  if not found then raise exception 'Membre introuvable.'; end if;
end;
$$ language plpgsql security definer set search_path = public;
grant execute on function public.changer_role_collaborateur(uuid, text) to authenticated;
revoke execute on function public.changer_role_collaborateur(uuid, text) from anon, public;

-- Clés de paiement : lecture et écriture réservées aux responsables.
drop policy if exists "Un utilisateur voit les clés de paiement de son espace" on public.parametres_paiement;
create policy "Un utilisateur voit les clés de paiement de son espace" on public.parametres_paiement for select using (owner_id = public.current_workspace_id() and public.est_manager());
drop policy if exists "Un utilisateur crée les clés de paiement de son espace" on public.parametres_paiement;
create policy "Un utilisateur crée les clés de paiement de son espace" on public.parametres_paiement for insert with check (owner_id = public.current_workspace_id() and public.est_manager());
drop policy if exists "Un utilisateur modifie les clés de paiement de son espace" on public.parametres_paiement;
create policy "Un utilisateur modifie les clés de paiement de son espace" on public.parametres_paiement for update using (owner_id = public.current_workspace_id() and public.est_manager());
