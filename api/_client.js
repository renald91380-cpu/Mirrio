// Mirrio - espace client sans mot de passe (« Mes rendez-vous »), module `_` servi
// par api/reservation-disponibilites.js (limite de 12 fonctions Vercel).
//
//   POST /api/mon-espace  { email }                 -> envoie un lien de connexion par email (réponse toujours identique)
//   GET  /api/mon-espace?t=<jeton>                  -> rendez-vous de cette adresse, tous salons confondus
//   POST /api/mon-espace  { t, annuler:<rdv id> }   -> annule un rendez-vous à venir (au moins 24 h avant)
//
// Modèle de confiance : le jeton est signé (HMAC-SHA256 avec la clé serveur) et ne contient que
// l'adresse email et une date d'expiration (14 jours). Il n'est envoyé qu'à cette adresse : le lire
// prouve qu'on la contrôle. Aucun compte, aucune table ajoutée. Les rendez-vous sont retrouvés par
// l'adresse (fiche client du salon ou coordonnées de la demande en ligne).
//
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM

import crypto from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Mirrio <onboarding@resend.dev>';
const VALIDITE_JOURS = 14;
const DELAI_ANNULATION_H = 24;

const json = (res, statut, corps) => {
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.end(JSON.stringify(corps));
};

const b64 = b => Buffer.from(b).toString('base64url');
const signer = charge => { const p = b64(JSON.stringify(charge)); return `${p}.${crypto.createHmac('sha256', SERVICE_KEY).update(p).digest('base64url')}`; };
function verifier(jeton){
  const [p, sig] = String(jeton || '').split('.');
  if(!p || !sig) return null;
  const attendu = crypto.createHmac('sha256', SERVICE_KEY).update(p).digest('base64url');
  const a = Buffer.from(sig), b = Buffer.from(attendu);
  if(a.length !== b.length || !crypto.timingSafeEqual(a, b)) return null;
  try{
    const c = JSON.parse(Buffer.from(p, 'base64url').toString('utf8'));
    return c.e && c.x > Date.now() ? c : null;
  }catch(e){ return null; }
}

const entetes = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' };
async function get(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { headers: entetes });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
const enc = encodeURIComponent;
const email_ok = e => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(e) && e.length <= 254;
const uniques = a => [...new Set(a.filter(Boolean))];

// Tous les rendez-vous d'une adresse, avec salon, prestations et intervenant.
async function rendezVousDe(email){
  const cible = email.toLowerCase();
  const clients = (await get(`clients?email=ilike.${enc(email)}&select=id,owner_id,email`)).filter(c => (c.email || '').toLowerCase() === cible);
  const champs = 'id,owner_id,client_id,titre,date_debut,date_fin,statut,paiement_statut,paiement_montant,paiement_mode,total_ttc,reste_sur_place,reste_encaisse_le,intervenant_id,avis_token,prestation_id,prospect_email';
  const lots = [];
  if(clients.length) lots.push(get(`rendez_vous?client_id=in.(${clients.map(c => c.id).join(',')})&select=${champs}&order=date_debut.desc&limit=100`));
  lots.push(get(`rendez_vous?prospect_email=ilike.${enc(email)}&select=${champs}&order=date_debut.desc&limit=100`));
  const brut = (await Promise.all(lots)).flat();
  const vus = new Set();
  const rdvs = brut.filter(r => !vus.has(r.id) && vus.add(r.id) && (r.client_id || (r.prospect_email || '').toLowerCase() === cible))
    .filter(r => r.paiement_statut !== 'en_attente')
    .sort((a, b) => new Date(b.date_debut) - new Date(a.date_debut));
  if(!rdvs.length) return [];

  const ids = rdvs.map(r => r.id), owners = uniques(rdvs.map(r => r.owner_id)), intervs = uniques(rdvs.map(r => r.intervenant_id));
  const [multi, reglages, profils, equipe] = await Promise.all([
    get(`rendez_vous_prestations?rendez_vous_id=in.(${ids.join(',')})&select=rendez_vous_id,prestation_id,position&order=position`).catch(() => []),
    get(`parametres_reservation?owner_id=in.(${owners.join(',')})&select=owner_id,slug,activee`),
    get(`profiles?id=in.(${owners.join(',')})&select=id,business_name`),
    intervs.length ? get(`vitrine_equipe?id=in.(${intervs.join(',')})&select=id,nom`).catch(() => []) : []
  ]);
  const presIds = uniques([...multi.map(m => m.prestation_id), ...rdvs.map(r => r.prestation_id)]);
  const prestations = presIds.length ? await get(`prestations?id=in.(${presIds.join(',')})&select=id,libelle`) : [];
  const libelle = Object.fromEntries(prestations.map(p => [p.id, p.libelle]));
  const parRdv = {};
  multi.forEach(m => { (parRdv[m.rendez_vous_id] = parRdv[m.rendez_vous_id] || []).push(m.prestation_id); });

  return rdvs.map(r => {
    const reg = reglages.find(x => x.owner_id === r.owner_id) || {};
    const pro = profils.find(x => x.id === r.owner_id) || {};
    const pids = (parRdv[r.id] && parRdv[r.id].length ? parRdv[r.id] : [r.prestation_id]).filter(Boolean);
    const iv = equipe.find(x => x.id === r.intervenant_id);
    const futur = new Date(r.date_debut).getTime() > Date.now();
    const reste = r.paiement_mode === 'sur_place' && !r.reste_encaisse_le ? Number(r.reste_sur_place) || 0 : 0;
    const regle = r.paiement_statut === 'paye' || !!r.reste_encaisse_le;
    return {
      id: r.id, salon: { nom: pro.business_name || 'Salon', slug: reg.activee ? reg.slug : null },
      titre: r.titre, debut: r.date_debut, fin: r.date_fin,
      etat: r.statut === 'annule' ? 'annule' : r.statut === 'en_attente' ? 'attente' : futur ? 'avenir' : 'passe',
      prestations: pids.map(id => ({ id, libelle: libelle[id] || r.titre })),
      intervenant: iv ? { id: iv.id, nom: iv.nom } : null,
      reglement: reste > 0 ? { type: 'reste', montant: reste, acompte: Number(r.paiement_montant) || 0 }
        : regle ? { type: 'paye' } : { type: 'sur_place', total: r.total_ttc != null ? Number(r.total_ttc) : null },
      peut_annuler: r.statut !== 'annule' && new Date(r.date_debut).getTime() > Date.now() + DELAI_ANNULATION_H * 3600000,
      ics_url: r.avis_token ? `/api/rendez-vous-ics?t=${r.avis_token}` : null
    };
  });
}

