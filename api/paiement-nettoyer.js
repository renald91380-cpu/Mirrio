// Cadence — nettoyage quotidien des holds de réservation payante expirés et
// jamais payés (phase 3 : réservation en ligne avec paiement anticipé).
//
//   GET /api/paiement-nettoyer     (appelé quotidiennement par Vercel Cron, voir vercel.json)
//
// Pourquoi ce cron existe alors que le créneau se libère déjà tout seul dès
// l'expiration (api/reservation-disponibilites.js et api/reservation-
// publique.js ignorent déjà tout hold `paiement_statut='en_attente'` dont
// `expire_le` est dépassé, sans attendre ce cron) : uniquement pour que la
// ligne `rendez_vous` fantôme ne traîne pas indéfiniment dans l'agenda du
// praticien avec un statut "en attente" trompeur. Ce cron ne change donc
// jamais la disponibilité réelle d'un créneau — il range juste après coup.
//
// Ne touche que `rendez_vous` : seule la phase 3 (réservation en ligne) pose
// un verrou de créneau via `expire_le` — les demandes de paiement phase 1
// (agenda, rendez-vous déjà confirmé) et phase 2 (devis) ne bloquent aucun
// créneau et n'ont donc rien à expirer ici.
//
// Zéro dépendance npm, même patron que api/relances.js.
//
// Variables d'environnement attendues sur Vercel :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, CRON_SECRET

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;

function json(res, statut, corps){
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(corps));
}

async function supabaseGet(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  });
  if(!r.ok) throw new Error(`Supabase GET ${r.status} sur ${chemin}`);
  return r.json();
}

// PATCH conditionné (compare-and-swap) : ne bascule que les lignes encore
// réellement `en_attente` au moment de l'écriture — si un paiement Stripe
// vient de passer entre la lecture et cette écriture (webhook plus rapide
// que ce cron), le filtre ne matche plus rien pour cette ligne-là, et on ne
// risque jamais d'annuler un rendez-vous qui vient d'être payé.
async function supabasePatchConditionnel(chemin, corps){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    },
    body: JSON.stringify(corps)
  });
  if(!r.ok){
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase PATCH ${r.status} sur ${chemin} : ${detail.slice(0, 200)}`);
  }
  return r.json();
}

export default async function handler(req, res){
  if(req.method !== 'GET' && req.method !== 'POST'){
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète (Supabase).' });
  }

  // Même garde-fou que api/relances.js : sans CRON_SECRET configuré, rien
  // n'est exigé (pratique en local), mais CRON_SECRET doit être posé en
  // production pour empêcher n'importe qui de déclencher ce nettoyage.
  if(CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`){
    return json(res, 401, { error: 'Non autorisé.' });
  }

  const maintenant = new Date().toISOString();

  let expires;
  try{
    expires = await supabaseGet(
      `rendez_vous?statut=eq.en_attente&paiement_statut=eq.en_attente&expire_le=lt.${maintenant}` +
      `&select=id,owner_id&limit=500`
    );
  }catch(e){
    return json(res, 502, { error: 'Lecture des réservations expirées impossible.', detail: String(e.message || e) });
  }

  if(!expires.length){
    return json(res, 200, { annulees: 0, candidates: 0 });
  }

  let annulees = 0, echecs = 0;
  for(const rdv of expires){
    try{
      const touchees = await supabasePatchConditionnel(
        `rendez_vous?id=eq.${rdv.id}&owner_id=eq.${rdv.owner_id}&paiement_statut=eq.en_attente`,
        { statut: 'annule', paiement_statut: 'echoue' }
      );
      if(touchees.length) annulees++;
    }catch(e){
      // Une ligne qui échoue à se ranger ne doit pas bloquer les suivantes —
      // le prochain passage du cron la retentera naturellement.
      echecs++;
    }
  }

  return json(res, 200, { candidates: expires.length, annulees, echecs });
}
