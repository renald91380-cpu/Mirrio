-- Mirrio — import de données depuis un ancien logiciel (fichiers CSV) : clients, factures et devis historiques.
-- Sûr à rejouer en entier. À exécuter après schema-v50-durcissement.sql.
--
-- Principes :
--  * Réservé aux responsables (propriétaire, gestionnaire de groupe, manager) : un import écrit en masse dans l'espace.
--  * Un document importé est une pièce d'HISTORIQUE : il garde son numéro d'origine, n'entre JAMAIS dans le journal inaltérable
--    de la caisse (ce n'est pas une vente passée sur Mirrio Caisse), et ne déclenche aucune relance automatique
--    (nombre_relances posé à 99, le cron ne cible que < 3).
--  * Rejouer le même fichier ne crée aucun doublon (références uniques par espace).
--  * Chaque import est tracé dans `imports` (qui, quand, source, combien).

alter table public.clients add column if not exists ref_externe text;
alter table public.clients add column if not exists source_import text;
alter table public.clients add column if not exists importe_le timestamptz;
create unique index if not exists clients_ref_externe_uq on public.clients (owner_id, ref_externe) where ref_externe is not null;

alter table public.documents add column if not exists ref_externe text;
alter table public.documents add column if not exists source_import text;
alter table public.documents add column if not exists importe_le timestamptz;
create unique index if not exists documents_ref_externe_uq on public.documents (owner_id, type, ref_externe) where ref_externe is not null;

create table if not exists public.imports (
  id          uuid primary key default gen_random_uuid(),
  owner_id    uuid not null,
  par         uuid default auth.uid(),
  nature      text not null check (nature in ('clients', 'documents', 'prestations')),
  source      text check (source is null or length(source) <= 60),
  fichier     text check (fichier is null or length(fichier) <= 200),
  nb_lignes   int not null default 0,
  nb_crees    int not null default 0,
  nb_completes int not null default 0,
  nb_ignores  int not null default 0,
  nb_erreurs  int not null default 0,
  cree_le     timestamptz not null default now()
);
alter table public.imports enable row level security;
drop policy if exists "L'espace voit ses imports" on public.imports;
create policy "L'espace voit ses imports" on public.imports for select using (owner_id = public.current_workspace_id());
-- Aucune policy d'écriture : seules les fonctions ci-dessous (security definer) écrivent.

create or replace function public.import__espace()
returns uuid language plpgsql stable security definer set search_path = public as $$
declare e uuid := public.current_workspace_id();
begin
  if auth.uid() is null or e is null then raise exception 'Connexion requise.' using errcode = 'insufficient_privilege'; end if;
  if not public.est_manager() then raise exception 'Réservé au responsable du salon.' using errcode = 'insufficient_privilege'; end if;
  return e;
end $$;

create or replace function public.import__chiffres(t text)
returns text language sql immutable as $$ select regexp_replace(coalesce(t, ''), '\D', '', 'g') $$;

-- ------------------------------------------------------------------------------------------------------------ clients
-- p_lignes : [{ref, nom, email, telephone, societe, notes, allergies}] (500 au plus par appel).
-- p_mode : 'ignorer' (un client déjà connu est laissé tel quel) ou 'completer' (ses champs VIDES sont remplis, rien n'est écrasé).
-- Un client est « déjà connu » s'il a la même référence, le même e-mail ou le même téléphone (chiffres seuls).
create or replace function public.importer_clients(p_source text, p_fichier text, p_lignes jsonb, p_mode text default 'ignorer')
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e uuid := public.import__espace();
  l jsonb; i int := 0;
  v_nom text; v_mail text; v_tel text; v_ref text; v_id uuid;
  crees int := 0; completes int := 0; ignores int := 0; erreurs jsonb := '[]'::jsonb;
begin
  if jsonb_typeof(p_lignes) <> 'array' then raise exception 'Format invalide.'; end if;
  if jsonb_array_length(p_lignes) > 500 then raise exception '500 lignes au plus par envoi.'; end if;
  if p_mode not in ('ignorer', 'completer') then raise exception 'Mode invalide.'; end if;

  for l in select * from jsonb_array_elements(p_lignes) loop
    i := i + 1;
    v_nom := nullif(btrim(left(l->>'nom', 200)), '');
    v_mail := nullif(lower(btrim(left(l->>'email', 200))), '');
    v_tel := nullif(btrim(left(l->>'telephone', 40)), '');
    v_ref := nullif(btrim(left(l->>'ref', 100)), '');
    if v_nom is null then
      erreurs := erreurs || jsonb_build_object('ligne', i, 'message', 'Nom manquant.'); continue;
    end if;
    if v_mail is not null and v_mail !~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_mail := null; end if;

    v_id := null;
    if v_ref is not null then select c.id into v_id from public.clients c where c.owner_id = e and c.ref_externe = v_ref limit 1; end if;
    if v_id is null and v_mail is not null then select c.id into v_id from public.clients c where c.owner_id = e and lower(c.email) = v_mail limit 1; end if;
    if v_id is null and length(public.import__chiffres(v_tel)) >= 9 then
      select c.id into v_id from public.clients c
       where c.owner_id = e and right(public.import__chiffres(c.phone), 9) = right(public.import__chiffres(v_tel), 9) limit 1;
    end if;

    if v_id is null then
      insert into public.clients (owner_id, full_name, email, phone, company, notes, allergies, ref_externe, source_import, importe_le)
      values (e, v_nom, v_mail, v_tel, nullif(btrim(left(l->>'societe', 200)), ''), nullif(btrim(left(l->>'notes', 4000)), ''),
              nullif(btrim(left(l->>'allergies', 500)), ''), v_ref, left(p_source, 60), now());
      crees := crees + 1;
    elsif p_mode = 'completer' then
      update public.clients c set
        email = coalesce(nullif(c.email, ''), v_mail),
        phone = coalesce(nullif(c.phone, ''), v_tel),
        company = coalesce(nullif(c.company, ''), nullif(btrim(left(l->>'societe', 200)), '')),
        notes = coalesce(nullif(c.notes, ''), nullif(btrim(left(l->>'notes', 4000)), '')),
        allergies = coalesce(nullif(c.allergies, ''), nullif(btrim(left(l->>'allergies', 500)), '')),
        ref_externe = coalesce(c.ref_externe, case when v_ref is not null and not exists (select 1 from public.clients z where z.owner_id = e and z.ref_externe = v_ref) then v_ref end)
      where c.id = v_id;
      completes := completes + 1;
    else
      ignores := ignores + 1;
    end if;
  end loop;

  insert into public.imports (owner_id, nature, source, fichier, nb_lignes, nb_crees, nb_completes, nb_ignores, nb_erreurs)
  values (e, 'clients', left(p_source, 60), left(p_fichier, 200), i, crees, completes, ignores, jsonb_array_length(erreurs));
  return jsonb_build_object('crees', crees, 'completes', completes, 'ignores', ignores, 'erreurs', erreurs);
end $$;

-- ------------------------------------------------------------------------------------------------------------ documents
-- p_docs : [{numero, type, date, echeance, statut, client_ref, client_nom, client_email, notes,
--            lignes:[{description, quantite, prix_unitaire (HT), tva_taux}]}] (100 au plus par appel, 200 lignes par document).
-- Le numéro d'origine est conservé tel quel. Le client est retrouvé par référence, e-mail ou nom exact ; s'il n'existe pas il est créé
-- (nom seul) afin que l'historique reste rattaché. Statut inconnu = 'paye' pour une facture, 'accepte' pour un devis.
create or replace function public.importer_documents(p_source text, p_fichier text, p_docs jsonb)
returns jsonb language plpgsql security definer set search_path = public as $$
declare
  e uuid := public.import__espace();
  d jsonb; ln jsonb; i int := 0; pos int;
  v_type text; v_num text; v_statut text; v_ref text; v_client uuid; v_nom text; v_mail text; v_cref text;
  v_date date; v_ech date; v_doc uuid; v_an int; v_n int; m text[];
  crees int := 0; ignores int := 0; erreurs jsonb := '[]'::jsonb; clients_crees int := 0;
begin
  if jsonb_typeof(p_docs) <> 'array' then raise exception 'Format invalide.'; end if;
  if jsonb_array_length(p_docs) > 100 then raise exception '100 documents au plus par envoi.'; end if;

  for d in select * from jsonb_array_elements(p_docs) loop
    i := i + 1;
    v_type := case lower(coalesce(d->>'type', 'facture')) when 'devis' then 'devis' else 'facture' end;
    v_num := nullif(btrim(left(d->>'numero', 60)), '');
    if v_num is null then erreurs := erreurs || jsonb_build_object('ligne', i, 'message', 'Numéro manquant.'); continue; end if;
    if jsonb_typeof(d->'lignes') <> 'array' or jsonb_array_length(d->'lignes') = 0 then
      erreurs := erreurs || jsonb_build_object('ligne', i, 'message', 'Aucune ligne pour ' || v_num || '.'); continue;
    end if;
    if jsonb_array_length(d->'lignes') > 200 then erreurs := erreurs || jsonb_build_object('ligne', i, 'message', 'Plus de 200 lignes pour ' || v_num || '.'); continue; end if;
    begin v_date := (d->>'date')::date; exception when others then v_date := null; end;
    if v_date is null then erreurs := erreurs || jsonb_build_object('ligne', i, 'message', 'Date illisible pour ' || v_num || '.'); continue; end if;
    begin v_ech := (d->>'echeance')::date; exception when others then v_ech := null; end;

    v_ref := v_num;
    if exists (select 1 from public.documents x where x.owner_id = e and x.type = v_type and (x.ref_externe = v_ref or x.numero = v_num)) then
      ignores := ignores + 1; continue;
    end if;

    v_statut := lower(coalesce(d->>'statut', ''));
    if v_statut not in ('brouillon', 'envoye', 'accepte', 'paye', 'en_retard', 'refuse') then
      v_statut := case v_type when 'devis' then 'accepte' else 'paye' end;
    end if;
    if v_type = 'devis' and v_statut = 'paye' then v_statut := 'accepte'; end if;

    -- client
    v_client := null;
    v_cref := nullif(btrim(left(d->>'client_ref', 100)), '');
    v_nom := nullif(btrim(left(d->>'client_nom', 200)), '');
    v_mail := nullif(lower(btrim(left(d->>'client_email', 200))), '');
    if v_cref is not null then select c.id into v_client from public.clients c where c.owner_id = e and c.ref_externe = v_cref limit 1; end if;
    if v_client is null and v_mail is not null then select c.id into v_client from public.clients c where c.owner_id = e and lower(c.email) = v_mail limit 1; end if;
    if v_client is null and v_nom is not null then select c.id into v_client from public.clients c where c.owner_id = e and lower(c.full_name) = lower(v_nom) limit 1; end if;
    if v_client is null and v_nom is not null then
      insert into public.clients (owner_id, full_name, email, ref_externe, source_import, importe_le)
      values (e, v_nom, case when v_mail ~ '^[^@\s]+@[^@\s]+\.[^@\s]+$' then v_mail end, v_cref, left(p_source, 60), now())
      returning id into v_client;
      clients_crees := clients_crees + 1;
    end if;

    insert into public.documents (owner_id, client_id, type, numero, statut, date_emission, date_echeance, notes, ref_externe, source_import, importe_le, nombre_relances)
    values (e, v_client, v_type, v_num, v_statut, v_date, v_ech,
            left(concat_ws(E'\n', 'Document importé de ' || coalesce(nullif(left(p_source, 60), ''), 'un ancien logiciel') || '.', nullif(btrim(left(d->>'notes', 2000)), '')), 2500),
            v_ref, left(p_source, 60), now(), 99)
    returning id into v_doc;

    pos := 0;
    for ln in select * from jsonb_array_elements(d->'lignes') loop
      pos := pos + 1;
      insert into public.document_lignes (document_id, description, quantite, prix_unitaire, tva_taux, position)
      values (v_doc, coalesce(nullif(btrim(left(ln->>'description', 500)), ''), 'Prestation'),
              coalesce(nullif(ln->>'quantite', '')::numeric, 1), coalesce(nullif(ln->>'prix_unitaire', '')::numeric, 0),
              coalesce(nullif(ln->>'tva_taux', '')::numeric, 0), pos);
    end loop;

    -- Le compteur de numérotation ne doit jamais redonner un numéro déjà importé (ex. FAC-2025-041 importé : la 42e sera la prochaine).
    m := regexp_match(v_num, '^(?:DEV|FAC)-(\d{4})-(\d+)$');
    if m is not null then
      v_an := m[1]::int; v_n := m[2]::int;
      insert into public.document_counters (owner_id, type, year, last_number) values (e, v_type, v_an, v_n)
      on conflict (owner_id, type, year) do update set last_number = greatest(public.document_counters.last_number, excluded.last_number);
    end if;
    crees := crees + 1;
  end loop;

  insert into public.imports (owner_id, nature, source, fichier, nb_lignes, nb_crees, nb_ignores, nb_erreurs)
  values (e, 'documents', left(p_source, 60), left(p_fichier, 200), i, crees, ignores, jsonb_array_length(erreurs));
  return jsonb_build_object('crees', crees, 'ignores', ignores, 'clients_crees', clients_crees, 'erreurs', erreurs);
exception when others then
  -- Une erreur imprévue annule tout l'envoi (transaction) plutôt que de laisser un import à moitié fait.
  raise exception 'Import annulé : %', sqlerrm;
end $$;

-- Journal des imports pour l'écran (les 20 derniers).
create or replace function public.imports_recents()
returns setof public.imports language sql stable security definer set search_path = public as $$
  select * from public.imports where owner_id = public.current_workspace_id() and public.est_manager() order by cree_le desc limit 20
$$;

-- Les fonctions d'import ne sont pas appelables sans connexion.
revoke all on function public.importer_clients(text, text, jsonb, text) from public, anon;
revoke all on function public.importer_documents(text, text, jsonb) from public, anon;
revoke all on function public.imports_recents() from public, anon;
revoke all on function public.import__espace() from public, anon, authenticated;
grant execute on function public.importer_clients(text, text, jsonb, text) to authenticated;
grant execute on function public.importer_documents(text, text, jsonb) to authenticated;
grant execute on function public.imports_recents() to authenticated;
