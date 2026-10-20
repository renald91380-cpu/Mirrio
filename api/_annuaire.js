// Mirrio — annuaire public des praticiens (site/explorer.html, site/pro.html).
//
//   GET /api/annuaire?q=<texte>&ville=<ville>&metier=<metier>&public=<femme|homme>&budget_min=<€>&budget_max=<€>   → liste
//     Le budget (TTC, en euros) s'applique aux PRESTATIONS : un salon est retenu s'il propose au moins une prestation
//     dans la fourchette (celles qui correspondent à la recherche `q` si elle en désigne, et au public choisi).
//   GET /api/annuaire?slug=<slug>                                → fiche détaillée
//
// Ne renvoie que les praticiens qui ont activé la réservation en ligne, posé
// un slug ET coché « Apparaître dans l'annuaire ». Données strictement
// publiques : jamais d'email ni de téléphone. L'adresse n'est renvoyée que si
// le praticien l'a saisie exprès pour l'annuaire (`adresse_annuaire`).
//
// Zéro dépendance npm. Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, statut, corps){
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=60, stale-while-revalidate=300');
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

export default async function handler(req, res){
  if(req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Serveur non configuré.' });

  try{
    const params = new URL(req.url, 'http://x').searchParams;

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

    const fiches = await supabase(
      `parametres_reservation?activee=eq.true&visible_annuaire=eq.true&slug=not.is.null&select=${FICHE_COLS}&limit=500`);
    if(!fiches.length) return json(res, 200, { praticiens: [] });

    const ids = fiches.map(f => f.owner_id).join(',');
    const [profils, villes, prestations, avis, vitrines] = await Promise.all([
      supabase(`profiles?id=in.(${ids})&select=id,business_name,full_name,logo_url,metier`),
      supabase(`parametres_facturation?owner_id=in.(${ids})&select=owner_id,emetteur_ville`),
      supabase(`prestations?owner_id=in.(${ids})&actif=eq.true&select=owner_id,libelle,prix_unitaire,tva_taux,public_cible`)
        .catch(() => supabase(`prestations?owner_id=in.(${ids})&actif=eq.true&select=owner_id,libelle,prix_unitaire,tva_taux`)),
      supabase(`avis?owner_id=in.(${ids})&masque=eq.false&select=owner_id,note`),
      supabase(`vitrine?owner_id=in.(${ids})&select=owner_id,cover_url,galerie`).catch(() => [])
    ]);
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
        _ok_budget: (budgetMin == null && budgetMax == null) || dansBudget.length > 0,
        _ok_texte: !q || parTexte.length > 0,
        nb_prestations: px ? px.n : 0,
        publics: publicsDe(liste),
        ...statsAvis(avisParId[f.owner_id] || [])
      };
    }).filter(x => x.nb_prestations > 0)
      .filter(x => !metier || x.metier === metier)
      .filter(x => !publicCible || x.publics.includes(publicCible))
      .filter(x => !ville || normaliser(x.ville).includes(ville))
      .filter(x => !q || x._ok_texte || normaliser(`${x.nom} ${x.description || ''} ${x.metier}`).includes(q))
      .filter(x => x._ok_budget)
      .sort((a, b) => (b.note_moyenne ?? 0) - (a.note_moyenne ?? 0) || a.nom.localeCompare(b.nom, 'fr'));

    praticiens.forEach(x => { delete x._ok_budget; delete x._ok_texte; });
    return json(res, 200, { praticiens });
  }catch(e){
    return json(res, 500, { error: 'Erreur serveur.' });
  }
}
