// Mirrio — retour PayPal après annulation côté client (bouton "Annuler et
// retourner" sur paypal.com) : libère la demande de paiement pour qu'elle
// puisse être redemandée, puis affiche la page générique d'annulation.
//
//   GET /api/paiement-annuler-paypal?o=<owner_id>&rdv=<rendez_vous_id>
//
// Sans cet aller simple, un rendez-vous dont le paiement PayPal a été
// abandonné resterait indéfiniment `paiement_statut='en_attente'` (aucune
// commande PayPal n'est jamais capturée dans ce cas — voir api/paiement-
// capturer-paypal.js — donc pas de webhook ni de cron pour le débloquer) :
// le bouton "Demander un paiement" resterait grisé dans l'agenda sans
// qu'aucun paiement ne soit réellement en cours. Miroir de ce que fait déjà
// le webhook Stripe sur `checkout.session.expired`.
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
  res.end(JSON.stringify(corps));
}

function redirection(res, url){
  res.statusCode = 302;
  res.setHeader('Location', url);
  res.end();
}

export default async function handler(req, res){
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète.' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const origine = `https://${req.headers.host}`;
  const ownerId = url.searchParams.get('o');
  const rdvId = url.searchParams.get('rdv');

  if(ownerId && rdvId){
    try{
      // Compare-and-swap : ne touche rien si le paiement a entre-temps abouti
      // par un autre moyen (improbable ici, mais même prudence que partout
      // ailleurs dans api/).
      await fetch(
        `${SUPABASE_URL}/rest/v1/rendez_vous?id=eq.${rdvId}&owner_id=eq.${ownerId}&paiement_statut=eq.en_attente`,
        {
          method: 'PATCH',
          headers: {
            apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
            'Content-Type': 'application/json', Prefer: 'return=minimal'
          },
          body: JSON.stringify({ paiement_statut: 'echoue' })
        }
      );
    }catch(e){ /* best-effort : au pire, l'admin redemandera plus tard */ }
  }

  return redirection(res, `${origine}/paiement-merci.html?statut=annule`);
}
