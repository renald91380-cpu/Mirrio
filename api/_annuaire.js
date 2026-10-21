// Mirrio — annuaire public des praticiens (site/explorer.html, site/pro.html).
//
//   GET /api/annuaire?q=<texte>&ville=<ville>&metier=<metier>&public=<femme|homme>&budget_min=<€>&budget_max=<€>&promo=1&style=afro   → liste (promo=1 : salons avec heures creuses)
//     Le budget (TTC, en euros) s'applique aux PRESTATIONS : un salon est retenu s'il propose au moins une prestation
//     dans la fourchette (celles qui correspondent à la recherche `q` si elle en désigne, et au public choisi).
//   GET /api/annuaire?slug=<slug>                                → fiche détaillée
//
// Ne renvoie que les praticiens qui ont activé la réservation en ligne, posé
// un slug ET coché « Apparaître dans l'annuaire ». Données strictement
// publiques : jamais d'email ni de téléphone. L'adresse n'est renvoyée que si
// le praticien l'a saisie exprès pour l'annuaire (`adresse_annuaire`).
//
// Fiches « non revendiquées » (salons pas encore inscrits, données publiques OpenStreetMap/Sirene, voir db/schema-v25) :
//   GET  /api/annuaire?...&ville=<ville>    → ajoute `non_inscrits` (sans filtre de prix, de public ni de promo)
//   GET  /api/annuaire?fiche=<uuid>         → une fiche non revendiquée (pour la page de revendication)
//   POST /api/annuaire {action:'prevenir', id}               → « Prévenir ce salon » (une demande par visiteur et par fiche)
//   POST /api/annuaire {action:'revendiquer', id, email}     → le salon demande à reprendre sa fiche (validée ensuite à la main)
//
// Zéro dépendance npm. Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, statut, corps, { cache = true } = {}){
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', cache ? 'public, s-maxage=60, stale-while-revalidate=300' : 'no-store');
  res.end(JSON.stringify(corps));
}

async function supabase(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

const ttc = p => Number(p.prix_unitaire) * (1 + (Number(p.tva_taux) || 0) / 100);
const arrondi = n => Math.round(n * 100) / 100;
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const enc = encodeURIComponent;
// Valeur sûre pour un filtre PostgREST `ilike` : on retire les caractères qui en changent le sens.
const motif = s => String(s || '').replace(/[*%,()\\]/g, ' ').trim().slice(0, 60);
const CHAMPS_PUBLICS = 'id,nom,metier,adresse,code_postal,ville,latitude,longitude,statut';

async function nbDemandes(ids){
  if(!ids.length) return {};
  const lignes = await supabase(`fiches_demandes?fiche_id=in.(${ids.join(',')})&select=fiche_id`).catch(() => []);
  const n = {}; lignes.forEach(l => { n[l.fiche_id] = (n[l.fiche_id] || 0) + 1; });
  return n;
}

async function ecrire(chemin, corps, methode, prefer){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    method: methode, headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json', Prefer: prefer || 'return=minimal' },
    body: JSON.stringify(corps)
  });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
}

// Empreinte anonyme d'un visiteur (pas d'adresse IP conservée) : sert uniquement à ne compter qu'une demande par fiche.
function empreinte(req){
  const ip = String(req.headers['x-forwarded-for'] || '').split(',')[0].trim() || 'inconnue';
  return crypto.createHash('sha256').update(`${ip}|${req.headers['user-agent'] || ''}|${SERVICE_KEY}`).digest('hex').slice(0, 40);
}

