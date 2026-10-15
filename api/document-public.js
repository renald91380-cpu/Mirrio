// Mirrio — lecture publique d'un devis/facture, pour le client qui le reçoit.
//
//   GET /api/document-public?t=<jeton>
//
// Le jeton (`documents.partage_token`) est une URL-capacité : pas de session,
// l'URL elle-même fait l'autorisation — même parti pris que api/agenda.js.
// Ne renvoie que ce qu'il faut pour reproduire le rendu de
// site/document-render.js (rendreDocument/stylesDocument), jamais la liste
// des documents de l'émetteur ni rien qui ne serait pas déjà sur le devis/la
// facture imprimée.
//
// Zéro dépendance npm, comme le reste de api/.
//
// Variables d'environnement attendues :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

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

export default async function handler(req, res){
  if(req.method !== 'GET'){
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète.' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const jeton = url.searchParams.get('t') || '';

  // Format vérifié avant toute requête : 128 caractères hexadécimaux, comme
  // public.new_feed_token() (deux UUID v4 concaténés sans tiret).
  if(!/^[0-9a-f]{64,128}$/.test(jeton)){
    return json(res, 404, { error: 'Document introuvable.' });
  }

  let docs;
  try{
    docs = await supabase(
      `documents?partage_token=eq.${jeton}` +
      `&select=id,owner_id,type,numero,statut,date_emission,date_echeance,notes,client_id,` +
      `document_lignes(description,description_secondaire,quantite,prix_unitaire,tva_taux,position)`
    );
  }catch(e){
    return json(res, 503, { error: 'Document temporairement indisponible.' });
  }

  const doc = docs[0];
  if(!doc){
    return json(res, 404, { error: 'Document introuvable.' });
  }

  let clients = [], params = [], profils = [];
  try{
    [clients, params, profils] = await Promise.all([
      doc.client_id
        ? supabase(`clients?id=eq.${doc.client_id}&select=full_name,company,email`)
        : Promise.resolve([]),
      supabase(`parametres_facturation?owner_id=eq.${doc.owner_id}&select=*`),
      supabase(`profiles?id=eq.${doc.owner_id}&select=business_name,full_name,accent,logo_url`)
    ]);
  }catch(e){
    return json(res, 503, { error: 'Document temporairement indisponible.' });
  }

  return json(res, 200, {
    doc: {
      type: doc.type,
      numero: doc.numero,
      statut: doc.statut,
      date_emission: doc.date_emission,
      date_echeance: doc.date_echeance,
      notes: doc.notes
    },
    lignes: (doc.document_lignes || []).slice().sort((a, b) => (a.position || 0) - (b.position || 0)),
    client: clients[0] || null,
    params: params[0] || {},
    brand: profils[0] || {}
  });
}
