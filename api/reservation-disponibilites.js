// Mirrio — lecture publique des disponibilités d'un praticien, pour le
// widget de réservation en ligne (site/reservation.html).
//
//   GET /api/reservation-disponibilites?slug=<slug>
//   GET /api/reservation-disponibilites?slug=<slug>&prestation_id=<uuid>&date=YYYY-MM-DD
//
// Le `slug` est un identifiant PUBLIC choisi par le praticien (comme un nom
// d'utilisateur) — à la différence de `calendar_feeds.token` ou
// `documents.partage_token` (jetons-capacité opaques), une page de
// réservation est faite pour être diffusée, pas gardée secrète. Voir
// db/schema-v6-reservation-en-ligne.sql et CLAUDE.md.
//
// Premier appel (slug seul) : informations publiques du praticien, ses
// prestations actives, et ses réglages — sert à peindre l'écran de choix de
// prestation et à calculer côté client les jours potentiellement ouvrables.
// Deuxième appel (+ prestation_id + date) : la liste des créneaux réellement
// libres ce jour-là pour la durée de cette prestation. Ne renvoie JAMAIS les
// rendez-vous existants du praticien — seulement quels créneaux restent
// libres, pour ne jamais exposer son agenda à un inconnu.
//
// Zéro dépendance npm, comme le reste de api/.
//
// Variables d'environnement attendues :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import annuaire from './_annuaire.js';
import avis from './_avis.js';
import rdvIcs from './_rdv-ics.js';
import vitrine from './_vitrine.js';
import client from './_client.js';
import gateaux from './_gateaux.js';
import sitemap from './_sitemap.js';
import { contexte, occupes, creneauxDuJour, composantsParis, parisVersUtc, get as getDispo, chargerCreux, remiseCreux, chargerTarifs } from './_dispo.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, statut, corps){
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(corps));
}

