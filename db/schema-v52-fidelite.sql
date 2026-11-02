-- Mirrio — programme de fidélité : une carte par client (QR code, wallet iPhone et Android), points gagnés à chaque passage en caisse,
-- récompense réglée par le salon. Sûr à rejouer en entier. À exécuter après schema-v51-import.sql.
--
-- Deux façons de gagner : selon le MONTANT (points par euro) ou selon le NOMBRE DE PASSAGES (mode « visite » : un point = un tampon, la carte tamponnée classique,
-- par exemple 10 passages puis une remise sur le passage suivant).
-- Principes :
--  * Les points se créditent à partir d'un TICKET DE CAISSE RÉEL, relu en base (montant, client, formation) : jamais un montant venu du navigateur.
--    Un ticket ne crédite qu'une fois (index unique), un avoir reprend les points correspondants.
--  * Aucune écriture directe sur les cartes et les mouvements : tout passe par les fonctions ci-dessous. L'historique des mouvements ne se modifie pas.
--  * La carte est identifiée par un jeton-capacité (URL secrète, comme calendar_feeds.token) : le lire donne accès à CETTE carte seulement
--    (prénom, solde, derniers mouvements), jamais au fichier clients.
--  * L'inscription publique (QR affiché au salon) passe par le serveur uniquement (fonctions réservées à la clé de service).

create table if not exists public.fidelite_programmes (
  owner_id           uuid primary key,
  actif              boolean not null default false,
  mode               text not null default 'euro' check (mode in ('euro', 'visite')),
  points_par_euro    numeric(6,2) not null default 1 check (points_par_euro > 0 and points_par_euro <= 100),
  points_par_visite  int not null default 1 check (points_par_visite between 1 and 100),
  seuil              int not null default 100 check (seuil between 1 and 100000),
  recompense_type    text not null default 'remise_pct' check (recompense_type in ('remise_pct', 'libre')),
  recompense_pct     int not null default 10 check (recompense_pct between 1 and 100),
  recompense_libelle text not null default '' check (length(recompense_libelle) <= 120),
  points_bienvenue   int not null default 0 check (points_bienvenue between 0 and 1000),
  cree_le            timestamptz not null default now(),
  maj_le             timestamptz not null default now()
);

create table if not exists public.fidelite_cartes (
  id                   uuid primary key default gen_random_uuid(),
  owner_id             uuid not null,
  client_id            uuid not null references public.clients(id) on delete cascade,
  token                text not null unique default (public.new_feed_token() || public.new_feed_token()),
  points               int not null default 0 check (points >= 0),
  total_gagne          int not null default 0,
  total_utilise        int not null default 0,
  recompenses_utilisees int not null default 0,
  origine              text not null default 'caisse' check (origine in ('caisse', 'inscription')),
  consentement_le      timestamptz,
  cree_le              timestamptz not null default now(),
  derniere_visite      timestamptz,
  unique (owner_id, client_id)
);
create index if not exists fidelite_cartes_owner on public.fidelite_cartes(owner_id);

create table if not exists public.fidelite_mouvements (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null,
  carte_id      uuid not null references public.fidelite_cartes(id) on delete cascade,
  type          text not null check (type in ('gain', 'utilisation', 'ajustement', 'bienvenue', 'avoir')),
  points        int not null,
  solde         int not null,
  ticket_numero text,
  note          text check (note is null or length(note) <= 200),
  par           uuid,
  cree_le       timestamptz not null default now()
);
create index if not exists fidelite_mouvements_carte on public.fidelite_mouvements(carte_id, cree_le desc);
create unique index if not exists fidelite_mouvements_ticket_uq on public.fidelite_mouvements(owner_id, ticket_numero, type) where ticket_numero is not null;

alter table public.fidelite_programmes enable row level security;
alter table public.fidelite_cartes enable row level security;
alter table public.fidelite_mouvements enable row level security;

drop policy if exists "L'espace voit son programme" on public.fidelite_programmes;
create policy "L'espace voit son programme" on public.fidelite_programmes for select using (owner_id = public.current_workspace_id());
drop policy if exists "Un responsable règle le programme" on public.fidelite_programmes;
create policy "Un responsable règle le programme" on public.fidelite_programmes for all
  using (owner_id = public.current_workspace_id() and public.est_manager()) with check (owner_id = public.current_workspace_id() and public.est_manager());
