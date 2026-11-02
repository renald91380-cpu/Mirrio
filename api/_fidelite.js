// Mirrio — carte de fidélité (QR code, Apple Wallet, Google Wallet), module `_` servi par api/reservation-disponibilites.js (limite de 12 fonctions Vercel).
//
//   GET  /api/fidelite?t=<jeton>                 carte d'un client : prénom, solde, règle, derniers mouvements (jamais le fichier clients)
//   GET  /api/fidelite?p=<slug>                  programme d'un salon, pour la page d'inscription (QR affiché au comptoir)
//   GET  /api/fidelite?t=<jeton>&wallet=google   { url } : lien « Ajouter à Google Wallet »            (501 si Google Wallet n'est pas configuré)
//   GET  /api/fidelite?t=<jeton>&wallet=apple    fichier .pkpass à ouvrir sur iPhone                   (501 si Apple Wallet n'est pas configuré)
//   GET  /api/fidelite?wallet=etat               { google, apple } : quels wallets sont disponibles
//   POST /api/fidelite { action:'inscrire', slug, nom, email, telephone, consentement, site }   inscription par le QR du salon → { token }
//   POST /api/fidelite { action:'maj', token }   Authorization: Bearer <jeton Supabase du personnel> : repousse le solde dans Google Wallet (meilleur effort)
//
// Le jeton de la carte est une URL-capacité (comme calendar_feeds.token) : il fait l'autorisation à lui seul pour CETTE carte. Les fonctions SQL appelées
// ici sont réservées à la clé de service. Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL, + celles de api/_wallet.js.

import { walletConfigure, lienGoogleWallet, majGoogleWallet, construirePkpass } from './_wallet.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const SITE_URL = (process.env.SITE_URL || 'https://cadence-site-cadence-65cc.vercel.app').replace(/\/$/, '');
const JETON = /^[0-9a-f]{48}$/;

const json = (res, statut, corps) => {
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(corps));
};
const rpc = async (nom, args, jetonUtilisateur) => {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/${nom}`, { method:'POST', headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jetonUtilisateur || SERVICE_KEY}`, 'Content-Type': 'application/json' }, body: JSON.stringify(args) });
  const texte = await r.text(); let corps = null; try{ corps = texte ? JSON.parse(texte) : null; }catch(e){}
  return { ok: r.ok, statut: r.status, corps };
};
async function lireCorps(req){
  if(req.body && typeof req.body === 'object') return req.body;
  const morceaux = []; let taille = 0;
  for await (const m of req){ taille += m.length; if(taille > 20000) return null; morceaux.push(m); }
  try{ return JSON.parse(Buffer.concat(morceaux).toString('utf8') || '{}'); }catch(e){ return null; }
}
const site = req => { const h = req.headers.host; return /^[a-z0-9.-]+(:\d+)?$/i.test(h || '') && !/localhost|127\.0\.0\.1/.test(h) ? `https://${h}` : SITE_URL; };

export default async function handler(req, res){
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error:'Configuration serveur incomplète.' });
  const url = new URL(req.url, 'http://x'), q = url.searchParams, wallet = walletConfigure();

  if(req.method === 'GET'){
    if(q.get('wallet') === 'etat') return json(res, 200, wallet);
    if(q.get('p')){
      const slug = q.get('p');
      if(!/^[a-z0-9-]{3,40}$/.test(slug)) return json(res, 404, { error:'Salon introuvable.' });
      const r = await rpc('fidelite_programme_public', { p_slug: slug });
      if(!r.ok || !r.corps) return json(res, 404, { error:'Ce salon n\'a pas de programme de fidélité.' });
      return json(res, 200, r.corps);
    }
    const t = q.get('t') || '';
    if(!JETON.test(t)) return json(res, 404, { error:'Carte introuvable.' });
    const r = await rpc('fidelite_publique', { p_token: t });
    if(!r.ok || !r.corps) return json(res, 404, { error:'Carte introuvable.' });
    const carte = r.corps, w = q.get('wallet');
    if(!w) return json(res, 200, { ...carte, owner_id: undefined, wallet });
    if(w === 'google'){
      if(!wallet.google) return json(res, 501, { error:'Google Wallet n\'est pas encore activé pour Mirrio.' });
      try{ return json(res, 200, { url: lienGoogleWallet(carte, site(req)) }); }catch(e){ return json(res, 500, { error:'Carte Google Wallet impossible à générer.' }); }
    }
    if(w === 'apple'){
      if(!wallet.apple) return json(res, 501, { error:'Apple Wallet n\'est pas encore activé pour Mirrio.' });
      try{
        const buf = construirePkpass(carte, site(req));
        res.statusCode = 200; res.setHeader('Content-Type', 'application/vnd.apple.pkpass'); res.setHeader('Content-Disposition', 'attachment; filename="fidelite.pkpass"');
        res.setHeader('Cache-Control', 'no-store'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); return res.end(buf);
      }catch(e){ return json(res, 500, { error:'Carte Apple Wallet impossible à générer.' }); }
    }
    return json(res, 400, { error:'Wallet inconnu.' });
  }

  if(req.method !== 'POST') return json(res, 405, { error:'Method Not Allowed' });
  const corps = await lireCorps(req);
  if(!corps) return json(res, 400, { error:'Requête invalide.' });

  if(corps.action === 'inscrire'){
    if(corps.site) return json(res, 400, { error:'Requête invalide.' });                 // piège à robots : champ caché rempli
    if(corps.consentement !== true) return json(res, 400, { error:'Acceptez la conservation de vos coordonnées pour recevoir votre carte.' });
    if(!/^[a-z0-9-]{3,40}$/.test(String(corps.slug || ''))) return json(res, 404, { error:'Salon introuvable.' });
    const r = await rpc('fidelite_inscrire', { p_slug: corps.slug, p_nom: String(corps.nom || ''), p_email: String(corps.email || ''), p_tel: String(corps.telephone || '') });
    if(!r.ok){
      const msg = r.corps && r.corps.message ? String(r.corps.message) : '';
      const clair = /nom|e-mail|téléphone|Trop d|programme|Salon introuvable/.test(msg);
      return json(res, clair ? 400 : 500, { error: clair ? msg : 'Inscription impossible pour le moment.' });
    }
    return json(res, 200, r.corps);
  }

  if(corps.action === 'maj'){
    const jeton = String(req.headers.authorization || '').replace(/^Bearer\s+/i, '');
    if(!jeton || !JETON.test(String(corps.token || ''))) return json(res, 400, { error:'Requête invalide.' });
    // Le personnel doit voir cette carte : on la relit AVEC son jeton, la RLS (espace actif) fait foi.
    const v = await fetch(`${SUPABASE_URL}/rest/v1/fidelite_cartes?token=eq.${corps.token}&select=id`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${jeton}` } });
    const lignes = v.ok ? await v.json() : [];
    if(!lignes.length) return json(res, 403, { error:'Carte inaccessible.' });
    if(!wallet.google) return json(res, 200, { ok:false, raison:'google_non_configure' });
    const r = await rpc('fidelite_publique', { p_token: corps.token });
    if(!r.ok || !r.corps) return json(res, 404, { error:'Carte introuvable.' });
    try{ return json(res, 200, { ok: await majGoogleWallet(r.corps, site(req)) }); }catch(e){ return json(res, 200, { ok:false }); }
  }
  return json(res, 400, { error:'Action inconnue.' });
}
