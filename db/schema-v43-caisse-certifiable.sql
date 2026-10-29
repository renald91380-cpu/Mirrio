-- Caisse certifiable (caisse.html) : journal inaltérable chaîné et signé, tickets figés, avoirs, duplicata, mode formation,
-- clôtures journalière (Z), mensuelle et annuelle, grands totaux perpétuels, vérification d'intégrité et archive.
--
-- OBJECTIF : réunir les exigences techniques de la loi anti-fraude à la TVA (art. 286 I 3° bis du CGI, référentiel NF525) : inaltérabilité,
-- sécurisation, conservation, archivage. CE FICHIER NE VAUT PAS CERTIFICATION : la certification est délivrée par un organisme accrédité
-- (LNE, Infocert, AFNOR) après audit du logiciel ; à défaut, l'éditeur peut délivrer une attestation individuelle. Voir docs/caisse-conformite.md.
--
-- Principes :
--  * Toute écriture de caisse passe par une fonction SQL `security definer` ; les clients n'ont plus aucune policy d'écriture sur les tables de caisse.
--  * `caisse_journal` est append-only (triggers update/delete/truncate refusés). Chaque entrée porte le hash SHA-256 de la précédente (chaîne),
--    une signature HMAC-SHA256 avec une clé propre à l'espace (jamais lisible par un client), et les grands totaux perpétuel et absolu.
--  * `caisse_tickets` (vente ou avoir) est un instantané figé : lignes, TVA, paiements, client. Une correction passe TOUJOURS par un avoir.
--  * Numérotation continue sans trou : compteurs verrouillés dans `caisse_chaine`.
--  * Les factures miroirs (`documents`) créées pour la comptabilité deviennent elles aussi non modifiables et non supprimables.
-- Sûr à rejouer en entier. À exécuter après schema-v42-planning-groupe.sql.

create extension if not exists pgcrypto with schema extensions;

-- ---------------------------------------------------------------------------------------------------------------- chaîne et clé
create table if not exists public.caisse_chaine (
  owner_id      uuid primary key,
  seq           bigint        not null default 0,
  hash          text          not null default 'GENESIS',
  gt_perpetuel  numeric(16,2) not null default 0,   -- somme signée de tous les tickets (ventes - avoirs), jamais remise à zéro
  gt_absolu     numeric(16,2) not null default 0,   -- somme des valeurs absolues
  n_ticket      bigint        not null default 0,
  n_avoir       bigint        not null default 0,
  n_formation   bigint        not null default 0,
  n_z           bigint        not null default 0
);
create table if not exists public.caisse_secrets (owner_id uuid primary key, cle text not null);
alter table public.caisse_chaine enable row level security;
alter table public.caisse_secrets enable row level security;   -- aucune policy : illisible pour tout client
drop policy if exists "Caisse : lire la chaîne de l'espace" on public.caisse_chaine;
create policy "Caisse : lire la chaîne de l'espace" on public.caisse_chaine for select using (owner_id = public.current_workspace_id());

create table if not exists public.caisse_journal (
  id            uuid primary key default gen_random_uuid(),
  owner_id      uuid not null,
  seq           bigint not null,
  type          text not null check (type in ('ouverture','vente','avoir','formation','duplicata','cloture_z','cloture_mensuelle','cloture_annuelle','archive','verification')),
  session_id    uuid,
  ticket_id     uuid,
  numero        text,
  montant_ttc   numeric(14,2),
  payload       jsonb not null default '{}'::jsonb,
  gt_perpetuel  numeric(16,2) not null,
  gt_absolu     numeric(16,2) not null,
  prev_hash     text not null,
  hash          text not null,
  signature     text not null,
  created_at    timestamptz not null,
  auteur        uuid,
  unique (owner_id, seq)
);
create index if not exists caisse_journal_owner_date on public.caisse_journal(owner_id, created_at);
alter table public.caisse_journal enable row level security;
drop policy if exists "Caisse : lire le journal de l'espace" on public.caisse_journal;
create policy "Caisse : lire le journal de l'espace" on public.caisse_journal for select using (owner_id = public.current_workspace_id());

create table if not exists public.caisse_tickets (
  id             uuid primary key,
  owner_id       uuid not null,
  session_id     uuid not null references public.caisse_sessions(id) on delete restrict,
  journal_seq    bigint not null,
  journal_hash   text not null,
  type           text not null check (type in ('vente','avoir')),
  formation      boolean not null default false,
  numero         text not null,
  date_ticket    timestamptz not null,
  client_id      uuid,
  client_nom     text,
  lignes         jsonb not null,
  total_ht       numeric(14,2) not null,
  total_tva      numeric(14,2) not null,
  total_ttc      numeric(14,2) not null,
  ventilation    jsonb not null,
  paiements      jsonb not null,
  assujetti_tva  boolean not null,
  document_id    uuid,
  ticket_origine uuid references public.caisse_tickets(id) on delete restrict,
  motif          text,
  created_by     uuid,
  unique (owner_id, numero)
);
create index if not exists caisse_tickets_session on public.caisse_tickets(session_id);
create index if not exists caisse_tickets_origine on public.caisse_tickets(ticket_origine);
alter table public.caisse_tickets enable row level security;
drop policy if exists "Caisse : lire les tickets de l'espace" on public.caisse_tickets;
create policy "Caisse : lire les tickets de l'espace" on public.caisse_tickets for select using (owner_id = public.current_workspace_id());