// Lien de connexion signé vers « Mes rendez-vous » (aussi utilisé par les rappels de rendez-vous).
export const lienEspace = (email, origine) => `${origine}/mon-espace.html?t=${signer({ e: String(email).toLowerCase(), x: Date.now() + VALIDITE_JOURS * 86400000 })}`;

async function envoyerLien(email, origine){
  if(!RESEND_API_KEY) return;
  const lien = lienEspace(email, origine);
  const html = `<div style="font-family:Arial,sans-serif;max-width:480px;margin:auto;color:#101216">
    <h2 style="margin:0 0 12px">Vos rendez-vous</h2>
    <p style="line-height:1.5">Voici votre lien pour retrouver vos rendez-vous, les annuler ou les reprendre en un clic. Il est valable ${VALIDITE_JOURS} jours.</p>
    <p style="margin:24px 0"><a href="${lien}" style="background:#E2A63D;color:#101216;padding:14px 26px;border-radius:999px;text-decoration:none;font-weight:700">Voir mes rendez-vous</a></p>
    <p style="font-size:13px;color:#5B606B">Si vous n'êtes pas à l'origine de cette demande, ignorez ce message.</p></div>`;
  await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [email], subject: 'Votre lien pour retrouver vos rendez-vous', html })
  });
}

export default async function handler(req, res){
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Configuration serveur incomplète.' });
  const origine = `https://${req.headers.host}`;
  try{
    if(req.method === 'GET'){
      const c = verifier(new URL(req.url, origine).searchParams.get('t'));
      if(!c) return json(res, 401, { error: 'Lien expiré ou invalide.' });
      return json(res, 200, { email: c.e, rendez_vous: await rendezVousDe(c.e) });
    }
    if(req.method !== 'POST') return json(res, 405, { error: 'Method Not Allowed' });
    const corps = typeof req.body === 'string' ? JSON.parse(req.body || '{}') : (req.body || {});

    if(corps.annuler){
      const c = verifier(corps.t);
      if(!c) return json(res, 401, { error: 'Lien expiré ou invalide.' });
      const r = (await rendezVousDe(c.e)).find(x => x.id === corps.annuler);
      if(!r) return json(res, 404, { error: 'Rendez-vous introuvable.' });
      if(!r.peut_annuler) return json(res, 409, { error: `Un rendez-vous ne peut plus être annulé moins de ${DELAI_ANNULATION_H} h avant. Contactez directement le salon.` });
      const p = await fetch(`${SUPABASE_URL}/rest/v1/rendez_vous?id=eq.${enc(r.id)}`, {
        method: 'PATCH', headers: { ...entetes, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ statut: 'annule' })
      });
      if(!p.ok) throw new Error('patch');
      return json(res, 200, { ok: true });
    }

    const email = String(corps.email || '').trim();
    if(!email_ok(email)) return json(res, 400, { error: 'Adresse email invalide.' });
    // Réponse identique que l'adresse soit connue ou non : on ne révèle pas qui a pris rendez-vous.
    try{ if((await rendezVousDe(email)).length) await envoyerLien(email.toLowerCase(), origine); }catch(e){}
    return json(res, 200, { ok: true });
  }catch(e){
    return json(res, 500, { error: 'Erreur serveur.' });
  }
}
