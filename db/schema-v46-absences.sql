-- Congés et absences par personne (vitrine_equipe) : une absence bloque la personne sur la période, pour la réservation en ligne comme pour l'agenda.
-- Une absence est une plage de dates et d'heures (journée entière = de minuit à minuit, heure de Paris). Lecture pour tout l'espace, écriture pour les responsables.
-- Le planning du groupe (schema-v42) reçoit aussi les absences. Sûr à rejouer en entier. À exécuter après schema-v45-equipes-roles.sql.

create table if not exists public.absences (
  id              uuid primary key default gen_random_uuid(),
  owner_id        uuid not null,
  intervenant_id  uuid not null references public.vitrine_equipe(id) on delete cascade,
  debut           timestamptz not null,
  fin             timestamptz not null,
  motif           text check (motif is null or length(motif) <= 80),
  created_at      timestamptz not null default now(),
  check (fin > debut and fin - debut <= interval '400 days')
);
create index if not exists absences_owner on public.absences(owner_id, debut);
alter table public.absences enable row level security;
drop policy if exists "Absences : lire celles de l'espace" on public.absences;
create policy "Absences : lire celles de l'espace" on public.absences for select using (owner_id = public.current_workspace_id());
drop policy if exists "Absences : les responsables les gèrent" on public.absences;
create policy "Absences : les responsables les gèrent" on public.absences for all
  using (owner_id = public.current_workspace_id() and public.est_manager()) with check (owner_id = public.current_workspace_id() and public.est_manager());

-- Planning du groupe : on ajoute les absences de chaque salon (les rendez-vous, l'équipe, les prestations et les horaires restent identiques à schema-v42).
create or replace function public.groupe_planning(p_debut timestamptz, p_fin timestamptz)
returns jsonb language plpgsql stable security definer set search_path = public as $$
declare res jsonb;
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if p_fin <= p_debut or p_fin - p_debut > interval '43 days' then raise exception 'Période invalide (43 jours au plus).'; end if;
  select coalesce(jsonb_agg(q.x order by q.ord, q.nom), '[]'::jsonb) into res
  from (
    select m.nom as nom, (case when m.principal then 0 else 1 end) as ord,
      jsonb_build_object(
        'id', m.id, 'nom', m.nom, 'ville', m.ville, 'principal', m.principal,
        'horaires', (select jsonb_build_object('jours', to_jsonb(pr.jours_ouvres), 'debut', pr.heure_debut, 'fin', pr.heure_fin)
                     from public.parametres_reservation pr where pr.owner_id = m.id),
        'equipe', coalesce((select jsonb_agg(jsonb_build_object('id', e.id, 'nom', e.nom) order by e.position)
                            from public.vitrine_equipe e where e.owner_id = m.id), '[]'::jsonb),
        'prestations', coalesce((select jsonb_agg(jsonb_build_object('id', z.id, 'libelle', z.libelle, 'duree_minutes', z.duree_minutes) order by z.position)
                                 from public.prestations z where z.owner_id = m.id and z.actif), '[]'::jsonb),
        'absences', coalesce((select jsonb_agg(jsonb_build_object('id', a.id, 'intervenant_id', a.intervenant_id, 'debut', a.debut, 'fin', a.fin, 'motif', a.motif) order by a.debut)
                              from public.absences a where a.owner_id = m.id and a.debut < p_fin and a.fin > p_debut), '[]'::jsonb),
        'rdv', coalesce((select jsonb_agg(jsonb_build_object('id', r.id, 'titre', r.titre, 'debut', r.date_debut, 'fin', r.date_fin,
                                                             'statut', coalesce(r.statut, 'confirme'), 'intervenant_id', r.intervenant_id,
                                                             'client', c.full_name, 'telephone', c.phone) order by r.date_debut)
                         from public.rendez_vous r left join public.clients c on c.id = r.client_id
                         where r.owner_id = m.id and coalesce(r.statut, 'confirme') <> 'annule' and r.date_debut < p_fin and r.date_fin > p_debut), '[]'::jsonb)
      ) as x
    from public.mes_salons() m
  ) q;
  return jsonb_build_object('salons', res);
end $$;