-- Un montant de paiement peut maintenant être négatif (remboursement d'un avoir).
alter table public.caisse_paiements drop constraint if exists caisse_paiements_montant_check;
alter table public.caisse_paiements add constraint caisse_paiements_montant_check check (montant <> 0);
alter table public.caisse_paiements add column if not exists ticket_id uuid;
-- Nouveau moyen : « acompte » = somme déjà réglée en ligne pour le rendez-vous (posée par le serveur, jamais par un navigateur).
alter table public.caisse_paiements drop constraint if exists caisse_paiements_mode_check;
alter table public.caisse_paiements add constraint caisse_paiements_mode_check check (mode in ('especes', 'carte', 'cheque', 'virement', 'autre', 'acompte'));
-- Le rendez-vous encaissé garde le lien vers son ticket (un rendez-vous ne s'encaisse qu'une fois).
alter table public.rendez_vous add column if not exists caisse_ticket_id uuid;

-- Plus aucune écriture directe depuis un navigateur : tout passe par les fonctions ci-dessous.
drop policy if exists "Caisse : sessions de l'espace" on public.caisse_sessions;
drop policy if exists "Caisse : lire les sessions de l'espace" on public.caisse_sessions;
create policy "Caisse : lire les sessions de l'espace" on public.caisse_sessions for select using (owner_id = public.current_workspace_id());
drop policy if exists "Caisse : enregistrer un paiement dans l'espace" on public.caisse_paiements;

-- ---------------------------------------------------------------------------------------------------------------- terminal de paiement (SumUp)
-- Identifiants SumUp du salon : jamais lisibles par un navigateur (RLS sans policy), uniquement par api/_terminal.js (clé de service).
create table if not exists public.caisse_terminal_config (
  owner_id      uuid primary key,
  merchant_code text not null,
  api_key       text not null,
  affiliate_key text not null,
  app_id        text not null,
  reader_id     text,
  reader_name   text,
  maj_le        timestamptz not null default now()
);
alter table public.caisse_terminal_config enable row level security;
create table if not exists public.caisse_terminal_paiements (
  id                    uuid primary key default gen_random_uuid(),
  owner_id              uuid not null,
  session_id            uuid,
  montant               numeric(12,2) not null check (montant > 0),
  statut                text not null default 'en_attente' check (statut in ('en_attente', 'reussi', 'echoue', 'annule')),
  secret                text not null,                 -- porté par l'URL du webhook : propre à chaque paiement
  client_transaction_id text,
  transaction_code      text,
  failure_reason        text,
  source                text not null default 'terminal' check (source in ('terminal', 'lien')),   -- terminal SumUp, ou lien / QR de paiement (Stripe)
  ticket_id             uuid,                          -- renseigné quand une vente utilise ce paiement (un paiement ne sert qu'une fois)
  created_at            timestamptz not null default now(),
  updated_at            timestamptz not null default now(),
  created_by            uuid
);
alter table public.caisse_terminal_paiements add column if not exists source text not null default 'terminal';
create index if not exists caisse_terminal_paiements_owner on public.caisse_terminal_paiements(owner_id, created_at desc);
alter table public.caisse_terminal_paiements enable row level security;

-- ---------------------------------------------------------------------------------------------------------------- inaltérabilité
create or replace function public.caisse__immuable()
returns trigger language plpgsql as $$
begin
  raise exception 'Les enregistrements de caisse sont inaltérables (%). Une erreur se corrige par un avoir.', tg_table_name using errcode = 'restrict_violation';
end $$;
do $$
declare t text;
begin
  foreach t in array array['caisse_journal', 'caisse_tickets', 'caisse_paiements'] loop
    execute format('drop trigger if exists caisse_immuable on public.%I', t);
    execute format('create trigger caisse_immuable before update or delete on public.%I for each row execute function public.caisse__immuable()', t);
    execute format('drop trigger if exists caisse_immuable_trunc on public.%I', t);
    execute format('create trigger caisse_immuable_trunc before truncate on public.%I for each statement execute function public.caisse__immuable()', t);
  end loop;
end $$;

-- La facture miroir d'une vente en caisse ne se modifie ni ne se supprime.
create or replace function public.caisse__document_verrou()
returns trigger language plpgsql security definer set search_path = public as $$
declare did uuid;
begin
  did := case tg_table_name when 'document_lignes' then (to_jsonb(old)->>'document_id')::uuid else (to_jsonb(old)->>'id')::uuid end;   -- to_jsonb : une seule fonction pour deux tables
  if exists (select 1 from public.caisse_tickets t where t.document_id = did) then
    -- seule exception : la suppression d'un client (FK « on delete set null ») qui détache la fiche client de la facture
    if tg_op = 'UPDATE' and tg_table_name = 'documents' and (to_jsonb(new)->>'client_id') is null and (to_jsonb(old)->>'client_id') is not null
       and (to_jsonb(new) - 'client_id' - 'updated_at') = (to_jsonb(old) - 'client_id' - 'updated_at') then
      return new;
    end if;
    raise exception 'Ce document provient de la caisse : il est inaltérable. Pour le corriger, émettez un avoir depuis la caisse.' using errcode = 'restrict_violation';
  end if;
  return case tg_op when 'DELETE' then old else new end;
end $$;
drop trigger if exists caisse_document_verrou on public.documents;
create trigger caisse_document_verrou before update or delete on public.documents for each row execute function public.caisse__document_verrou();
drop trigger if exists caisse_document_verrou on public.document_lignes;
create trigger caisse_document_verrou before update or delete on public.document_lignes for each row execute function public.caisse__document_verrou();

-- ---------------------------------------------------------------------------------------------------------------- outils internes
create or replace function public.caisse__espace()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare e uuid;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  e := public.current_workspace_id();
  if e is null then raise exception 'Espace introuvable.'; end if;
  return e;
end $$;

create or replace function public.caisse__fmt(n numeric) returns text language sql immutable as $$ select to_char(coalesce(n, 0), 'FM999999999999990.00') $$;

-- Texte exact haché pour une entrée du journal : sert à l'écriture ET à la vérification.
create or replace function public.caisse__entree(p_prev text, p_seq bigint, p_type text, p_numero text, p_montant numeric, p_gt numeric, p_gta numeric, p_date timestamptz, p_payload jsonb)
returns text language sql immutable as $$
  select concat_ws('|', p_prev, p_seq::text, p_type, coalesce(p_numero, ''), public.caisse__fmt(p_montant), public.caisse__fmt(p_gt), public.caisse__fmt(p_gta),
                   to_char(p_date at time zone 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US'), coalesce(p_payload, '{}'::jsonb)::text)
$$;

create or replace function public.caisse__verrou(p_owner uuid)
returns public.caisse_chaine language plpgsql security definer set search_path = public, extensions as $$
declare c public.caisse_chaine;
begin
  insert into public.caisse_chaine (owner_id) values (p_owner) on conflict do nothing;
  insert into public.caisse_secrets (owner_id, cle) values (p_owner, encode(extensions.gen_random_bytes(32), 'hex')) on conflict do nothing;
  select * into c from public.caisse_chaine where owner_id = p_owner for update;
  return c;
end $$;

-- Ajoute une entrée à la chaîne (verrouille la chaîne de l'espace, donc séquentiel et sans trou).
create or replace function public.caisse__ecrire(p_owner uuid, p_type text, p_session uuid, p_ticket uuid, p_numero text, p_montant numeric, p_payload jsonb, p_gt boolean)
returns public.caisse_journal language plpgsql security definer set search_path = public, extensions as $$
declare c public.caisse_chaine; k text; t timestamptz := clock_timestamp(); h text; sig text; j public.caisse_journal;
begin
  c := public.caisse__verrou(p_owner);
  select cle into k from public.caisse_secrets where owner_id = p_owner;
  c.seq := c.seq + 1;
  if p_gt and p_montant is not null then
    c.gt_perpetuel := c.gt_perpetuel + p_montant;
    c.gt_absolu := c.gt_absolu + abs(p_montant);
  end if;
  h := encode(extensions.digest(public.caisse__entree(c.hash, c.seq, p_type, p_numero, p_montant, c.gt_perpetuel, c.gt_absolu, t, p_payload), 'sha256'), 'hex');
  sig := encode(extensions.hmac(h, k, 'sha256'), 'hex');
  insert into public.caisse_journal (owner_id, seq, type, session_id, ticket_id, numero, montant_ttc, payload, gt_perpetuel, gt_absolu, prev_hash, hash, signature, created_at, auteur)
  values (p_owner, c.seq, p_type, p_session, p_ticket, p_numero, p_montant, coalesce(p_payload, '{}'::jsonb), c.gt_perpetuel, c.gt_absolu, c.hash, h, sig, t, auth.uid())
  returning * into j;
  update public.caisse_chaine set seq = c.seq, hash = h, gt_perpetuel = c.gt_perpetuel, gt_absolu = c.gt_absolu where owner_id = p_owner;
  return j;
end $$;

-- Totaux d'un ticket : le serveur fait foi. Ventilation par taux, arrondie par taux, total = somme des parties.
create or replace function public.caisse__totaux(p_owner uuid, p_lignes jsonb, p_neg boolean)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare assuj boolean; e jsonb; norm jsonb := '[]'::jsonb; q numeric; pu numeric; tx numeric; d text; i int := 0;
        vent jsonb; tht numeric; ttva numeric;
begin
  select coalesce(assujetti_tva, false) into assuj from public.parametres_facturation where owner_id = p_owner;
  assuj := coalesce(assuj, false);
  if p_lignes is null or jsonb_typeof(p_lignes) <> 'array' or jsonb_array_length(p_lignes) not between 1 and 100 then
    raise exception 'Le ticket doit contenir entre 1 et 100 lignes.';
  end if;
  for e in select * from jsonb_array_elements(p_lignes) loop
    i := i + 1;
    d := left(btrim(coalesce(e->>'description', '')), 200);
    q := (e->>'quantite')::numeric; pu := coalesce((e->>'prix_unitaire')::numeric, 0);
    tx := case when assuj then coalesce((e->>'tva_taux')::numeric, 0) else 0 end;
    if d = '' then raise exception 'Ligne %: libellé manquant.', i; end if;
    if q is null or q = 0 or abs(q) > 10000 or (not p_neg and q < 0) or (p_neg and q > 0) then raise exception 'Ligne %: quantité invalide.', i; end if;
    if pu < 0 or pu > 100000 then raise exception 'Ligne %: prix invalide.', i; end if;
    if tx < 0 or tx > 30 then raise exception 'Ligne %: taux de TVA invalide.', i; end if;
    norm := norm || jsonb_build_array(jsonb_build_object('description', d, 'quantite', q, 'prix_unitaire', pu, 'tva_taux', tx,
      'remise_pct', coalesce((e->>'remise_pct')::numeric, 0), 'index_origine', e->'index_origine'));
  end loop;
  select coalesce(jsonb_agg(jsonb_build_object('taux', taux, 'base', round(base, 2), 'montant', round(base * taux / 100, 2)) order by taux), '[]'::jsonb),
         coalesce(sum(round(base, 2)), 0), coalesce(sum(round(base * taux / 100, 2)), 0)
    into vent, tht, ttva
    from (select (x->>'tva_taux')::numeric as taux, sum((x->>'quantite')::numeric * (x->>'prix_unitaire')::numeric) as base
            from jsonb_array_elements(norm) x group by 1) s;
  return jsonb_build_object('lignes', norm, 'total_ht', tht, 'total_tva', ttva, 'total_ttc', tht + ttva, 'ventilation', vent, 'assujetti', assuj);
end $$;

-- Vérifie et normalise les paiements ; ajuste d'un éventuel écart d'arrondi (≤ 1 centime) sur le dernier.
create or replace function public.caisse__paiements(p_paiements jsonb, p_cible numeric)
returns jsonb language plpgsql immutable set search_path = public as $$
declare e jsonb; out jsonb := '[]'::jsonb; m numeric; s numeric := 0; r numeric; md text; n int;
begin
  if p_paiements is null or jsonb_typeof(p_paiements) <> 'array' or jsonb_array_length(p_paiements) not between 1 and 6 then
    raise exception 'Indiquez au moins un moyen de paiement.';
  end if;
  for e in select * from jsonb_array_elements(p_paiements) loop
    md := e->>'mode'; m := round((e->>'montant')::numeric, 2); r := nullif(e->>'recu', '')::numeric;
    if md not in ('especes', 'carte', 'cheque', 'virement', 'autre', 'acompte') then raise exception 'Moyen de paiement inconnu.'; end if;
    if m is null or m <= 0 then raise exception 'Montant de paiement invalide.'; end if;
    if md = 'especes' and r is not null and r < m then raise exception 'Espèces reçues insuffisantes.'; end if;
    s := s + m;
    out := out || jsonb_build_array(jsonb_build_object('mode', md, 'montant', m, 'recu', case when md = 'especes' then coalesce(r, m) else null end,
                                                              'terminal_id', nullif(e->>'terminal_id', '')));
  end loop;
  if abs(s - p_cible) > 0.011 then raise exception 'Le total des paiements (%) ne correspond pas au montant du ticket (%).', s, p_cible; end if;
  if s <> p_cible then
    n := jsonb_array_length(out) - 1;
    out := jsonb_set(out, array[n::text, 'montant'], to_jsonb(((out->n->>'montant')::numeric) + (p_cible - s)));
  end if;
  return out;
end $$;

-- Empreinte du contenu d'un ticket (placée dans le journal, qui la scelle).
create or replace function public.caisse__empreinte(p_lignes jsonb, p_paiements jsonb, p_ht numeric, p_tva numeric, p_ttc numeric, p_client text)
returns text language sql immutable set search_path = public, extensions as $$
  select encode(extensions.digest(concat_ws('|', p_lignes::text, p_paiements::text, public.caisse__fmt(p_ht), public.caisse__fmt(p_tva), public.caisse__fmt(p_ttc), coalesce(p_client, '')), 'sha256'), 'hex')
$$;

create or replace function public.caisse__ticket_json(t public.caisse_tickets, j public.caisse_journal, duplicata int)
returns jsonb language sql stable set search_path = public as $$
  select jsonb_build_object(
    'ticket_id', t.id, 'numero', t.numero, 'type', t.type, 'formation', t.formation, 'date', t.date_ticket, 'client_nom', t.client_nom, 'client_id', t.client_id,
    'lignes', t.lignes, 'total_ht', t.total_ht, 'total_tva', t.total_tva, 'total_ttc', t.total_ttc, 'ventilation', t.ventilation, 'paiements', t.paiements,
    'assujetti', t.assujetti_tva, 'motif', t.motif, 'ticket_origine', t.ticket_origine, 'document_id', t.document_id,
    'origine_numero', (select o.numero from public.caisse_tickets o where o.id = t.ticket_origine),
    'journal_seq', t.journal_seq, 'hash', t.journal_hash, 'signature', j.signature, 'gt_perpetuel', j.gt_perpetuel, 'duplicata', duplicata)
$$;

-- ---------------------------------------------------------------------------------------------------------------- ouverture
create or replace function public.caisse_ouvrir(p_fond numeric)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e uuid := public.caisse__espace(); s public.caisse_sessions;
begin
  if p_fond is null or p_fond < 0 or p_fond > 100000 then raise exception 'Fond de caisse invalide.'; end if;
  perform public.caisse__verrou(e);
  if exists (select 1 from public.caisse_sessions where owner_id = e and cloturee_le is null) then raise exception 'Une caisse est déjà ouverte sur ce salon (unique).'; end if;
  insert into public.caisse_sessions (owner_id, fond_caisse, ouverte_par) values (e, round(p_fond, 2), auth.uid()) returning * into s;
  perform public.caisse__ecrire(e, 'ouverture', s.id, null, null, null, jsonb_build_object('fond_caisse', s.fond_caisse, 'ouverte_le', s.ouverte_le), false);
  return to_jsonb(s);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- vente
drop function if exists public.caisse_encaisser(uuid, uuid, jsonb, jsonb, boolean);
create or replace function public.caisse_encaisser(p_session uuid, p_client uuid, p_lignes jsonb, p_paiements jsonb, p_formation boolean default false, p_rdv uuid default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e uuid := public.caisse__espace(); c public.caisse_chaine; tot jsonb; pay jsonb; ttc numeric; n bigint; num text; tid uuid := gen_random_uuid();
        did uuid; cn text; j public.caisse_journal; t public.caisse_tickets; maintenant timestamptz := clock_timestamp(); an text; px jsonb; tp public.caisse_terminal_paiements; rv public.rendez_vous; rd public.documents; acompte numeric := 0; tdoc jsonb;
begin
  if not exists (select 1 from public.caisse_sessions s where s.id = p_session and s.owner_id = e and s.cloturee_le is null) then raise exception 'Aucune session de caisse ouverte.'; end if;
  -- Encaissement d'un rendez-vous de l'agenda : une seule fois, jamais déjà réglé en ligne ; l'acompte versé en ligne est déduit (montant lu en base).
  if p_rdv is not null then
    if coalesce(p_formation, false) then raise exception 'Le mode formation ne s''applique pas à un rendez-vous.'; end if;
    select * into rv from public.rendez_vous where id = p_rdv and owner_id = e for update;
    if rv.id is null then raise exception 'Rendez-vous introuvable.'; end if;
    if rv.caisse_ticket_id is not null then raise exception 'Ce rendez-vous a déjà été encaissé.'; end if;
    if coalesce(rv.statut, 'confirme') in ('annule', 'en_attente') then raise exception 'Ce rendez-vous n''est pas confirmé.'; end if;
    if rv.document_id is not null then
      select * into rd from public.documents where id = rv.document_id and owner_id = e;
      if rd.statut = 'paye' then raise exception 'Ce rendez-vous est déjà réglé en ligne.'; end if;
    end if;
    if rv.paiement_mode = 'sur_place' and coalesce(rv.paiement_montant, 0) > 0 and rv.reste_encaisse_le is null then acompte := round(rv.paiement_montant, 2); end if;
    if p_client is null then p_client := rv.client_id; end if;
  end if;
  if p_client is not null then select full_name into cn from public.clients where id = p_client and owner_id = e; if cn is null then p_client := null; end if; end if;
  tot := public.caisse__totaux(e, p_lignes, false);
  ttc := (tot->>'total_ttc')::numeric;
  if ttc <= 0 then raise exception 'Le total du ticket doit être positif.'; end if;
  if exists (select 1 from jsonb_array_elements(p_paiements) q where q->>'mode' = 'acompte') then raise exception 'Moyen de paiement inconnu.'; end if;
  if rd.id is not null then   -- la facture du rendez-vous est réutilisée : le ticket doit en avoir exactement le montant
    tdoc := public.caisse__totaux(e, (select jsonb_agg(jsonb_build_object('description', l.description, 'quantite', l.quantite, 'prix_unitaire', l.prix_unitaire, 'tva_taux', l.tva_taux) order by l.position)
                                         from public.document_lignes l where l.document_id = rd.id), false);
    if (tdoc->>'total_ttc')::numeric <> ttc then
      raise exception 'Le ticket doit correspondre à la facture de ce rendez-vous (% € TTC). Vendez les produits en plus dans un second ticket.', tdoc->>'total_ttc';
    end if;
  end if;
  if acompte > 0 then
    if acompte >= ttc then raise exception 'Acompte supérieur au total : rendez-vous déjà réglé.'; end if;
    p_paiements := jsonb_build_array(jsonb_build_object('mode', 'acompte', 'montant', acompte)) || p_paiements;
  end if;
  pay := public.caisse__paiements(p_paiements, ttc);
  -- Un paiement par terminal ne sert que s'il est réussi, pas déjà utilisé, du même montant, et jamais en mode formation.
  if exists (select 1 from jsonb_array_elements(pay) q where q->>'terminal_id' is not null) then
    if coalesce(p_formation, false) then raise exception 'Le terminal de paiement n''est pas utilisable en mode formation.'; end if;
    for px in select * from jsonb_array_elements(pay) loop
      if px->>'terminal_id' is not null then
        if px->>'mode' <> 'carte' then raise exception 'Un paiement terminal est un paiement par carte.'; end if;
        select * into tp from public.caisse_terminal_paiements where id = (px->>'terminal_id')::uuid and owner_id = e for update;
        if tp.id is null or tp.statut <> 'reussi' or tp.ticket_id is not null or tp.montant <> (px->>'montant')::numeric then
          raise exception 'Paiement terminal invalide ou déjà utilisé.';
        end if;
      end if;
    end loop;
    pay := (select jsonb_agg(case when q.p->>'terminal_id' is not null
                 then q.p || jsonb_build_object('reference', coalesce((select t2.transaction_code from public.caisse_terminal_paiements t2 where t2.id = (q.p->>'terminal_id')::uuid), ''),
                                                       'source', coalesce((select t3.source from public.caisse_terminal_paiements t3 where t3.id = (q.p->>'terminal_id')::uuid), 'terminal'))
                 else q.p end order by q.o) from jsonb_array_elements(pay) with ordinality as q(p, o));
  end if;
  c := public.caisse__verrou(e);
  an := to_char(maintenant at time zone 'Europe/Paris', 'YYYY');
  if coalesce(p_formation, false) then
    update public.caisse_chaine set n_formation = n_formation + 1 where owner_id = e returning n_formation into n;
    num := 'FORM-' || lpad(n::text, 6, '0');
  else
    update public.caisse_chaine set n_ticket = n_ticket + 1 where owner_id = e returning n_ticket into n;
    num := 'T-' || an || '-' || lpad(n::text, 6, '0');
    if rd.id is not null then
      did := rd.id;                                  -- pas de seconde facture : celle du rendez-vous est soldée (elle compte une seule fois dans le chiffre d'affaires)
      update public.documents set statut = 'paye' where id = did;
    else
      insert into public.documents (owner_id, type, statut, client_id, date_emission, date_echeance, notes)
      values (e, 'facture', 'paye', p_client, (maintenant at time zone 'Europe/Paris')::date, (maintenant at time zone 'Europe/Paris')::date, 'Vente en caisse ' || num) returning id into did;
      insert into public.document_lignes (document_id, description, quantite, prix_unitaire, tva_taux, position)
      select did, x->>'description', (x->>'quantite')::numeric, (x->>'prix_unitaire')::numeric, (x->>'tva_taux')::numeric, o::int
        from jsonb_array_elements(tot->'lignes') with ordinality as q(x, o);
    end if;
  end if;
  j := public.caisse__ecrire(e, case when coalesce(p_formation, false) then 'formation' else 'vente' end, p_session, tid, num, ttc,
        jsonb_build_object('empreinte', public.caisse__empreinte(tot->'lignes', pay, (tot->>'total_ht')::numeric, (tot->>'total_tva')::numeric, ttc, cn),
                           'nb_lignes', jsonb_array_length(tot->'lignes'), 'modes', (select jsonb_agg(p->>'mode') from jsonb_array_elements(pay) p)),
        not coalesce(p_formation, false));
  insert into public.caisse_tickets (id, owner_id, session_id, journal_seq, journal_hash, type, formation, numero, date_ticket, client_id, client_nom, lignes, total_ht, total_tva, total_ttc,
                                     ventilation, paiements, assujetti_tva, document_id, created_by)
  values (tid, e, p_session, j.seq, j.hash, 'vente', coalesce(p_formation, false), num, maintenant, p_client, cn, tot->'lignes', (tot->>'total_ht')::numeric, (tot->>'total_tva')::numeric, ttc,
          tot->'ventilation', pay, (tot->>'assujetti')::boolean, did, auth.uid())
  returning * into t;
  if p_rdv is not null then
    update public.rendez_vous set caisse_ticket_id = tid, reste_sur_place = 0, reste_encaisse_le = coalesce(reste_encaisse_le, now()) where id = p_rdv;
  end if;
  update public.caisse_terminal_paiements set ticket_id = tid, updated_at = now()
    where owner_id = e and id in (select (q->>'terminal_id')::uuid from jsonb_array_elements(pay) q where q->>'terminal_id' is not null);
  if not coalesce(p_formation, false) then
    insert into public.caisse_paiements (owner_id, session_id, document_id, ticket_id, mode, montant, recu)
    select e, p_session, did, tid, p->>'mode', (p->>'montant')::numeric, nullif(p->>'recu', '')::numeric from jsonb_array_elements(pay) p;
  end if;
  return public.caisse__ticket_json(t, j, 0);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- avoir
-- p_selection : null = tout ce qui reste à rembourser ; sinon [{ "index": 1, "quantite": 1 }, ...] (index = rang de la ligne du ticket d'origine, à partir de 1).
create or replace function public.caisse_avoir(p_ticket uuid, p_selection jsonb, p_motif text, p_paiements jsonb)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e uuid := public.caisse__espace(); o public.caisse_tickets; sess uuid; tot jsonb; pay jsonb; ttc numeric; n bigint; num text; tid uuid := gen_random_uuid(); did uuid; j public.caisse_journal;
        t public.caisse_tickets; maintenant timestamptz := clock_timestamp(); lignes jsonb := '[]'::jsonb; l jsonb; i int := 0; deja numeric; reste numeric; dmd numeric; sel jsonb; motif text := btrim(coalesce(p_motif, ''));
begin
  select * into o from public.caisse_tickets where id = p_ticket and owner_id = e and type = 'vente' and not formation;
  if o.id is null then raise exception 'Ticket introuvable.'; end if;
  if length(motif) < 3 or length(motif) > 200 then raise exception 'Indiquez le motif de l''avoir (3 à 200 caractères).'; end if;
  select id into sess from public.caisse_sessions where owner_id = e and cloturee_le is null;
  if sess is null then raise exception 'Aucune session de caisse ouverte.'; end if;
  perform public.caisse__verrou(e);
  for l in select * from jsonb_array_elements(o.lignes) loop
    i := i + 1;
    select coalesce(sum(abs((a->>'quantite')::numeric)), 0) into deja
      from public.caisse_tickets av, jsonb_array_elements(av.lignes) a where av.ticket_origine = o.id and (a->>'index_origine')::int = i;
    reste := (l->>'quantite')::numeric - deja;
    if p_selection is null then dmd := reste;
    else
      select (s->>'quantite')::numeric into dmd from jsonb_array_elements(p_selection) s where (s->>'index')::int = i limit 1;
      dmd := coalesce(dmd, 0);
    end if;
    if dmd < 0 or dmd > reste then raise exception 'Ligne %: on ne peut pas rembourser plus que ce qui reste (%).', i, reste; end if;
    if dmd > 0 then lignes := lignes || jsonb_build_array(l || jsonb_build_object('quantite', -dmd, 'index_origine', i)); end if;
  end loop;
  if jsonb_array_length(lignes) = 0 then raise exception 'Rien à rembourser sur ce ticket.'; end if;
  tot := public.caisse__totaux(e, lignes, true);
  ttc := (tot->>'total_ttc')::numeric;           -- négatif
  -- un seul moyen sans montant : il porte tout le remboursement
  if jsonb_typeof(p_paiements) = 'array' and jsonb_array_length(p_paiements) = 1 and (p_paiements->0->>'montant') is null then
    p_paiements := jsonb_build_array(jsonb_build_object('mode', p_paiements->0->>'mode', 'montant', -ttc));
  end if;
  pay := public.caisse__paiements(p_paiements, -ttc);
  update public.caisse_chaine set n_avoir = n_avoir + 1 where owner_id = e returning n_avoir into n;
  num := 'AV-' || to_char(maintenant at time zone 'Europe/Paris', 'YYYY') || '-' || lpad(n::text, 6, '0');
  insert into public.documents (owner_id, type, statut, client_id, date_emission, date_echeance, converted_from, notes)
  values (e, 'facture', 'paye', o.client_id, (maintenant at time zone 'Europe/Paris')::date, (maintenant at time zone 'Europe/Paris')::date, o.document_id, 'Avoir ' || num || ' sur ticket ' || o.numero || ' : ' || motif) returning id into did;
  insert into public.document_lignes (document_id, description, quantite, prix_unitaire, tva_taux, position)
  select did, x->>'description', (x->>'quantite')::numeric, (x->>'prix_unitaire')::numeric, (x->>'tva_taux')::numeric, k::int
    from jsonb_array_elements(tot->'lignes') with ordinality as q(x, k);
  j := public.caisse__ecrire(e, 'avoir', sess, tid, num, ttc,
        jsonb_build_object('empreinte', public.caisse__empreinte(tot->'lignes', pay, (tot->>'total_ht')::numeric, (tot->>'total_tva')::numeric, ttc, o.client_nom),
                           'ticket_origine', o.numero, 'motif', motif), true);
  insert into public.caisse_tickets (id, owner_id, session_id, journal_seq, journal_hash, type, numero, date_ticket, client_id, client_nom, lignes, total_ht, total_tva, total_ttc, ventilation,
                                     paiements, assujetti_tva, document_id, ticket_origine, motif, created_by)
  values (tid, e, sess, j.seq, j.hash, 'avoir', num, maintenant, o.client_id, o.client_nom, tot->'lignes', (tot->>'total_ht')::numeric, (tot->>'total_tva')::numeric, ttc, tot->'ventilation',
          pay, (tot->>'assujetti')::boolean, did, o.id, motif, auth.uid())
  returning * into t;
  insert into public.caisse_paiements (owner_id, session_id, document_id, ticket_id, mode, montant, recu)
  select e, sess, did, tid, p->>'mode', -(p->>'montant')::numeric, null from jsonb_array_elements(pay) p;
  return public.caisse__ticket_json(t, j, 0);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- duplicata
create or replace function public.caisse_duplicata(p_ticket uuid)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e uuid := public.caisse__espace(); t public.caisse_tickets; j public.caisse_journal; n int;
begin
  select * into t from public.caisse_tickets where id = p_ticket and owner_id = e;
  if t.id is null then raise exception 'Ticket introuvable.'; end if;
  select count(*) + 1 into n from public.caisse_journal where owner_id = e and type = 'duplicata' and ticket_id = t.id;
  j := public.caisse__ecrire(e, 'duplicata', t.session_id, t.id, t.numero, null, jsonb_build_object('rang', n), false);
  select * into j from public.caisse_journal where owner_id = e and seq = t.journal_seq;   -- le ticket affiche la signature de sa propre vente
  return public.caisse__ticket_json(t, j, n);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- clôture Z
create or replace function public.caisse__agregat(p_owner uuid, p_filtre_session uuid, p_debut timestamptz, p_fin timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare r jsonb;
begin
  select jsonb_build_object(
    'nb_ventes',  count(*) filter (where type = 'vente'),
    'nb_avoirs',  count(*) filter (where type = 'avoir'),
    'total_ht',   coalesce(sum(total_ht), 0), 'total_tva', coalesce(sum(total_tva), 0), 'total_ttc', coalesce(sum(total_ttc), 0),
    'premier_ticket', min(numero) filter (where type = 'vente'), 'dernier_ticket', max(numero) filter (where type = 'vente'))
  into r from public.caisse_tickets
  where owner_id = p_owner and not formation and (p_filtre_session is null or session_id = p_filtre_session) and (p_debut is null or date_ticket >= p_debut) and (p_fin is null or date_ticket < p_fin);
  r := r || jsonb_build_object(
    'ventilation_tva', coalesce((select jsonb_agg(jsonb_build_object('taux', taux, 'base', round(base, 2), 'montant', round(montant, 2)) order by taux)
        from (select (v->>'taux')::numeric taux, sum((v->>'base')::numeric) base, sum((v->>'montant')::numeric) montant
                from public.caisse_tickets t, jsonb_array_elements(t.ventilation) v
               where t.owner_id = p_owner and not t.formation and (p_filtre_session is null or t.session_id = p_filtre_session)
                 and (p_debut is null or t.date_ticket >= p_debut) and (p_fin is null or t.date_ticket < p_fin) group by 1) q), '[]'::jsonb),
    'par_mode', coalesce((select jsonb_object_agg(mode, m) from (select p.mode, round(sum(p.montant), 2) m from public.caisse_paiements p
               join public.caisse_tickets t on t.id = p.ticket_id
               where p.owner_id = p_owner and (p_filtre_session is null or p.session_id = p_filtre_session)
                 and (p_debut is null or t.date_ticket >= p_debut) and (p_fin is null or t.date_ticket < p_fin) group by p.mode) z), '{}'::jsonb),
    'nb_formation', (select count(*) from public.caisse_tickets t where t.owner_id = p_owner and t.formation and (p_filtre_session is null or t.session_id = p_filtre_session)
                       and (p_debut is null or t.date_ticket >= p_debut) and (p_fin is null or t.date_ticket < p_fin)));
  return r;
end $$;

create or replace function public.caisse_cloturer(p_session uuid, p_comptees numeric, p_notes text default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e uuid := public.caisse__espace(); s public.caisse_sessions; agg jsonb; especes numeric; attendues numeric; v_ecart numeric; n bigint; maintenant timestamptz := clock_timestamp();
        v_rapport jsonb; j public.caisse_journal; assuj boolean;
begin
  select * into s from public.caisse_sessions where id = p_session and owner_id = e and cloturee_le is null;
  if s.id is null then raise exception 'Aucune session de caisse ouverte.'; end if;
  if p_comptees is null or p_comptees < 0 then raise exception 'Comptez les espèces du tiroir avant de clôturer.'; end if;
  perform public.caisse__verrou(e);
  agg := public.caisse__agregat(e, s.id, null, null);
  especes := coalesce((agg->'par_mode'->>'especes')::numeric, 0);
  attendues := s.fond_caisse + especes;
  v_ecart := round(p_comptees - attendues, 2);
  select coalesce(assujetti_tva, false) into assuj from public.parametres_facturation where owner_id = e;
  update public.caisse_chaine set n_z = n_z + 1 where owner_id = e returning n_z into n;
  v_rapport := agg || jsonb_build_object('numero_z', 'Z-' || lpad(n::text, 6, '0'), 'fond_caisse', s.fond_caisse, 'especes_attendues', round(attendues, 2), 'especes_comptees', round(p_comptees, 2),
              'ecart', v_ecart, 'ouverte_le', s.ouverte_le, 'cloturee_le', maintenant, 'assujetti_tva', coalesce(assuj, false));
  j := public.caisse__ecrire(e, 'cloture_z', s.id, null, v_rapport->>'numero_z', (agg->>'total_ttc')::numeric, v_rapport, false);
  v_rapport := v_rapport || jsonb_build_object('gt_perpetuel', j.gt_perpetuel, 'gt_absolu', j.gt_absolu, 'journal_seq', j.seq, 'hash', j.hash, 'signature', j.signature);
  update public.caisse_sessions set cloturee_le = maintenant, cloturee_par = auth.uid(), especes_comptees = round(p_comptees, 2), ecart = v_ecart, notes = left(p_notes, 500), rapport = v_rapport where id = s.id;
  return v_rapport;
end $$;

-- Clôture mensuelle ou annuelle : fige les totaux d'une période révolue (toutes sessions closes), une seule fois par période.
create or replace function public.caisse_cloturer_periode(p_type text, p_annee int, p_mois int default null)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e uuid := public.caisse__espace(); d0 timestamptz; d1 timestamptz; per text; agg jsonb; j public.caisse_journal; nbs int; payload jsonb;
begin
  if p_type not in ('mensuelle', 'annuelle') then raise exception 'Type de clôture inconnu.'; end if;
  if p_type = 'mensuelle' then
    if p_mois is null or p_mois not between 1 and 12 then raise exception 'Mois invalide.'; end if;
    d0 := make_timestamptz(p_annee, p_mois, 1, 0, 0, 0, 'Europe/Paris'); d1 := d0 + interval '1 month';
    per := p_annee || '-' || lpad(p_mois::text, 2, '0');
  else
    d0 := make_timestamptz(p_annee, 1, 1, 0, 0, 0, 'Europe/Paris'); d1 := d0 + interval '1 year'; per := p_annee::text;
  end if;
  if d1 > now() then raise exception 'La période % n''est pas terminée.', per; end if;
  perform public.caisse__verrou(e);
  if exists (select 1 from public.caisse_journal where owner_id = e and type = 'cloture_' || p_type and payload->>'periode' = per) then raise exception 'La période % est déjà clôturée.', per; end if;
  if exists (select 1 from public.caisse_sessions where owner_id = e and cloturee_le is null and ouverte_le < d1) then raise exception 'Une session de caisse est encore ouverte : clôturez-la d''abord.'; end if;
  agg := public.caisse__agregat(e, null, d0, d1);
  select count(*) into nbs from public.caisse_sessions where owner_id = e and cloturee_le >= d0 and cloturee_le < d1;
  payload := agg || jsonb_build_object('periode', per, 'type', p_type, 'nb_sessions', nbs, 'debut', d0, 'fin', d1);
  j := public.caisse__ecrire(e, 'cloture_' || p_type, null, null, per, (agg->>'total_ttc')::numeric, payload, false);
  return payload || jsonb_build_object('gt_perpetuel', j.gt_perpetuel, 'journal_seq', j.seq, 'hash', j.hash, 'signature', j.signature);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- vérification et archive
create or replace function public.caisse_verifier()
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e uuid := public.caisse__espace(); k text; r public.caisse_journal; prev text := 'GENESIS'; attendu bigint := 1; h text; gt numeric := 0; gta numeric := 0; nb bigint := 0;
        defaut jsonb := null; c public.caisse_chaine; somme numeric; nt bigint; na bigint; ok boolean;
begin
  select cle into k from public.caisse_secrets where owner_id = e;
  for r in select * from public.caisse_journal where owner_id = e order by seq loop
    nb := nb + 1;
    if r.seq <> attendu then defaut := jsonb_build_object('seq', attendu, 'raison', 'Entrée manquante dans la séquence'); exit; end if;
    if r.prev_hash <> prev then defaut := jsonb_build_object('seq', r.seq, 'raison', 'La chaîne est rompue (empreinte précédente différente)'); exit; end if;
    if r.type in ('vente', 'avoir') then gt := gt + r.montant_ttc; gta := gta + abs(r.montant_ttc); end if;
    if r.gt_perpetuel <> gt or r.gt_absolu <> gta then defaut := jsonb_build_object('seq', r.seq, 'raison', 'Grand total incohérent'); exit; end if;
    h := encode(extensions.digest(public.caisse__entree(r.prev_hash, r.seq, r.type, r.numero, r.montant_ttc, r.gt_perpetuel, r.gt_absolu, r.created_at, r.payload), 'sha256'), 'hex');
    if h <> r.hash then defaut := jsonb_build_object('seq', r.seq, 'raison', 'Le contenu a été modifié (empreinte différente)'); exit; end if;
    if encode(extensions.hmac(h, k, 'sha256'), 'hex') <> r.signature then defaut := jsonb_build_object('seq', r.seq, 'raison', 'Signature invalide'); exit; end if;
    prev := r.hash; attendu := attendu + 1;
  end loop;
  select * into c from public.caisse_chaine where owner_id = e;
  if defaut is null and c.owner_id is not null and (c.seq <> attendu - 1 or c.hash <> prev) then defaut := jsonb_build_object('seq', c.seq, 'raison', 'Le journal ne correspond pas à la chaîne enregistrée (entrées supprimées ?)'); end if;
  -- tickets : numérotation continue et lien avec le journal
  select count(*) filter (where type = 'vente' and not formation), count(*) filter (where type = 'avoir'), coalesce(sum(total_ttc) filter (where not formation), 0)
    into nt, na, somme from public.caisse_tickets where owner_id = e;
  if defaut is null and c.owner_id is not null and (c.n_ticket <> nt or c.n_avoir <> na) then defaut := jsonb_build_object('seq', null, 'raison', 'Numérotation des tickets non continue (ticket manquant)'); end if;
  if defaut is null and c.owner_id is not null and somme <> c.gt_perpetuel then defaut := jsonb_build_object('seq', null, 'raison', 'La somme des tickets ne correspond pas au grand total perpétuel'); end if;
  if defaut is null and exists (select 1 from public.caisse_tickets t left join public.caisse_journal q on q.owner_id = t.owner_id and q.seq = t.journal_seq and q.hash = t.journal_hash where t.owner_id = e and q.id is null) then
    defaut := jsonb_build_object('seq', null, 'raison', 'Un ticket n''est plus relié au journal');
  end if;
  ok := defaut is null;
  return jsonb_build_object('ok', ok, 'entrees', nb, 'defaut', defaut, 'gt_perpetuel', coalesce(c.gt_perpetuel, 0), 'gt_absolu', coalesce(c.gt_absolu, 0), 'tickets', nt, 'avoirs', na, 'verifie_le', now());
end $$;

-- Archive d'une période (JSON) : journal, tickets, clôtures, résultat de la vérification, empreinte globale. À télécharger et conserver 6 ans.
create or replace function public.caisse_archiver(p_debut date, p_fin date)
returns jsonb language plpgsql security definer set search_path = public, extensions as $$
declare e uuid := public.caisse__espace(); d0 timestamptz; d1 timestamptz; jr jsonb; tk jsonb; ss jsonb; ver jsonb; corps jsonb; emp text;
begin
  if p_debut is null or p_fin is null or p_fin < p_debut or p_fin - p_debut > 366 then raise exception 'Période invalide (366 jours au plus).'; end if;
  d0 := make_timestamptz(extract(year from p_debut)::int, extract(month from p_debut)::int, extract(day from p_debut)::int, 0, 0, 0, 'Europe/Paris');
  d1 := make_timestamptz(extract(year from p_fin)::int, extract(month from p_fin)::int, extract(day from p_fin)::int, 0, 0, 0, 'Europe/Paris') + interval '1 day';
  ver := public.caisse_verifier();
  select coalesce(jsonb_agg(to_jsonb(q) order by q.seq), '[]'::jsonb) into jr from (select seq, type, numero, montant_ttc, payload, gt_perpetuel, gt_absolu, prev_hash, hash, signature, created_at
    from public.caisse_journal where owner_id = e and created_at >= d0 and created_at < d1) q;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.date_ticket), '[]'::jsonb) into tk from (select numero, type, formation, date_ticket, client_nom, lignes, total_ht, total_tva, total_ttc, ventilation, paiements,
    ticket_origine, motif, journal_seq, journal_hash from public.caisse_tickets where owner_id = e and date_ticket >= d0 and date_ticket < d1) q;
  select coalesce(jsonb_agg(to_jsonb(q) order by q.ouverte_le), '[]'::jsonb) into ss from (select ouverte_le, cloturee_le, fond_caisse, especes_comptees, ecart, rapport
    from public.caisse_sessions where owner_id = e and ouverte_le >= d0 and ouverte_le < d1) q;
  corps := jsonb_build_object('format', 'mirrio-caisse-archive-1', 'espace', e, 'debut', p_debut, 'fin', p_fin, 'genere_le', now(), 'verification', ver, 'journal', jr, 'tickets', tk, 'sessions', ss);
  -- L'empreinte du fichier est scellée dans le journal chaîné : elle donne date certaine à l'archive et permet de prouver plus tard qu'elle n'a pas changé.
  emp := encode(extensions.digest(corps::text, 'sha256'), 'hex');
  perform public.caisse__ecrire(e, 'archive', null, null, null, null, jsonb_build_object('debut', p_debut, 'fin', p_fin, 'nb_entrees', jsonb_array_length(jr), 'nb_tickets', jsonb_array_length(tk), 'empreinte', emp), false);
  return corps || jsonb_build_object('empreinte', emp);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- terminal : lecture sans secret
create or replace function public.caisse_terminal_statut()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e uuid := public.caisse__espace(); c public.caisse_terminal_config; lien boolean;
begin
  select exists (select 1 from public.parametres_paiement where owner_id = e and stripe_actif and stripe_secret_key is not null) into lien;
  select * into c from public.caisse_terminal_config where owner_id = e;
  if c.owner_id is null then return jsonb_build_object('configure', false, 'reader_pret', false, 'lien_pret', lien); end if;
  return jsonb_build_object('configure', true, 'reader_pret', c.reader_id is not null, 'reader_name', c.reader_name, 'merchant_code', c.merchant_code, 'app_id', c.app_id, 'lien_pret', lien);
end $$;

create or replace function public.caisse_terminal_lire(p_id uuid)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e uuid := public.caisse__espace(); p public.caisse_terminal_paiements;
begin
  select * into p from public.caisse_terminal_paiements where id = p_id and owner_id = e;
  if p.id is null then raise exception 'Paiement introuvable.'; end if;
  return jsonb_build_object('statut', p.statut, 'montant', p.montant, 'reference', p.transaction_code, 'utilise', p.ticket_id is not null);
end $$;

-- Paiements réussis sur le terminal mais jamais rattachés à une vente (3 derniers jours) : à régulariser, ils ont été débités.
create or replace function public.caisse_terminal_orphelins()
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e uuid := public.caisse__espace();
begin
  return coalesce((select jsonb_agg(jsonb_build_object('id', id, 'montant', montant, 'reference', transaction_code, 'date', created_at) order by created_at desc)
                     from public.caisse_terminal_paiements where owner_id = e and statut = 'reussi' and ticket_id is null and created_at > now() - interval '3 days'), '[]'::jsonb);
end $$;

-- ---------------------------------------------------------------------------------------------------------------- droits d'exécution
do $$
declare f text;
begin
  foreach f in array array[
    'caisse__espace()', 'caisse__verrou(uuid)', 'caisse__ecrire(uuid,text,uuid,uuid,text,numeric,jsonb,boolean)', 'caisse__totaux(uuid,jsonb,boolean)',
    'caisse__paiements(jsonb,numeric)', 'caisse__agregat(uuid,uuid,timestamptz,timestamptz)'] loop
    execute format('revoke all on function public.%s from public, anon, authenticated', f);
  end loop;
  foreach f in array array[
    'caisse_ouvrir(numeric)', 'caisse_encaisser(uuid,uuid,jsonb,jsonb,boolean,uuid)', 'caisse_avoir(uuid,jsonb,text,jsonb)', 'caisse_duplicata(uuid)', 'caisse_cloturer(uuid,numeric,text)',
    'caisse_cloturer_periode(text,int,int)', 'caisse_verifier()', 'caisse_archiver(date,date)',
    'caisse_terminal_statut()', 'caisse_terminal_lire(uuid)', 'caisse_terminal_orphelins()'] loop
    execute format('revoke all on function public.%s from public, anon', f);
    execute format('grant execute on function public.%s to authenticated', f);
  end loop;
end $$;