async function actionPost(req, res){
  const corps = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});
  const id = String(corps.id || '');
  if(!UUID.test(id)) return json(res, 400, { error: 'Fiche invalide.' }, { cache: false });
  const [fiche] = await supabase(`fiches_externes?id=eq.${id}&statut=in.(non_revendiquee,en_cours)&select=id,statut`);
  if(!fiche) return json(res, 404, { error: 'Fiche introuvable.' }, { cache: false });

  if(corps.action === 'prevenir'){
    await ecrire('fiches_demandes', { fiche_id: id, empreinte: empreinte(req) }, 'POST', 'resolution=ignore-duplicates,return=minimal');
    return json(res, 200, { ok: true, nb_demandes: (await nbDemandes([id]))[id] || 0 }, { cache: false });
  }
  if(corps.action === 'revendiquer'){
    const email = String(corps.email || '').trim().toLowerCase();
    if(!/^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(email) || email.length > 254) return json(res, 400, { error: 'Email invalide.' }, { cache: false });
    if(fiche.statut === 'non_revendiquee'){
      await ecrire(`fiches_externes?id=eq.${id}`, { statut: 'en_cours', revendiquee_email: email, revendiquee_le: new Date().toISOString(), contact_statut: 'inscrit' }, 'PATCH');
    }
    return json(res, 200, { ok: true }, { cache: false });
  }
  return json(res, 400, { error: 'Action inconnue.' }, { cache: false });
}

const normaliser = s => String(s || '').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').trim();
const FICHE_COLS = 'owner_id,slug,description_annuaire,photos,adresse_annuaire,latitude,longitude';

// Publics servis par un salon : « mixte » ouvre aux deux.
function publicsDe(prestations){
  const s = new Set();
  prestations.forEach(p => { const c = p.public_cible || 'mixte'; if(c === 'mixte'){ s.add('femme'); s.add('homme'); } else s.add(c); });
  return [...s];
}

function statsAvis(avis){
  const n = avis.length;
  return { note_moyenne: n ? Math.round(avis.reduce((s, a) => s + a.note, 0) / n * 10) / 10 : null, nb_avis: n };
}

async function fiche(slug){
  const [f] = await supabase(
    `parametres_reservation?slug=eq.${encodeURIComponent(slug)}&activee=eq.true&visible_annuaire=eq.true&select=${FICHE_COLS}`);
  if(!f) return null;
  const [[profil], [fact], prestations, avis] = await Promise.all([
    supabase(`profiles?id=eq.${f.owner_id}&select=business_name,full_name,logo_url,metier`),
    supabase(`parametres_facturation?owner_id=eq.${f.owner_id}&select=emetteur_ville`),
    supabase(`prestations?owner_id=eq.${f.owner_id}&actif=eq.true&select=libelle,description,prix_unitaire,duree_minutes,public_cible,categorie&order=position`)
      .catch(() => supabase(`prestations?owner_id=eq.${f.owner_id}&actif=eq.true&select=libelle,description,prix_unitaire,duree_minutes&order=position`)),
    supabase(`avis?owner_id=eq.${f.owner_id}&masque=eq.false&select=note,commentaire,auteur,created_at&order=created_at.desc&limit=50`)
  ]);
  if(!prestations.length) return null;
  return {
    slug: f.slug,
    nom: profil?.business_name || profil?.full_name || 'Praticien',
    metier: profil?.metier || 'autre',
    logo_url: profil?.logo_url || null,
    ville: fact?.emetteur_ville || null,
    description: f.description_annuaire, photos: f.photos || [],
    adresse: f.adresse_annuaire, latitude: f.latitude, longitude: f.longitude,
    prestations, publics: publicsDe(prestations), avis, ...statsAvis(avis)
  };
}

// Salons pas encore sur Mirrio, seulement quand on cherche une ville, et jamais avec un filtre qui n'a de sens que pour un salon inscrit.
async function chercherNonInscrits({ ville, metier, q, params, filtreInscrit }){
  if(!ville || filtreInscrit) return [];
  try{
    const filtres = ['statut=in.(non_revendiquee,en_cours)', `ville=ilike.*${enc(motif(params.get('ville')))}*`];
    if(metier) filtres.push(`metier=eq.${metier}`);
    if(q) filtres.push(`nom=ilike.*${enc(motif(params.get('q')))}*`);
    const lignes = await supabase(`fiches_externes?${filtres.join('&')}&select=${CHAMPS_PUBLICS}&order=nom&limit=60`);
    const n = await nbDemandes(lignes.map(l => l.id));
    return lignes.map(l => ({ ...l, nb_demandes: n[l.id] || 0 }));
  }catch(e){ return []; }
}

