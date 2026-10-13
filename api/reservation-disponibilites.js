// Cadence — lecture publique des disponibilités d'un praticien, pour le
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

// ------------------------------------------------------------ fuseau horaire
// Convertit une heure murale Europe/Paris (année, mois 1-12, jour, heure,
// minute) en instant UTC réel, en tenant compte du changement d'heure
// CET/CEST — sans librairie. On lit le décalage réellement en vigueur à cet
// instant via Intl.DateTimeFormat, puis on corrige. Suffisant ici : les
// horaires d'ouverture d'un praticien ne chevauchent jamais 2h-3h du matin,
// le seul moment où un changement d'heure pourrait fausser la correction.
function decalageMinutes(date){
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit'
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  const commeUtc = Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second);
  return Math.round((commeUtc - date.getTime()) / 60000);
}

function parisVersUtc(annee, mois, jour, heure, minute){
  const approx = new Date(Date.UTC(annee, mois - 1, jour, heure, minute));
  const decalage = decalageMinutes(approx);
  return new Date(approx.getTime() - decalage * 60000);
}

// ------------------------------------------------------------------ requête

// Plan Vercel Hobby : 12 fonctions serverless maximum par déploiement. Les
// routes publiques /api/annuaire, /api/avis et /api/rendez-vous-ics sont donc
// servies par CETTE fonction (réécritures dans vercel.json → ?action=…) ;
// leur code vit dans api/_annuaire.js, _avis.js et _rdv-ics.js (le préfixe `_`
// les exclut du décompte). Ne pas recréer de fichier de route dans api/ sans
// en retirer un autre.
const ACTIONS = { annuaire, avis, ics: rdvIcs };

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

  // -------------------------------------------------- appel « par jour »
  if(prestationIds.length || dateStr){
    const idValide = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
    if(!prestationIds.length || !prestationIds.every(idValide)){
      return json(res, 400, { error: 'Prestation invalide.' });
    }
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateStr);
    if(!m){
      return json(res, 400, { error: 'Date invalide.' });
    }
    const [, aStr, mStr, jStr] = m;
    const annee = Number(aStr), mois = Number(mStr), jour = Number(jStr);

    let prestations;
    try{
      prestations = await supabase(
        `prestations?id=in.(${prestationIds.join(',')})&owner_id=eq.${ownerId}&actif=eq.true&select=id,duree_minutes`
      );
    }catch(e){
      return json(res, 503, { error: 'Page de réservation temporairement indisponible.' });
    }
    if(prestations.length !== prestationIds.length){
      return json(res, 404, { error: 'Prestation introuvable.' });
    }
    // Durée totale = somme des prestations choisies — c'est elle qui
    // détermine la longueur du créneau proposé, pas chaque prestation prise
    // isolément.
    const dureeMinutesTotale = prestations.reduce((s, p) => s + (Number(p.duree_minutes) || 0), 0);
    const prestation = { duree_minutes: dureeMinutesTotale };

    // Jour de la semaine au format Date.getDay() (0=dimanche…6=samedi) — un
    // jour civil n'a pas d'ambiguïté de fuseau, contrairement à une heure.
    const jourSemaine = new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay();
    if(!(reglage.jours_ouvres || []).includes(jourSemaine)){
      return json(res, 200, { date: dateStr, creneaux: [] });
    }

    const maintenant = Date.now();
    const auPlusTot = maintenant + (reglage.delai_min_heures || 0) * 3600000;
    const auPlusTard = maintenant + (reglage.horizon_jours || 0) * 86400000;

    const [hDebutH, hDebutM] = String(reglage.heure_debut).split(':').map(Number);
    const [hFinH, hFinM] = String(reglage.heure_fin).split(':').map(Number);
    const minDebut = hDebutH * 60 + hDebutM;
    const minFin = hFinH * 60 + hFinM;
    const intervalle = reglage.intervalle_minutes || 30;
    const dureeMs = prestation.duree_minutes * 60000;

    // Fenêtre large (±12h) pour attraper tout rendez-vous qui chevauche cette
    // journée civile même s'il déborde sur la veille ou le lendemain, quel
    // que soit le fuseau dans lequel il a été enregistré.
    const debutFenetre = parisVersUtc(annee, mois, jour, 0, 0);
    const finFenetre = parisVersUtc(annee, mois, jour, 24, 0);
    const debutRequete = new Date(debutFenetre.getTime() - 12 * 3600000).toISOString();
    const finRequete = new Date(finFenetre.getTime() + 12 * 3600000).toISOString();

    let occupes;
    try{
      occupes = await supabase(
        `rendez_vous?owner_id=eq.${ownerId}` +
        `&date_debut=lt.${finRequete}&date_fin=gt.${debutRequete}` +
        `&select=date_debut,date_fin,statut,paiement_statut,expire_le`
      );
    }catch(e){
      return json(res, 503, { error: 'Page de réservation temporairement indisponible.' });
    }
    const maintenantMs = Date.now();
    // Un rendez-vous 'en_attente' compte comme occupé : deux prospects ne
    // doivent pas pouvoir demander le même créneau en même temps. Exception :
    // un « hold » de paiement (phase 3) dont `expire_le` est dépassé libère le
    // créneau immédiatement, sans attendre le cron de nettoyage
    // (api/paiement-nettoyer.js) qui ne fait que ranger la ligne en `annule`
    // plus tard — voir schema-v8-paiements.sql.
    const busy = occupes
      .filter(r => r.statut !== 'annule')
      .filter(r => !(r.paiement_statut === 'en_attente' && r.expire_le && new Date(r.expire_le).getTime() < maintenantMs))
      .map(r => ({ debut: new Date(r.date_debut).getTime(), fin: new Date(r.date_fin).getTime() }));

    const creneaux = [];
    for(let t = minDebut; t + prestation.duree_minutes <= minFin; t += intervalle){
      const h = Math.floor(t / 60), mn = t % 60;
      const debut = parisVersUtc(annee, mois, jour, h, mn);
      const debutMs = debut.getTime();
      const finMs = debutMs + dureeMs;
      if(debutMs < auPlusTot || debutMs > auPlusTard) continue;
      const chevauche = busy.some(b => debutMs < b.fin && finMs > b.debut);
      if(chevauche) continue;
      creneaux.push(debut.toISOString());
    }

    return json(res, 200, { date: dateStr, creneaux });
  }

  // -------------------------------------------------- appel « bootstrap »
  let profils, prestations, paiements;
  try{
    [profils, prestations, paiements] = await Promise.all([
      supabase(`profiles?id=eq.${ownerId}&select=business_name,full_name,logo_url,accent,metier,terme_singulier,terme_pluriel`),
      // `public_cible`/`categorie` : schema-v17. Repli sans ces colonnes tant que la migration n'est pas passée.
      supabase(`prestations?owner_id=eq.${ownerId}&actif=eq.true&select=id,libelle,description,prix_unitaire,tva_taux,duree_minutes,public_cible,categorie&order=position`)
        .catch(() => supabase(`prestations?owner_id=eq.${ownerId}&actif=eq.true&select=id,libelle,description,prix_unitaire,tva_taux,duree_minutes&order=position`)),
      // Phase 3 : le widget doit savoir AVANT de soumettre le formulaire si un
      // paiement immédiat va être exigé (prix plein) pour confirmer le
      // créneau — voir api/reservation-publique.js et CLAUDE.md.
      supabase(`parametres_paiement?owner_id=eq.${ownerId}&select=stripe_actif,stripe_secret_key`)
    ]);
  }catch(e){
    return json(res, 503, { error: 'Page de réservation temporairement indisponible.' });
  }
  const profil = profils[0] || {};
  const paiement = paiements[0];
  const paiementRequis = !!(paiement?.stripe_actif && paiement?.stripe_secret_key);

  return json(res, 200, {
    praticien: {
      business_name: profil.business_name || profil.full_name || 'Cadence',
      logo_url: profil.logo_url || null,
      accent: profil.accent || 'ambre',
      metier: profil.metier || 'autre',
      terme_singulier: profil.terme_singulier || null,
      terme_pluriel: profil.terme_pluriel || null
    },
    prestations,
    paiement_requis: paiementRequis,
    reglages: {
      jours_ouvres: reglage.jours_ouvres,
      heure_debut: reglage.heure_debut,
      heure_fin: reglage.heure_fin,
      delai_min_heures: reglage.delai_min_heures,
      horizon_jours: reglage.horizon_jours
    }
  });
}
