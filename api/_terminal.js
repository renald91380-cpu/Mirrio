// Mirrio — terminal de paiement SumUp Solo piloté depuis la caisse (Cloud API de SumUp).
//
//   POST /api/caisse-terminal  { action, ... }   Authorization: Bearer <jeton Supabase>
//     config      { merchant_code, api_key, affiliate_key, app_id }   enregistre les identifiants SumUp du salon (propriétaire ou gestionnaire)
//     appairer    { pairing_code, name }                              associe un Solo au compte SumUp du salon
//     supprimer   {}                                                  retire la configuration
//     payer       { session_id, montant }                             envoie le montant au Solo → { id }
//     verifier    { id }                                              interroge SumUp si le webhook tarde
//     annuler     { id }                                              arrête la transaction en attente sur le lecteur
//   POST /api/caisse-terminal?evt=webhook&id=<uuid>&s=<secret>        résultat envoyé par SumUp (événement solo.transaction.updated)
//
// Chaque salon utilise SON compte SumUp et SES clés : l'argent va directement chez lui, Mirrio ne touche à rien. Les clés vivent dans
// `caisse_terminal_config` (aucune policy : illisible pour un navigateur) et ne sont jamais renvoyées. Le navigateur lit le résultat par la fonction
// SQL caisse_terminal_lire(). Une vente ne peut utiliser un paiement terminal que s'il est « reussi » et pas déjà utilisé (voir caisse_encaisser).
// Le webhook de SumUp n'est pas signé : son URL porte un secret propre à chaque paiement, et le résultat est recoupé avec l'API des transactions.
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, SITE_URL (adresse publique, pour le webhook).

import { randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = 'sb_publishable_ZO93qi6gjZvsHU5lxKqLWA_fdif4BHl';
const SITE_URL = (process.env.SITE_URL || 'https://cadence-site-cadence-65cc.vercel.app').replace(/\/$/, '');
const SUMUP = 'https://api.sumup.com';

const json = (res, statut, corps) => { res.statusCode = statut; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.end(JSON.stringify(corps)); };
const entetes = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (chemin, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { ...opts, headers: { ...entetes, Prefer: 'return=representation', ...(opts.headers || {}) } });
const lire = async (chemin) => { const r = await rest(chemin); return r.ok ? r.json() : []; };
const sumup = (cfg, chemin, opts = {}) => fetch(`${SUMUP}${chemin}`, { ...opts, headers: { Authorization: `Bearer ${cfg.api_key}`, 'Content-Type': 'application/json', ...(opts.headers || {}) } });

async function corps(req){ let c = req.body; if(typeof c === 'string'){ try{ c = JSON.parse(c); }catch(e){ c = {}; } } return c || {}; }

async function appelant(req){
  const jeton = (req.headers.authorization || '').replace(/^Bearer /i, '');
  if(!jeton) return null;
  const u = await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jeton}` } });
  const user = u.ok ? await u.json() : null;
  if(!user) return null;
  // Même résolution que current_workspace_id() (membres, gestionnaires) : on laisse la base répondre avec le jeton de l'appelant.
  const w = await fetch(`${SUPABASE_URL}/rest/v1/rpc/current_workspace_id`, { method: 'POST', headers: { apikey: ANON, Authorization: `Bearer ${jeton}`, 'Content-Type': 'application/json' }, body: '{}' });
  const espace = w.ok ? JSON.parse(await w.text()) : null;
  if(!espace) return null;
  let admin = espace === user.id;
  if(!admin){ const g = await lire(`salon_gestionnaires?salon_id=eq.${espace}&user_id=eq.${user.id}&select=user_id`); admin = g.length > 0; }
  return { user, espace, admin };
}

async function configDe(espace){ const [c] = await lire(`caisse_terminal_config?owner_id=eq.${espace}&select=*`); return c || null; }

// Interroge SumUp sur une transaction du lecteur ; null si l'API ne répond pas clairement (on ne tranche alors pas).
async function transaction(cfg, clientTxId){
  try{
    const r = await sumup(cfg, `/v2.1/merchants/${encodeURIComponent(cfg.merchant_code)}/transactions?client_transaction_id=${encodeURIComponent(clientTxId)}`);
    if(!r.ok) return null;
    const t = await r.json();
    const statut = String(t.status || '').toUpperCase();
    return statut ? { statut, code: t.transaction_code || null } : null;
  }catch(e){ return null; }
}

async function conclure(p, cfg, issue, raison, code){
  const statut = issue === 'successful' ? 'reussi' : 'echoue';
  await rest(`caisse_terminal_paiements?id=eq.${p.id}&statut=${statut === 'reussi' ? 'neq.reussi' : 'eq.en_attente'}`, { method: 'PATCH', body: JSON.stringify({ statut, failure_reason: statut === 'echoue' ? String(raison || '').slice(0, 300) || null : null, transaction_code: code || p.client_transaction_id, updated_at: new Date().toISOString() }) });
}

async function webhook(req, res){
  const url = new URL(req.url, 'http://x'), id = url.searchParams.get('id') || '', s = url.searchParams.get('s') || '';
  if(!/^[0-9a-f-]{36}$/i.test(id) || s.length < 16) return json(res, 403, { error: 'Refusé.' });
  const [p] = await lire(`caisse_terminal_paiements?id=eq.${id}&select=*`);
  if(!p || p.secret !== s) return json(res, 403, { error: 'Refusé.' });
  const c = await corps(req), charge = (c && c.payload) || {};
  if(!p.client_transaction_id || String(charge.client_transaction_id) !== p.client_transaction_id) return json(res, 200, { ok: true });   // autre transaction : ignorée
  if(p.statut === 'reussi' || (p.statut !== 'en_attente' && charge.status !== 'successful')) return json(res, 200, { ok: true });   // un paiement annulé mais en fait encaissé redevient « reussi »
  const cfg = await configDe(p.owner_id); if(!cfg) return json(res, 200, { ok: true });
  let issue = charge.status === 'successful' ? 'successful' : 'failed', code = null;
  if(issue === 'successful'){
    const t = await transaction(cfg, p.client_transaction_id);
    if(t){ code = t.code; if(t.statut !== 'SUCCESSFUL') issue = 'failed'; }
  }
  await conclure(p, cfg, issue, charge.failure_reason, code);
  return json(res, 200, { ok: true });
}

export default async function handler(req, res){
  if(req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' });
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Serveur non configuré.' });
  try{
    if(new URL(req.url, 'http://x').searchParams.get('evt') === 'webhook') return await webhook(req, res);
    const a = await appelant(req);
    if(!a) return json(res, 401, { error: 'Connexion requise.' });
    const c = await corps(req), action = String(c.action || '');

    if(action === 'config'){
      if(!a.admin) return json(res, 403, { error: 'Seul le propriétaire du salon règle le terminal.' });
      const cfg = { merchant_code: String(c.merchant_code || '').trim(), api_key: String(c.api_key || '').trim(), affiliate_key: String(c.affiliate_key || '').trim(), app_id: String(c.app_id || '').trim() };
      if(!/^[A-Za-z0-9]{4,20}$/.test(cfg.merchant_code)) return json(res, 400, { error: 'Code marchand SumUp invalide (visible dans votre compte SumUp, ex. MK10CL2A).' });
      if(cfg.api_key.length < 12 || cfg.api_key.length > 200) return json(res, 400, { error: 'Clé API SumUp invalide.' });
      if(cfg.affiliate_key.length < 8 || cfg.affiliate_key.length > 200) return json(res, 400, { error: 'Clé d\'affiliation SumUp invalide.' });
      if(!/^[A-Za-z0-9._-]{3,100}$/.test(cfg.app_id)) return json(res, 400, { error: 'Identifiant d\'application invalide.' });
      const test = await sumup(cfg, `/v0.1/merchants/${encodeURIComponent(cfg.merchant_code)}/readers`);
      if(test.status === 401 || test.status === 403 || test.status === 404) return json(res, 400, { error: 'SumUp a refusé cette clé ou ce code marchand. Vérifiez-les dans votre compte SumUp.' });
      const avant = await configDe(a.espace);
      const garde = avant && avant.merchant_code === cfg.merchant_code ? { reader_id: avant.reader_id, reader_name: avant.reader_name } : { reader_id: null, reader_name: null };
      await rest('caisse_terminal_config', { method: 'POST', body: JSON.stringify({ owner_id: a.espace, ...cfg, ...garde, maj_le: new Date().toISOString() }), headers: { Prefer: 'resolution=merge-duplicates,return=minimal' } });
      return json(res, 200, { ok: true });
    }

    if(action === 'supprimer'){
      if(!a.admin) return json(res, 403, { error: 'Seul le propriétaire du salon règle le terminal.' });
      await rest(`caisse_terminal_config?owner_id=eq.${a.espace}`, { method: 'DELETE' });
      return json(res, 200, { ok: true });
    }

    const cfg = await configDe(a.espace);
    if(!cfg) return json(res, 409, { error: 'Le terminal SumUp n\'est pas encore configuré.' });

    if(action === 'appairer'){
      if(!a.admin) return json(res, 403, { error: 'Seul le propriétaire du salon règle le terminal.' });
      const code = String(c.pairing_code || '').trim().toUpperCase(), nom = String(c.name || '').trim().slice(0, 80) || 'Caisse';
      if(!/^[A-Z0-9]{8,9}$/.test(code)) return json(res, 400, { error: 'Le code d\'appairage fait 8 ou 9 caractères (affiché sur le Solo : Connexions, API, Connecter).' });
      const r = await sumup(cfg, `/v0.1/merchants/${encodeURIComponent(cfg.merchant_code)}/readers`, { method: 'POST', body: JSON.stringify({ pairing_code: code, name: nom }) });
      const j = await r.json().catch(() => ({}));
      if(!r.ok || !j.id) return json(res, 400, { error: 'Appairage refusé par SumUp. Le code expire au bout de 5 minutes, et le Solo doit être déconnecté de son compte.' });
      await rest(`caisse_terminal_config?owner_id=eq.${a.espace}`, { method: 'PATCH', body: JSON.stringify({ reader_id: String(j.id), reader_name: String(j.name || nom).slice(0, 80), maj_le: new Date().toISOString() }) });
      return json(res, 200, { ok: true, reader_name: j.name || nom });
    }

    if(action === 'payer'){
      if(!cfg.reader_id) return json(res, 409, { error: 'Aucun lecteur Solo n\'est appairé.' });
      const montant = Math.round(Number(c.montant) * 100) / 100;
      if(!(montant > 0) || montant > 50000) return json(res, 400, { error: 'Montant invalide.' });
      const sess = await lire(`caisse_sessions?id=eq.${encodeURIComponent(String(c.session_id || ''))}&owner_id=eq.${a.espace}&cloturee_le=is.null&select=id`);
      if(!sess.length) return json(res, 409, { error: 'Aucune session de caisse ouverte.' });
      const enCours = await lire(`caisse_terminal_paiements?owner_id=eq.${a.espace}&statut=eq.en_attente&created_at=gte.${encodeURIComponent(new Date(Date.now() - 2 * 60000).toISOString())}&select=id`);
      if(enCours.length) return json(res, 409, { error: 'Un paiement est déjà en cours sur le terminal. Terminez-le ou annulez-le.' });
      const secret = randomBytes(24).toString('hex');
      const cree = await rest('caisse_terminal_paiements', { method: 'POST', body: JSON.stringify({ owner_id: a.espace, session_id: sess[0].id, montant, secret, created_by: a.user.id }) });
      const [p] = cree.ok ? await cree.json() : [];
      if(!p) return json(res, 500, { error: 'Paiement impossible pour le moment.' });
      const r = await sumup(cfg, `/v0.1/merchants/${encodeURIComponent(cfg.merchant_code)}/readers/${encodeURIComponent(cfg.reader_id)}/checkout`, { method: 'POST', body: JSON.stringify({
        total_amount: { currency: 'EUR', minor_unit: 2, value: Math.round(montant * 100) },
        return_url: `${SITE_URL}/api/caisse-terminal?evt=webhook&id=${p.id}&s=${secret}`,
        affiliate: { app_id: cfg.app_id, key: cfg.affiliate_key, foreign_transaction_id: p.id } }) });
      const j = await r.json().catch(() => ({}));
      const cid = (j.data && j.data.client_transaction_id) || j.client_transaction_id;
      if(!r.ok || !cid){
        await rest(`caisse_terminal_paiements?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ statut: 'echoue', failure_reason: 'checkout refusé (' + r.status + ')', updated_at: new Date().toISOString() }) });
        return json(res, 502, { error: 'Le terminal n\'a pas accepté le paiement : est-il allumé, connecté à internet et à jour ?' });
      }
      await rest(`caisse_terminal_paiements?id=eq.${p.id}`, { method: 'PATCH', body: JSON.stringify({ client_transaction_id: String(cid) }) });
      return json(res, 200, { id: p.id });
    }

    if(action === 'verifier' || action === 'annuler'){
      const [p] = await lire(`caisse_terminal_paiements?id=eq.${encodeURIComponent(String(c.id || ''))}&owner_id=eq.${a.espace}&select=*`);
      if(!p) return json(res, 404, { error: 'Paiement introuvable.' });
      if(p.statut !== 'en_attente') return json(res, 200, { statut: p.statut });
      if(action === 'verifier'){
        const t = p.client_transaction_id ? await transaction(cfg, p.client_transaction_id) : null;
        if(t && t.statut === 'SUCCESSFUL'){ await conclure(p, cfg, 'successful', null, t.code); return json(res, 200, { statut: 'reussi' }); }
        if(t && ['FAILED', 'CANCELLED'].includes(t.statut)){ await conclure(p, cfg, 'failed', t.statut, t.code); return json(res, 200, { statut: 'echoue' }); }
        return json(res, 200, { statut: 'en_attente' });
      }
      await sumup(cfg, `/v0.1/merchants/${encodeURIComponent(cfg.merchant_code)}/readers/${encodeURIComponent(cfg.reader_id)}/terminate`, { method: 'POST' }).catch(() => {});
      await rest(`caisse_terminal_paiements?id=eq.${p.id}&statut=eq.en_attente`, { method: 'PATCH', body: JSON.stringify({ statut: 'annule', updated_at: new Date().toISOString() }) });
      return json(res, 200, { statut: 'annule' });
    }

    return json(res, 400, { error: 'Action inconnue.' });
  }catch(e){
    return json(res, 500, { error: 'Erreur serveur.' });
  }
}
