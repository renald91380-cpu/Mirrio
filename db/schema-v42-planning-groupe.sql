-- Planning du groupe : voir ensemble le planning de plusieurs salons (comme des agendas partagés superposés) et y ajouter ou annuler un rendez-vous à distance
-- (client venu sur place ou au téléphone). Réservé au propriétaire du groupe et à ses gestionnaires : les trois fonctions passent par mes_salons() (schema-v38),
-- donc elles ne voient jamais d'autres salons que ceux de l'appelant. security definer parce que les policies RLS ne donnent accès qu'à l'espace actif.
-- Sûr à rejouer en entier. À exécuter après schema-v41-forfaits-solo-equipe.sql.

-- Planning des salons de l'appelant entre deux dates (43 jours au plus) : horaires, équipe, prestations et rendez-vous non annulés de chaque salon.
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

-- Ajoute un rendez-vous confirmé dans l'un de MES salons (client venu sur place ou au téléphone). Crée la fiche client si elle n'existe pas.
-- Refuse un chevauchement avec la même personne (ou un rendez-vous non attribué) sauf si p_forcer est vrai.
create or replace function public.groupe_ajouter_rdv(
  p_salon uuid, p_debut timestamptz, p_fin timestamptz, p_titre text, p_intervenant uuid, p_prestation uuid,
  p_client_nom text, p_client_tel text, p_notes text, p_forcer boolean default false)
returns uuid language plpgsql security definer set search_path = public as $$
declare cid uuid; rid uuid; nom text := nullif(trim(p_client_nom), ''); tel text := nullif(trim(p_client_tel), '');
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  if not exists (select 1 from public.mes_salons() m where m.id = p_salon) then raise exception 'Salon introuvable.'; end if;
  if p_fin <= p_debut or p_fin - p_debut > interval '12 hours' then raise exception 'Horaire invalide.'; end if;
  if p_intervenant is not null and not exists (select 1 from public.vitrine_equipe e where e.id = p_intervenant and e.owner_id = p_salon) then
    raise exception 'Cette personne ne fait pas partie de ce salon.';
  end if;
  if p_prestation is not null and not exists (select 1 from public.prestations z where z.id = p_prestation and z.owner_id = p_salon) then
    raise exception 'Cette prestation ne fait pas partie de ce salon.';
  end if;
  if not coalesce(p_forcer, false) and exists (
    select 1 from public.rendez_vous r
    where r.owner_id = p_salon and coalesce(r.statut, 'confirme') <> 'annule' and r.date_debut < p_fin and r.date_fin > p_debut
      and (p_intervenant is null or r.intervenant_id is null or r.intervenant_id = p_intervenant)) then
    raise exception 'Ce créneau chevauche un autre rendez-vous.' using errcode = 'unique_violation';
  end if;
  if nom is not null then
    select c.id into cid from public.clients c
      where c.owner_id = p_salon and lower(c.full_name) = lower(nom) and (tel is null or c.phone is null or c.phone = tel) limit 1;
    if cid is null then insert into public.clients (owner_id, full_name, phone) values (p_salon, nom, tel) returning id into cid; end if;
  end if;
  insert into public.rendez_vous (owner_id, client_id, titre, date_debut, date_fin, statut, notes, prestation_id, intervenant_id)
  values (p_salon, cid, coalesce(nullif(trim(p_titre), ''), 'Rendez-vous'), p_debut, p_fin, 'confirme', nullif(trim(p_notes), ''), p_prestation, p_intervenant)
  returning id into rid;
  return rid;
end $$;

-- Annule un rendez-vous d'un de MES salons (statut « annule » : jamais supprimé, comme dans l'agenda d'un salon).
create or replace function public.groupe_annuler_rdv(p_rdv uuid)
returns void language plpgsql security definer set search_path = public as $$
begin
  if auth.uid() is null then raise exception 'Connexion requise.'; end if;
  update public.rendez_vous r set statut = 'annule'
    where r.id = p_rdv and r.owner_id in (select m.id from public.mes_salons() m);
  if not found then raise exception 'Rendez-vous introuvable.'; end if;
end $$;
