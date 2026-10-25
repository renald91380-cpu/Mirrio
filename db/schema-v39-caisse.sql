-- Caisse enregistreuse (caisse.html) : sessions de caisse (ouverture, fond de caisse, clôture « Z ») et paiements encaissés.
--
-- Une vente en caisse EST une facture payée : elle passe par `documents` / `document_lignes` (numérotation légale automatique, export comptable,
-- relances exclues puisque payée). Les tables ci-dessous ne portent que ce qui est propre à la caisse : le moyen de paiement, l'espèces reçu
-- et rendu, et la session. Tout est scopé par owner_id = current_workspace_id() (un salon = un espace, voir §3.3 et §3.36).
--
-- Inaltérabilité (esprit de la loi anti-fraude à la TVA, SANS certification NF525, voir CLAUDE.md §3.37) : `caisse_paiements` n'a ni policy
-- de modification ni de suppression (insert et select seulement) ; une session clôturée ne peut plus être modifiée (trigger) ; le rapport de
-- clôture est figé en jsonb à la clôture. Sûr à rejouer en entier. À exécuter après schema-v38-multi-salons.sql.

create table if not exists public.caisse_sessions (
  id               uuid primary key default gen_random_uuid(),
  owner_id         uuid not null,
  ouverte_le       timestamptz not null default now(),
  ouverte_par      uuid references auth.users(id) on delete set null default auth.uid(),
  fond_caisse      numeric(12,2) not null default 0 check (fond_caisse >= 0),
  cloturee_le      timestamptz,
  cloturee_par     uuid references auth.users(id) on delete set null,
  especes_comptees numeric(12,2) check (especes_comptees >= 0),
  ecart            numeric(12,2),
  notes            text check (length(notes) <= 500),
  rapport          jsonb
);
create index if not exists caisse_sessions_owner on public.caisse_sessions(owner_id, ouverte_le desc);
-- Une seule session ouverte à la fois par espace.
create unique index if not exists caisse_session_ouverte_unique on public.caisse_sessions(owner_id) where cloturee_le is null;

create table if not exists public.caisse_paiements (
  id           uuid primary key default gen_random_uuid(),
  owner_id     uuid not null,
  session_id   uuid not null references public.caisse_sessions(id) on delete restrict,
  document_id  uuid not null references public.documents(id) on delete restrict,
  mode         text not null check (mode in ('especes', 'carte', 'cheque', 'virement', 'autre')),
  montant      numeric(12,2) not null check (montant > 0),          -- part de la vente réglée par ce moyen
  recu         numeric(12,2) check (recu >= 0),                      -- espèces tendues par le client (rendu = recu - montant)
  created_at   timestamptz not null default now(),
  created_by   uuid references auth.users(id) on delete set null default auth.uid()
);
create index if not exists caisse_paiements_session on public.caisse_paiements(session_id);
create index if not exists caisse_paiements_document on public.caisse_paiements(document_id);

alter table public.caisse_sessions enable row level security;
alter table public.caisse_paiements enable row level security;

drop policy if exists "Caisse : sessions de l'espace" on public.caisse_sessions;
create policy "Caisse : sessions de l'espace" on public.caisse_sessions for all
  using (owner_id = public.current_workspace_id()) with check (owner_id = public.current_workspace_id());

drop policy if exists "Caisse : lire les paiements de l'espace" on public.caisse_paiements;
create policy "Caisse : lire les paiements de l'espace" on public.caisse_paiements for select using (owner_id = public.current_workspace_id());
drop policy if exists "Caisse : enregistrer un paiement dans l'espace" on public.caisse_paiements;
create policy "Caisse : enregistrer un paiement dans l'espace" on public.caisse_paiements for insert with check (owner_id = public.current_workspace_id());
-- Pas de policy update/delete : un paiement enregistré ne se modifie ni ne se supprime.

-- Une session clôturée est figée ; on ne peut clôturer qu'une session ouverte, et seulement ajouter la clôture.
create or replace function public.caisse_session_figee()
returns trigger language plpgsql as $$
begin
  if tg_op = 'DELETE' then raise exception 'Une session de caisse ne se supprime pas.'; end if;
  if old.cloturee_le is not null then raise exception 'Cette session de caisse est clôturée.'; end if;
  if new.owner_id <> old.owner_id or new.ouverte_le <> old.ouverte_le or new.fond_caisse <> old.fond_caisse then
    raise exception 'L''ouverture d''une session ne se modifie pas.';
  end if;
  return new;
end $$;
drop trigger if exists caisse_session_figee on public.caisse_sessions;
create trigger caisse_session_figee before update or delete on public.caisse_sessions for each row execute function public.caisse_session_figee();

-- Un paiement ne s'enregistre que sur une session OUVERTE de son espace et sur un document de ce même espace.
create or replace function public.caisse_paiement_coherent()
returns trigger language plpgsql as $$
begin
  if not exists (select 1 from public.caisse_sessions s where s.id = new.session_id and s.owner_id = new.owner_id and s.cloturee_le is null) then
    raise exception 'Aucune session de caisse ouverte.';
  end if;
  if not exists (select 1 from public.documents d where d.id = new.document_id and d.owner_id = new.owner_id) then
    raise exception 'Document introuvable.';
  end if;
  return new;
end $$;
drop trigger if exists caisse_paiement_coherent on public.caisse_paiements;
create trigger caisse_paiement_coherent before insert on public.caisse_paiements for each row execute function public.caisse_paiement_coherent();