export default async function handler(req, res){
  if(req.method !== 'GET' && req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' });
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Serveur non configuré.' });

  try{
    if(req.method === 'POST') return await actionPost(req, res);
    const params = new URL(req.url, 'http://x').searchParams;

    // Une fiche non revendiquée, pour la page « Vous êtes ce salon ? ».
    const idFiche = params.get('fiche');
    if(idFiche){
      if(!UUID.test(idFiche)) return json(res, 404, { error: 'Fiche introuvable.' });
      const [f] = await supabase(`fiches_externes?id=eq.${idFiche}&statut=in.(non_revendiquee,en_cours)&select=${CHAMPS_PUBLICS}`);
      if(!f) return json(res, 404, { error: 'Fiche introuvable.' });
      return json(res, 200, { ...f, nb_demandes: (await nbDemandes([f.id]))[f.id] || 0 }, { cache: false });
    }

    const slug = params.get('slug');
    if(slug){
      const f = await fiche(slug);
      return f ? json(res, 200, f) : json(res, 404, { error: 'Fiche introuvable.' });
    }

    const q = normaliser(params.get('q'));
    const ville = normaliser(params.get('ville'));
    const metier = (params.get('metier') || '').replace(/[^a-z_-]/g, '');
    const publicCible = ['femme', 'homme'].includes(params.get('public')) ? params.get('public') : '';
    const nombre = v => { const n = Number(String(v || '').replace(',', '.')); return v !== null && v !== '' && isFinite(n) && n >= 0 ? n : null; };
    const budgetMin = nombre(params.get('budget_min')), budgetMax = nombre(params.get('budget_max'));
    const seulementPromo = params.get('promo') === '1';
    const style = params.get('style') === 'afro' ? 'afro' : '';

    const fiches = await supabase(
      `parametres_reservation?activee=eq.true&visible_annuaire=eq.true&slug=not.is.null&select=${FICHE_COLS}&limit=500`);
    if(!fiches.length) return json(res, 200, { praticiens: [], non_inscrits: await chercherNonInscrits({ ville, metier, q, params, filtreInscrit: budgetMin != null || budgetMax != null || seulementPromo || publicCible || style }) });

    const ids = fiches.map(f => f.owner_id).join(',');
    const [profils, villes, prestations, avis, vitrines, creuxLignes, stylesLignes] = await Promise.all([
      supabase(`profiles?id=in.(${ids})&select=id,business_name,full_name,logo_url,metier`),
      supabase(`parametres_facturation?owner_id=in.(${ids})&select=owner_id,emetteur_ville`),
      supabase(`prestations?owner_id=in.(${ids})&actif=eq.true&select=owner_id,libelle,prix_unitaire,tva_taux,public_cible`)
        .catch(() => supabase(`prestations?owner_id=in.(${ids})&actif=eq.true&select=owner_id,libelle,prix_unitaire,tva_taux`)),
      supabase(`avis?owner_id=in.(${ids})&masque=eq.false&select=owner_id,note`),
      supabase(`vitrine?owner_id=in.(${ids})&select=owner_id,cover_url,galerie`).catch(() => []),
      // Heures creuses (schema-v24) : salons qui proposent une remise sur certains créneaux.
      supabase(`parametres_reservation?owner_id=in.(${ids})&creux_actif=eq.true&select=owner_id,creux_pourcentage`).catch(() => []),
      // Styles de coiffure (schema-v27) : absent tant que la migration n'est pas passée.
      supabase(`parametres_reservation?owner_id=in.(${ids})&select=owner_id,styles`).catch(() => [])
    ]);
    const stylesParId = Object.fromEntries(stylesLignes.map(l => [l.owner_id, l.styles || []]));
    const creuxParId = Object.fromEntries(creuxLignes.map(c => [c.owner_id, Number(c.creux_pourcentage) || null]));
    const vitParId = Object.fromEntries(vitrines.map(v => [v.owner_id, v]));
    const profilParId = Object.fromEntries(profils.map(p => [p.id, p]));
    const villeParId = Object.fromEntries(villes.map(v => [v.owner_id, v.emetteur_ville]));
    const prixParId = {}, avisParId = {};
    prestations.forEach(p => {
      const e = prixParId[p.owner_id] || (prixParId[p.owner_id] = { min: Infinity, n: 0 });
      e.min = Math.min(e.min, ttc(p)); e.max = Math.max(e.max || 0, ttc(p)); e.n++;
      (e.liste || (e.liste = [])).push(p);
    });
    avis.forEach(a => (avisParId[a.owner_id] || (avisParId[a.owner_id] = [])).push(a));

    const praticiens = fiches.map(f => {
      const p = profilParId[f.owner_id] || {};
      const px = prixParId[f.owner_id];
      const liste = px?.liste || [];
      // Prestations candidates : celles du public choisi, puis celles qui correspondent à la recherche si elle en désigne.
      let candidates = liste.filter(l => !publicCible || (l.public_cible || 'mixte') === 'mixte' || l.public_cible === publicCible);
      const parTexte = q ? candidates.filter(l => normaliser(l.libelle).includes(q)) : [];
      if(parTexte.length) candidates = parTexte;
      const dansBudget = candidates.filter(l => (budgetMin == null || ttc(l) >= budgetMin) && (budgetMax == null || ttc(l) <= budgetMax))
        .sort((a, b) => ttc(a) - ttc(b));
      const correspondance = (parTexte.length || budgetMin != null || budgetMax != null) && dansBudget[0]
        ? { libelle: dansBudget[0].libelle, prix: arrondi(ttc(dansBudget[0])), nb: dansBudget.length } : null;
      return {
        slug: f.slug,
        nom: p.business_name || p.full_name || 'Praticien',
        metier: p.metier || 'autre',
        ville: villeParId[f.owner_id] || null,
        logo_url: p.logo_url || null,
        photo: vitParId[f.owner_id]?.cover_url || (vitParId[f.owner_id]?.galerie || [])[0] || (f.photos || [])[0] || null,
        description: f.description_annuaire || null,
        latitude: f.latitude, longitude: f.longitude,
        prix_a_partir_de: px && isFinite(px.min) ? arrondi(px.min) : null,
        prix_max: px && px.max ? arrondi(px.max) : null,
        correspondance,
        creux: creuxParId[f.owner_id] || null,
        styles: stylesParId[f.owner_id] || [],
        _ok_budget: (budgetMin == null && budgetMax == null) || dansBudget.length > 0,
        _ok_texte: !q || parTexte.length > 0,
        nb_prestations: px ? px.n : 0,
        publics: publicsDe(liste),
        ...statsAvis(avisParId[f.owner_id] || [])
      };
    }).filter(x => x.nb_prestations > 0)
      .filter(x => !metier || x.metier === metier)
      .filter(x => !publicCible || x.publics.includes(publicCible))
      .filter(x => !style || x.styles.includes(style))
      .filter(x => !ville || normaliser(x.ville).includes(ville))
      .filter(x => !q || x._ok_texte || normaliser(`${x.nom} ${x.description || ''} ${x.metier}`).includes(q))
      .filter(x => x._ok_budget)
      .filter(x => !seulementPromo || x.creux)
      .sort((a, b) => (b.note_moyenne ?? 0) - (a.note_moyenne ?? 0) || a.nom.localeCompare(b.nom, 'fr'));

    praticiens.forEach(x => { delete x._ok_budget; delete x._ok_texte; });

    const non_inscrits = await chercherNonInscrits({ ville, metier, q, params, filtreInscrit: budgetMin != null || budgetMax != null || seulementPromo || publicCible || style });
    return json(res, 200, { praticiens, non_inscrits });
  }catch(e){
    return json(res, 500, { error: 'Erreur serveur.' });
  }
}