drop policy if exists "L'espace voit ses cartes" on public.fidelite_cartes;
create policy "L'espace voit ses cartes" on public.fidelite_cartes for select using (owner_id = public.current_workspace_id());
drop policy if exists "L'espace voit les mouvements" on public.fidelite_mouvements;
create policy "L'espace voit les mouvements" on public.fidelite_mouvements for select using (owner_id = public.current_workspace_id());
-- Aucune policy d'écriture sur les cartes et les mouvements : seules les fonctions (security definer) écrivent.

create or replace function public.fidelite__espace()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare e uuid := public.current_workspace_id();
begin
  if auth.uid() is null or e is null then raise exception 'Connexion requise.' using errcode = 'insufficient_privilege'; end if;
  return e;
end $$;

create or replace function public.fidelite__programme(e uuid)
returns public.fidelite_programmes language plpgsql stable security definer set search_path = public as $$
declare p public.fidelite_programmes;
begin
  select * into p from public.fidelite_programmes where owner_id = e;
  if not found or not p.actif then raise exception 'Le programme de fidélité n''est pas activé.'; end if;
  return p;
end $$;

-- Carte d'un client (créée à la première demande, avec les points de bienvenue s'il y en a).
create or replace function public.fidelite__carte(e uuid, p_client uuid, p_origine text default 'caisse', p_consent boolean default false)
returns public.fidelite_cartes language plpgsql security definer set search_path = public as $$
declare c public.fidelite_cartes; p public.fidelite_programmes := public.fidelite__programme(e);
begin
  select * into c from public.fidelite_cartes where owner_id = e and client_id = p_client;
  if found then return c; end if;
  if not exists (select 1 from public.clients where id = p_client and owner_id = e) then raise exception 'Client introuvable.'; end if;
  insert into public.fidelite_cartes (owner_id, client_id, origine, consentement_le, points, total_gagne)
  values (e, p_client, p_origine, case when p_consent then now() end, p.points_bienvenue, p.points_bienvenue) returning * into c;
  if p.points_bienvenue > 0 then
    insert into public.fidelite_mouvements (owner_id, carte_id, type, points, solde, note, par) values (e, c.id, 'bienvenue', p.points_bienvenue, c.points, 'Points de bienvenue', auth.uid());
  end if;
  return c;
end $$;

create or replace function public.fidelite__vue(c public.fidelite_cartes, p public.fidelite_programmes)
returns jsonb language sql stable security definer set search_path = public as $$
  select jsonb_build_object('carte_id', c.id, 'token', c.token, 'points', c.points, 'seuil', p.seuil, 'pret', c.points >= p.seuil, 'mode', p.mode, 'points_par_visite', p.points_par_visite,
    'recompense_type', p.recompense_type, 'recompense_pct', p.recompense_pct, 'recompense_libelle', p.recompense_libelle,
    'client_id', c.client_id, 'client_nom', (select full_name from public.clients where id = c.client_id))
$$;

-- Carte d'un client choisi en caisse (la crée si besoin).
create or replace function public.fidelite_carte_client(p_client uuid)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e uuid := public.fidelite__espace(); p public.fidelite_programmes := public.fidelite__programme(e); c public.fidelite_cartes;
begin
  c := public.fidelite__carte(e, p_client);
  return public.fidelite__vue(c, p);
end $$;

