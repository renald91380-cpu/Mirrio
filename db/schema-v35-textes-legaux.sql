-- Textes légaux (CGU, politique de confidentialité) modifiables depuis le back-office admin.
-- Lecture publique (les pages cgu.html / confidentialite.html les affichent sans connexion),
-- écriture réservée à profiles.is_admin via admin_est_admin() (schema-v4-admin.sql).
-- Tant qu'une ligne est absente ou vide, les pages gardent leur texte statique d'origine.
-- Sûr à rejouer en entier.

create table if not exists public.textes_legaux (
  slug         text primary key check (slug in ('cgu', 'confidentialite')),
  contenu_html text not null check (length(contenu_html) between 1 and 200000),
  maj_le       timestamptz not null default now(),
  maj_par      uuid references auth.users(id) on delete set null
);

alter table public.textes_legaux enable row level security;

drop policy if exists "Lecture publique des textes légaux" on public.textes_legaux;
create policy "Lecture publique des textes légaux" on public.textes_legaux
  for select using (true);

drop policy if exists "Un admin écrit les textes légaux" on public.textes_legaux;
create policy "Un admin écrit les textes légaux" on public.textes_legaux
  for all using (public.admin_est_admin()) with check (public.admin_est_admin());

create or replace function public.textes_legaux_horodatage()
returns trigger language plpgsql as $$
begin
  new.maj_le := now();
  new.maj_par := auth.uid();
  return new;
end $$;

drop trigger if exists textes_legaux_horodatage on public.textes_legaux;
create trigger textes_legaux_horodatage
  before insert or update on public.textes_legaux
  for each row execute function public.textes_legaux_horodatage();
