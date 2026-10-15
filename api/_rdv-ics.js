// Mirrio — téléchargement du .ics d'un rendez-vous réservé.
//
//   GET /api/rendez-vous-ics?t=<rendez_vous.avis_token>
//
// URL-capacité : le jeton (64 hex, celui aussi utilisé pour l'avis) donne accès
// à CE rendez-vous uniquement. Ne révèle que titre, horaires, nom du praticien
// et adresse publique — jamais les coordonnées du client.
//
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

import { icsParJeton } from './_ics.js';

export default async function handler(req, res){
  if(req.method !== 'GET'){ res.statusCode = 405; return res.end('Method Not Allowed'); }
  try{
    const origine = `https://${req.headers.host}`;
    const jeton = new URL(req.url, origine).searchParams.get('t');
    const r = await icsParJeton(jeton, origine);
    if(!r){ res.statusCode = 404; return res.end('Rendez-vous introuvable.'); }
    res.statusCode = 200;
    res.setHeader('Content-Type', 'text/calendar; charset=utf-8');
    res.setHeader('Content-Disposition', 'attachment; filename="rendez-vous.ics"');
    res.setHeader('Cache-Control', 'no-store');
    res.setHeader('X-Robots-Tag', 'noindex, nofollow');
    res.end(r.ics);
  }catch(e){
    res.statusCode = 500; res.end('Erreur serveur.');
  }
}