-- Lecture d'un QR code présenté au comptoir (jeton, ou adresse complète de la carte).
create or replace function public.fidelite_scanner(p_code text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e uuid := public.fidelite__espace(); p public.fidelite_programmes := public.fidelite__programme(e); c public.fidelite_cartes; t text;
begin
  t := coalesce((regexp_match(coalesce(p_code, ''), '([0-9a-f]{48})'))[1], '');
  select * into c from public.fidelite_cartes where owner_id = e and token = t;
  if not found then raise exception 'Carte de fidélité inconnue dans ce salon.'; end if;
  return public.fidelite__vue(c, p);
end $$;

-- Crédite (et, au choix, utilise la récompense de) la vente indiquée. Idempotent par ticket.
-- Le montant et le client sont relus dans le ticket scellé : rien n'est pris du navigateur.
create or replace function public.fidelite_appliquer(p_numero text, p_utiliser boolean default false)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e uuid := public.fidelite__espace(); p public.fidelite_programmes; t public.caisse_tickets; c public.fidelite_cartes;
  gain int := 0; deja boolean := false; utilise boolean := false;
begin
  select * into p from public.fidelite_programmes where owner_id = e;
  if not found or not p.actif then return jsonb_build_object('actif', false); end if;
  select * into t from public.caisse_tickets where owner_id = e and numero = p_numero;
  if not found then raise exception 'Ticket introuvable.'; end if;
  if t.formation or t.client_id is null then return jsonb_build_object('actif', true, 'sans_client', true); end if;
  c := public.fidelite__carte(e, t.client_id);
  select * into c from public.fidelite_cartes where id = c.id for update;

  if t.type = 'vente' then
    if p_utiliser then
      if c.points < p.seuil then raise exception 'Points insuffisants pour la récompense.'; end if;
      if not exists (select 1 from public.fidelite_mouvements where owner_id = e and ticket_numero = p_numero and type = 'utilisation') then
        update public.fidelite_cartes set points = points - p.seuil, total_utilise = total_utilise + p.seuil, recompenses_utilisees = recompenses_utilisees + 1 where id = c.id returning * into c;
        insert into public.fidelite_mouvements (owner_id, carte_id, type, points, solde, ticket_numero, note, par)
        values (e, c.id, 'utilisation', -p.seuil, c.points, p_numero, 'Récompense utilisée', auth.uid());
        utilise := true;
      end if;
    end if;
    gain := case when p.mode = 'visite' then (case when t.total_ttc > 0 then p.points_par_visite else 0 end) else floor(greatest(t.total_ttc, 0) * p.points_par_euro)::int end;
    if gain > 0 and not exists (select 1 from public.fidelite_mouvements where owner_id = e and ticket_numero = p_numero and type = 'gain') then
      update public.fidelite_cartes set points = points + gain, total_gagne = total_gagne + gain, derniere_visite = now() where id = c.id returning * into c;
      insert into public.fidelite_mouvements (owner_id, carte_id, type, points, solde, ticket_numero, par) values (e, c.id, 'gain', gain, c.points, p_numero, auth.uid());
    else
      deja := gain > 0;
      gain := 0;
    end if;
  else
    -- avoir : on reprend les points que cette somme avait rapportés (le solde ne descend jamais sous zéro)
    gain := case when p.mode = 'visite' then 0 else floor(abs(t.total_ttc) * p.points_par_euro)::int end;
    if gain > 0 and not exists (select 1 from public.fidelite_mouvements where owner_id = e and ticket_numero = p_numero and type = 'avoir') then
      gain := least(gain, c.points);
      update public.fidelite_cartes set points = points - gain where id = c.id returning * into c;
      insert into public.fidelite_mouvements (owner_id, carte_id, type, points, solde, ticket_numero, note, par) values (e, c.id, 'avoir', -gain, c.points, p_numero, 'Avoir', auth.uid());
      gain := -gain;
    else gain := 0; end if;
  end if;
  return public.fidelite__vue(c, p) || jsonb_build_object('actif', true, 'gain', gain, 'utilise', utilise, 'deja', deja);
end $$;

-- Correction manuelle par un responsable (cadeau, erreur, geste commercial). Motif obligatoire, tracé.
create or replace function public.fidelite_ajuster(p_carte uuid, p_delta int, p_note text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare e uuid := public.fidelite__espace(); p public.fidelite_programmes; c public.fidelite_cartes;
begin
  if not public.est_manager() then raise exception 'Réservé au responsable du salon.' using errcode = 'insufficient_privilege'; end if;
  p := public.fidelite__programme(e);
  if p_delta is null or p_delta = 0 or abs(p_delta) > 100000 then raise exception 'Nombre de points invalide.'; end if;
  if coalesce(btrim(p_note), '') = '' then raise exception 'Indiquez un motif.'; end if;
  select * into c from public.fidelite_cartes where id = p_carte and owner_id = e for update;
  if not found then raise exception 'Carte introuvable.'; end if;
  if c.points + p_delta < 0 then raise exception 'Le solde ne peut pas devenir négatif.'; end if;
  update public.fidelite_cartes set points = points + p_delta, total_gagne = total_gagne + greatest(p_delta, 0), total_utilise = total_utilise + greatest(-p_delta, 0) where id = c.id returning * into c;
  insert into public.fidelite_mouvements (owner_id, carte_id, type, points, solde, note, par) values (e, c.id, 'ajustement', p_delta, c.points, left(btrim(p_note), 200), auth.uid());
  return public.fidelite__vue(c, p);
end $$;

-- Liste des cartes pour l'écran du salon (responsables).
create or replace function public.fidelite_liste()
returns table (carte_id uuid, client_id uuid, nom text, email text, telephone text, points int, total_gagne int, recompenses_utilisees int, origine text, derniere_visite timestamptz, cree_le timestamptz, token text)
language plpgsql stable security definer set search_path = public as $$
declare e uuid := public.fidelite__espace();
begin
  if not public.est_manager() then raise exception 'Réservé au responsable du salon.' using errcode = 'insufficient_privilege'; end if;
  return query select c.id, c.client_id, cl.full_name, cl.email, cl.phone, c.points, c.total_gagne, c.recompenses_utilisees, c.origine, c.derniere_visite, c.cree_le, c.token
    from public.fidelite_cartes c join public.clients cl on cl.id = c.client_id where c.owner_id = e order by c.derniere_visite desc nulls last, c.cree_le desc limit 1000;
end $$;

-- ---------------------------------------------------------------------------------------- côté public (clé de service uniquement)
-- Lecture d'une carte par son jeton, pour la page du client et les passes wallet.
create or replace function public.fidelite_publique(p_token text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare c public.fidelite_cartes; p public.fidelite_programmes; pr public.profiles; v public.vitrine; r public.parametres_reservation;
begin
  select * into c from public.fidelite_cartes where token = coalesce(p_token, '');
  if not found then return null; end if;
  select * into p from public.fidelite_programmes where owner_id = c.owner_id;
  if not found or not p.actif then return null; end if;
  select * into pr from public.profiles where id = c.owner_id;
  select * into v from public.vitrine where owner_id = c.owner_id;
  select * into r from public.parametres_reservation where owner_id = c.owner_id;
  return jsonb_build_object('token', c.token, 'owner_id', c.owner_id, 'salon', coalesce(nullif(pr.business_name, ''), pr.full_name, 'Votre salon'), 'logo', pr.logo_url, 'couleur', v.couleur, 'slug', r.slug,
    'prenom', split_part(coalesce((select full_name from public.clients where id = c.client_id), ''), ' ', 1),
    'points', c.points, 'seuil', p.seuil, 'mode', p.mode, 'points_par_euro', p.points_par_euro, 'points_par_visite', p.points_par_visite,
    'recompense_type', p.recompense_type, 'recompense_pct', p.recompense_pct, 'recompense_libelle', p.recompense_libelle,
    'recompenses_utilisees', c.recompenses_utilisees,
    'mouvements', coalesce((select jsonb_agg(jsonb_build_object('type', m.type, 'points', m.points, 'date', m.cree_le) order by m.cree_le desc)
       from (select * from public.fidelite_mouvements where carte_id = c.id order by cree_le desc limit 10) m), '[]'::jsonb));
end $$;

-- Ce que montre la page d'inscription d'un salon (QR affiché au comptoir).
create or replace function public.fidelite_programme_public(p_slug text)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r public.parametres_reservation; p public.fidelite_programmes; pr public.profiles; v public.vitrine;
begin
  select * into r from public.parametres_reservation where slug = coalesce(p_slug, '');
  if not found then return null; end if;
  select * into p from public.fidelite_programmes where owner_id = r.owner_id;
  if not found or not p.actif then return null; end if;
  select * into pr from public.profiles where id = r.owner_id;
  select * into v from public.vitrine where owner_id = r.owner_id;
  return jsonb_build_object('salon', coalesce(nullif(pr.business_name, ''), pr.full_name, 'Votre salon'), 'logo', pr.logo_url, 'couleur', v.couleur,
    'mode', p.mode, 'points_par_euro', p.points_par_euro, 'points_par_visite', p.points_par_visite, 'seuil', p.seuil,
    'recompense_type', p.recompense_type, 'recompense_pct', p.recompense_pct, 'recompense_libelle', p.recompense_libelle, 'points_bienvenue', p.points_bienvenue);
end $$;

-- Inscription depuis le QR du salon : retrouve le client (même e-mail ou même téléphone) ou le crée, puis donne sa carte. 100 nouvelles cartes par jour au plus.
create or replace function public.fidelite_inscrire(p_slug text, p_nom text, p_email text, p_tel text)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  r public.parametres_reservation; e uuid; p public.fidelite_programmes; cl uuid; c public.fidelite_cartes; deja boolean := false;
  v_nom text := nullif(btrim(left(p_nom, 120)), ''); v_mail text := nullif(lower(btrim(left(p_email, 200))), ''); v_tel text := nullif(btrim(left(p_tel, 40)), '');
  ch text;
begin
  select * into r from public.parametres_reservation where slug = coalesce(p_slug, '');
  if not found then raise exception 'Salon introuvable.'; end if;
  e := r.owner_id;
  select * into p from public.fidelite_programmes where owner_id = e;
  if not found or not p.actif then raise exception 'Ce salon n''a pas de programme de fidélité.'; end if;
  if v_nom is null then raise exception 'Indiquez votre nom.'; end if;
  if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_mail := null; end if;
  ch := regexp_replace(coalesce(v_tel, ''), '\D', '', 'g');
  if v_mail is null and length(ch) < 9 then raise exception 'Indiquez un e-mail ou un téléphone pour retrouver votre carte.'; end if;

  if v_mail is not null then select id into cl from public.clients where owner_id = e and lower(email) = v_mail limit 1; end if;
  if cl is null and length(ch) >= 9 then select id into cl from public.clients where owner_id = e and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 9) = right(ch, 9) limit 1; end if;
  if cl is not null then
    select * into c from public.fidelite_cartes where owner_id = e and client_id = cl;
    deja := found;
  end if;
  if not deja then
    if (select count(*) from public.fidelite_cartes where owner_id = e and origine = 'inscription' and cree_le > now() - interval '1 day') >= 100 then
      raise exception 'Trop d''inscriptions aujourd''hui, réessayez demain ou demandez au salon.';
    end if;
    if cl is null then
      insert into public.clients (owner_id, full_name, email, phone, notes) values (e, v_nom, v_mail, v_tel, 'Inscrit via la carte de fidélité.') returning id into cl;
    end if;
    c := public.fidelite__carte(e, cl, 'inscription', true);
  end if;
  return jsonb_build_object('token', c.token, 'deja', deja);
end $$;

-- Réservé à la clé de service (les routes publiques du serveur) : jamais appelables depuis un navigateur.
revoke all on function public.fidelite_publique(text) from public, anon, authenticated;
revoke all on function public.fidelite_programme_public(text) from public, anon, authenticated;
revoke all on function public.fidelite_inscrire(text, text, text, text) from public, anon, authenticated;
grant execute on function public.fidelite_publique(text) to service_role;
grant execute on function public.fidelite_programme_public(text) to service_role;
grant execute on function public.fidelite_inscrire(text, text, text, text) to service_role;
-- Fonctions internes : appelées par les autres fonctions seulement.
revoke all on function public.fidelite__espace() from public, anon, authenticated;
revoke all on function public.fidelite__programme(uuid) from public, anon, authenticated;
revoke all on function public.fidelite__carte(uuid, uuid, text, boolean) from public, anon, authenticated;
revoke all on function public.fidelite__vue(public.fidelite_cartes, public.fidelite_programmes) from public, anon, authenticated;
-- Fonctions du personnel connecté.
revoke all on function public.fidelite_carte_client(uuid) from public, anon;
revoke all on function public.fidelite_scanner(text) from public, anon;
revoke all on function public.fidelite_appliquer(text, boolean) from public, anon;
revoke all on function public.fidelite_ajuster(uuid, int, text) from public, anon;
revoke all on function public.fidelite_liste() from public, anon;
grant execute on function public.fidelite_carte_client(uuid), public.fidelite_scanner(text), public.fidelite_appliquer(text, boolean), public.fidelite_ajuster(uuid, int, text), public.fidelite_liste() to authenticated;
