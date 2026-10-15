// Mirrio — données publiques de la page vitrine d'un praticien/salon.
//
//   GET /api/vitrine?slug=<slug>
//
// Visible dès que la réservation en ligne est activée avec un identifiant
// public (l'inscription à l'annuaire est un choix séparé, `visible_annuaire`).
// Ne renvoie ni email de facturation, ni clés de paiement, ni coordonnées de
// clients : seulement ce que le praticien a choisi d'afficher.
//
// Tolérant à l'absence de schema-v18 / v17 : une table ou colonne manquante
// donne une valeur vide, jamais une erreur.
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, statut, corps){
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=30, stale-while-revalidate=120');
  res.end(JSON.stringify(corps));
}

async function get(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
const ouVide = (p, vide) => p.catch(() => vide);

export default async function handler(req, res){
  if(req.method !== 'GET') return json(res, 405, { error: 'Méthode non autorisée.' });
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Serveur non configuré.' });
  try{
    const slug = (new URL(req.url, 'http://x').searchParams.get('slug') || '').toLowerCase();
    if(!/^[a-z0-9-]{3,40}$/.test(slug)) return json(res, 404, { error: 'Page introuvable.' });

    const [reglage] = await get(
      `parametres_reservation?slug=eq.${slug}&activee=eq.true&select=owner_id,jours_ouvres,heure_debut,heure_fin,adresse_annuaire,latitude,longitude`);
    if(!reglage) return json(res, 404, { error: 'Page introuvable.' });
    const id = reglage.owner_id;

    const [[profil], [fact], [vitrine], equipe, prestations, avis] = await Promise.all([
      get(`profiles?id=eq.${id}&select=business_name,full_name,logo_url,accent,metier`),
      ouVide(get(`parametres_facturation?owner_id=eq.${id}&select=emetteur_ville`), []),
      ouVide(get(`vitrine?owner_id=eq.${id}&select=*`), []),
      ouVide(get(`vitrine_equipe?owner_id=eq.${id}&select=nom,role,bio,photo_url&order=position`), []),
      get(`prestations?owner_id=eq.${id}&actif=eq.true&select=id,libelle,description,prix_unitaire,duree_minutes,public_cible,categorie&order=position`)
        .catch(() => get(`prestations?owner_id=eq.${id}&actif=eq.true&select=id,libelle,description,prix_unitaire,duree_minutes&order=position`)),
      ouVide(get(`avis?owner_id=eq.${id}&masque=eq.false&select=note,commentaire,auteur,created_at&order=created_at.desc&limit=50`), [])
    ]);
    if(!prestations.length) return json(res, 404, { error: 'Page introuvable.' });

    const { owner_id, created_at, updated_at, ...v } = vitrine || {};
    return json(res, 200, {
      slug,
      nom: profil?.business_name || profil?.full_name || 'Praticien',
      metier: profil?.metier || 'autre',
      logo_url: profil?.logo_url || null,
      accent: profil?.accent || 'ambre',
      ville: fact?.emetteur_ville || null,
      horaires: { jours: reglage.jours_ouvres, debut: reglage.heure_debut, fin: reglage.heure_fin },
      adresse: reglage.adresse_annuaire, latitude: reglage.latitude, longitude: reglage.longitude,
      vitrine: v, equipe, prestations, avis
    });
  }catch(e){
    return json(res, 500, { error: 'Erreur serveur.' });
  }
}