async function supabase(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

// ------------------------------------------------------------------ requête

// Plan Vercel Hobby : 12 fonctions serverless maximum par déploiement. Les
// routes publiques /api/annuaire, /api/avis, /api/vitrine et /api/rendez-vous-ics sont donc
// servies par CETTE fonction (réécritures dans vercel.json → ?action=…) ;
// leur code vit dans api/_annuaire.js, _avis.js et _rdv-ics.js (le préfixe `_`
// les exclut du décompte). Ne pas recréer de fichier de route dans api/ sans
// en retirer un autre.
const ACTIONS = { annuaire, avis, ics: rdvIcs, vitrine, client, gateaux, sitemap };

export default async function handler(req, res){
  const action = new URL(req.url, 'http://x').searchParams.get('action');
  if(action && ACTIONS[action]) return ACTIONS[action](req, res);

  if(req.method !== 'GET'){
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète.' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const slug = url.searchParams.get('slug') || '';
  // Une ou plusieurs prestations, séparées par des virgules (ex. « Coupe +
  // Couleur » choisies ensemble) — la durée du créneau proposé est la somme
  // de toutes. `prestation_id` (singulier) reste accepté pour rétrocompat
  // d'un éventuel appel externe déjà en place, les deux se rejoignent dans
  // la même liste.
  const prestationIdsParam = url.searchParams.get('prestation_ids') || url.searchParams.get('prestation_id') || '';
  const prestationIds = prestationIdsParam.split(',').map(s => s.trim()).filter(Boolean);
  const dateStr = url.searchParams.get('date') || '';

  if(!/^[a-z0-9-]{3,40}$/.test(slug)){
    return json(res, 404, { error: 'Page de réservation introuvable.' });
  }

  let reglages;
  try{
    reglages = await supabase(
      `parametres_reservation?slug=eq.${slug}&activee=eq.true&select=owner_id,jours_ouvres,heure_debut,heure_fin,intervalle_minutes,delai_min_heures,horizon_jours`
    );
  }catch(e){
    return json(res, 503, { error: 'Page de réservation temporairement indisponible.' });
  }
  const reglage = reglages[0];
  // Ne jamais distinguer « slug inconnu » de « réservation désactivée » : même
  // message générique dans les deux cas.
  if(!reglage){
    return json(res, 404, { error: 'Page de réservation introuvable.' });
  }
  const ownerId = reglage.owner_id;

  // -------------------------------------------------- appel « créneaux » / « jours »
  // - `date=YYYY-MM-DD` : les créneaux libres de ce jour.
  // - `jours=1`         : les jours de tout l'horizon qui ont AU MOINS un créneau
  //                       (la page n'affiche le calendrier que s'il en reste).
  // `intervenant` = id d'un membre de l'équipe, ou `any` (premier disponible).
  const modeJours = url.searchParams.get('jours') === '1';
  if(prestationIds.length || dateStr || modeJours){
    const idValide = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if(!prestationIds.length || !prestationIds.every(idValide)){
      return json(res, 400, { error: 'Prestation invalide.' });
    }
    const intervenantId = url.searchParams.get('intervenant') || 'any';
    if(intervenantId !== 'any' && !idValide(intervenantId)){
      return json(res, 400, { error: 'Intervenant invalide.' });
    }

    let ctx;
    try{
      ctx = await contexte(ownerId, reglage, prestationIds);
    }catch(e){
      return json(res, 503, { error: 'Page de réservation temporairement indisponible.' });
    }
    if(ctx.prestations.length !== prestationIds.length){
      return json(res, 404, { error: 'Prestation introuvable.' });
    }
    // Personne n'assure TOUTES ces prestations ensemble, ou la personne choisie ne le peut pas :
    // inutile d'afficher un calendrier.
    if(!ctx.solo && !ctx.eligibles.length){
      return json(res, 200, { date: dateStr || null, creneaux: [], jours: [], raison: 'aucun_intervenant' });
    }
    if(!ctx.solo && intervenantId !== 'any' && !ctx.eligibles.some(i => i.id === intervenantId)){
      return json(res, 200, { date: dateStr || null, creneaux: [], jours: [], raison: 'intervenant_indisponible' });
    }

    if(modeJours){
      const { annee: a0, mois: m0, jour: j0 } = composantsParis(new Date());
      const horizon = reglage.horizon_jours || 30;
      const debutReq = new Date(parisVersUtc(a0, m0, j0, 0, 0).getTime() - 12 * 3600000).toISOString();
      const finReq = new Date(parisVersUtc(a0, m0, j0 + horizon + 1, 24, 0).getTime() + 12 * 3600000).toISOString();
      let busy;
      try{ busy = await occupes(ownerId, debutReq, finReq); }
      catch(e){ return json(res, 503, { error: 'Page de réservation temporairement indisponible.' }); }
      const jours = [];
      for(let i = 0; i <= horizon; i++){
        const d = new Date(Date.UTC(a0, m0 - 1, j0 + i));
        const c = { annee: d.getUTCFullYear(), mois: d.getUTCMonth() + 1, jour: d.getUTCDate() };
        if(creneauxDuJour(ctx, busy, c, intervenantId).length) jours.push(d.toISOString().slice(0, 10));
      }
      return json(res, 200, { jours, raison: jours.length ? null : 'complet' });
    }

    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if(!m){
      return json(res, 400, { error: 'Date invalide.' });
    }
    const annee = Number(m[1]), mois = Number(m[2]), jour = Number(m[3]);
    // Fenêtre large (±12h) pour attraper tout rendez-vous qui chevauche la journée civile.
    const debutRequete = new Date(parisVersUtc(annee, mois, jour, 0, 0).getTime() - 12 * 3600000).toISOString();
    const finRequete = new Date(parisVersUtc(annee, mois, jour, 24, 0).getTime() + 12 * 3600000).toISOString();
    let busy;
    try{ busy = await occupes(ownerId, debutRequete, finRequete); }
    catch(e){ return json(res, 503, { error: 'Page de réservation temporairement indisponible.' }); }

    const creneaux = creneauxDuJour(ctx, busy, { annee, mois, jour }, intervenantId).map(c => c.iso);
    // Heures creuses : les créneaux concernés portent une remise, affichée avant la réservation (le serveur recalcule au paiement).
    const creux = await chargerCreux(ownerId);
    const enPromo = creux ? creneaux.filter(iso => remiseCreux(creux, new Date(iso)) > 0) : [];
    return json(res, 200, { date: dateStr, creneaux, promo: enPromo.length ? { pourcentage: creux.pourcentage, creneaux: enPromo } : null });
  }

  // -------------------------------------------------- appel « bootstrap »
  let profils, prestations, paiements, vitrines;
  try{
    [profils, prestations, paiements, vitrines] = await Promise.all([
      supabase(`profiles?id=eq.${ownerId}&select=business_name,full_name,logo_url,accent,metier,terme_singulier,terme_pluriel`),
      // `public_cible`/`categorie` : schema-v17. Repli sans ces colonnes tant que la migration n'est pas passée.
      supabase(`prestations?owner_id=eq.${ownerId}&actif=eq.true&select=id,libelle,description,prix_unitaire,tva_taux,duree_minutes,public_cible,categorie&order=position`)
        .catch(() => supabase(`prestations?owner_id=eq.${ownerId}&actif=eq.true&select=id,libelle,description,prix_unitaire,tva_taux,duree_minutes&order=position`)),
      // Phase 3 : le widget doit savoir AVANT de soumettre le formulaire si un
      // paiement immédiat va être exigé (prix plein) pour confirmer le
      // créneau — voir api/reservation-publique.js et CLAUDE.md.
      // `especes_actif`/`acompte_*` : schema-v19, repli sur l'ancien select tant que la migration manque.
      supabase(`parametres_paiement?owner_id=eq.${ownerId}&select=stripe_actif,stripe_secret_key,especes_actif,acompte_minimum,acompte_pourcentage`)
        .catch(() => supabase(`parametres_paiement?owner_id=eq.${ownerId}&select=stripe_actif,stripe_secret_key`)),
      // Style choisi dans « Ma page » (schema-v18) : la réservation prolonge la vitrine. Vide si absent.
      supabase(`vitrine?owner_id=eq.${ownerId}&select=couleur,fond,police,boutons`).catch(() => [])
    ]);
  }catch(e){
    return json(res, 503, { error: 'Page de réservation temporairement indisponible.' });
  }
  // Équipe réservable et affectations (schema-v20) : absentes = salon seul.
  let intervenants = [], affectations = [], validationAuto = true;
  try{
    intervenants = await getDispo(`vitrine_equipe?owner_id=eq.${ownerId}&reservable=eq.true&select=id,nom,role,photo_url&order=position`);
    if(intervenants.length) affectations = await getDispo(`prestation_intervenants?owner_id=eq.${ownerId}&select=prestation_id,intervenant_id`);
    const v = await getDispo(`parametres_reservation?owner_id=eq.${ownerId}&select=validation_auto`);
    if(v[0] && v[0].validation_auto === false) validationAuto = false;
  }catch(e){ /* migration v20 pas encore passée */ }
  // Pour chaque prestation : les personnes qui l'assurent (une personne sans affectation assure tout).
  const parIntervenant = {};
  affectations.forEach(a => { (parIntervenant[a.intervenant_id] = parIntervenant[a.intervenant_id] || new Set()).add(a.prestation_id); });
  prestations = prestations.map(p => ({ ...p, intervenants: intervenants.filter(i => !parIntervenant[i.id] || parIntervenant[i.id].has(p.id)).map(i => i.id) }));

  const creuxActif = await chargerCreux(ownerId);
  const tarifs = await chargerTarifs(ownerId);
  // WhatsApp du salon (schema-v26, facultatif) : bouton « Une question ? » sur la page de confirmation.
  const whatsapp = await getDispo(`vitrine?owner_id=eq.${ownerId}&select=whatsapp`).then(l => l[0]?.whatsapp || null).catch(() => null);
  const profil = profils[0] || {};
  const paiement = paiements[0];
  const paiementRequis = !!(paiement?.stripe_actif && paiement?.stripe_secret_key);

  return json(res, 200, {
    praticien: {
      business_name: profil.business_name || profil.full_name || 'Mirrio',
      logo_url: profil.logo_url || null,
      accent: profil.accent || 'ambre',
      metier: profil.metier || 'autre',
      terme_singulier: profil.terme_singulier || null,
      terme_pluriel: profil.terme_pluriel || null
    },
    style: vitrines[0] || {},
    intervenants,
    validation_auto: validationAuto,
    prestations,
    paiement_requis: paiementRequis,
    whatsapp,
    // Heures creuses (schema-v24) : null si le salon n'en propose pas.
    creux: creuxActif ? { pourcentage: creuxActif.pourcentage, jours: creuxActif.jours, debut: String(creuxActif.debut).slice(0, 5), fin: String(creuxActif.fin).slice(0, 5) } : null,
    // Tarifs enfant et étudiant (schema-v34) : null = non proposé par ce salon.
    tarifs,
    // Choix proposé au client : CB (total en ligne) ou espèces (acompte en ligne, solde au salon).
    paiement: {
      en_ligne: paiementRequis,
      especes: paiement?.especes_actif !== false,
      acompte_minimum: Math.max(5, Number(paiement?.acompte_minimum ?? 5)),
      acompte_pourcentage: Number(paiement?.acompte_pourcentage ?? 0)
    },
    reglages: {
      jours_ouvres: reglage.jours_ouvres,
      heure_debut: reglage.heure_debut,
      heure_fin: reglage.heure_fin,
      delai_min_heures: reglage.delai_min_heures,
      horizon_jours: reglage.horizon_jours
    }
  });
}
