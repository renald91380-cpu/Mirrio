-- Statistiques et commissions par personne de l'équipe (grandes équipes).
--   * `caisse_tickets.intervenant_id` (schema-v43) : la personne qui a réalisé la vente (choisie en caisse, ou reprise du rendez-vous) ;
--     les avoirs héritent de la personne du ticket d'origine, donc le chiffre d'affaires d'une personne est net des remboursements.
--   * `equipe_remuneration` : taux de commission par personne (prestations et produits), lisibles par les responsables seulement.
--   * `stats_equipe(debut, fin)` : par personne, rendez-vous, minutes réservées, chiffre d'affaires HT prestations et produits, tickets ; plus les horaires et absences
--     pour que l'écran calcule le taux de remplissage. Responsables seulement. Tickets de formation exclus.
-- Sûr à rejouer en entier. À exécuter après schema-v46-absences.sql.

create table if not exists public.equipe_remuneration (
  intervenant_id             uuid primary key references public.vitrine_equipe(id) on delete cascade,
  owner_id                   uuid not null,
  commission_prestations_pct numeric not null default 0 check (commission_prestations_pct >= 0 and commission_prestations_pct <= 100),
  commission_produits_pct    numeric not null default 0 check (commission_produits_pct >= 0 and commission_produits_pct <= 100)
);
alter table public.equipe_remuneration enable row level security;
drop policy if exists "Rémunération : les responsables la gèrent" on public.equipe_remuneration;
create policy "Rémunération : les responsables la gèrent" on public.equipe_remuneration for all
  using (owner_id = public.current_workspace_id() and public.est_manager()) with check (owner_id = public.current_workspace_id() and public.est_manager());

create or replace function public.stats_equipe(p_debut date, p_fin date)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare e uuid := public.current_workspace_id(); d0 timestamptz; d1 timestamptz; membres jsonb; non_attr jsonb; hor jsonb; abs_ jsonb;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if not public.est_manager() then raise exception 'Réservé au responsable du salon.' using errcode = 'insufficient_privilege'; end if;
  if p_debut is null or p_fin is null or p_fin < p_debut or p_fin - p_debut > 400 then raise exception 'Période invalide (400 jours au plus).'; end if;
  d0 := make_timestamptz(extract(year from p_debut)::int, extract(month from p_debut)::int, extract(day from p_debut)::int, 0, 0, 0, 'Europe/Paris');
  d1 := make_timestamptz(extract(year from p_fin)::int, extract(month from p_fin)::int, extract(day from p_fin)::int, 0, 0, 0, 'Europe/Paris') + interval '1 day';

  select coalesce(jsonb_agg(jsonb_build_object(
      'id', m.id, 'nom', m.nom, 'role', m.role, 'jours_ouvres', to_jsonb(m.jours_ouvres), 'heure_debut', m.heure_debut, 'heure_fin', m.heure_fin,
      'nb_rdv', coalesce(r.nb, 0), 'minutes_rdv', coalesce(r.minutes, 0),
      'nb_tickets', coalesce(t.nb, 0), 'ca_prestations_ht', coalesce(t.presta, 0), 'ca_produits_ht', coalesce(t.produits, 0),
      'commission_prestations_pct', coalesce(rem.commission_prestations_pct, 0), 'commission_produits_pct', coalesce(rem.commission_produits_pct, 0)
    ) order by m.position), '[]'::jsonb) into membres
  from public.vitrine_equipe m
  left join public.equipe_remuneration rem on rem.intervenant_id = m.id
  left join lateral (select count(*) nb, coalesce(sum(extract(epoch from (x.date_fin - x.date_debut)) / 60), 0) minutes from public.rendez_vous x
                      where x.owner_id = e and x.intervenant_id = m.id and coalesce(x.statut, 'confirme') not in ('annule', 'en_attente') and x.date_debut >= d0 and x.date_debut < d1) r on true
  left join lateral (select count(*) filter (where k.type = 'vente') nb,
                            coalesce(sum(case when coalesce(l->>'type', 'prestation') = 'produit' then 0 else (l->>'quantite')::numeric * (l->>'prix_unitaire')::numeric end), 0) presta,
                            coalesce(sum(case when coalesce(l->>'type', 'prestation') = 'produit' then (l->>'quantite')::numeric * (l->>'prix_unitaire')::numeric else 0 end), 0) produits
                       from public.caisse_tickets k, jsonb_array_elements(k.lignes) l
                      where k.owner_id = e and not k.formation and k.intervenant_id = m.id and k.date_ticket >= d0 and k.date_ticket < d1) t on true
  where m.owner_id = e;

  select jsonb_build_object(
      'nb_tickets', count(*) filter (where k.type = 'vente'),
      'ca_prestations_ht', coalesce(sum(case when coalesce(l->>'type', 'prestation') = 'produit' then 0 else (l->>'quantite')::numeric * (l->>'prix_unitaire')::numeric end), 0),
      'ca_produits_ht', coalesce(sum(case when coalesce(l->>'type', 'prestation') = 'produit' then (l->>'quantite')::numeric * (l->>'prix_unitaire')::numeric else 0 end), 0))
    into non_attr
    from public.caisse_tickets k, jsonb_array_elements(k.lignes) l
   where k.owner_id = e and not k.formation and k.intervenant_id is null and k.date_ticket >= d0 and k.date_ticket < d1;

  select jsonb_build_object('jours', to_jsonb(pr.jours_ouvres), 'debut', pr.heure_debut, 'fin', pr.heure_fin) into hor from public.parametres_reservation pr where pr.owner_id = e;
  select coalesce(jsonb_agg(jsonb_build_object('intervenant_id', a.intervenant_id, 'debut', a.debut, 'fin', a.fin)), '[]'::jsonb) into abs_
    from public.absences a where a.owner_id = e and a.debut < d1 and a.fin > d0;
  return jsonb_build_object('debut', p_debut, 'fin', p_fin, 'membres', membres, 'non_attribue', coalesce(non_attr, '{}'::jsonb), 'salon', hor, 'absences', abs_);
end $$;
revoke all on function public.stats_equipe(date, date) from public, anon;
grant execute on function public.stats_equipe(date, date) to authenticated;
