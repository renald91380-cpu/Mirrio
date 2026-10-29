// Mirrio — ajout d'un salon à un groupe (plusieurs salons, un seul propriétaire).
//
//   POST /api/salons   { nom, metier, ville }      Authorization: Bearer <jeton Supabase>
//
// Un salon est un espace complet (un profil) : on crée donc un compte « technique » via l'API admin d'authentification : e-mail fictif
// jamais utilisé, mot de passe aléatoire jamais conservé, connexion directe bloquée. L'appelant en devient gestionnaire
// (salon_gestionnaires, schema-v38) et bascule dessus avec basculer_espace(). Réservé à un compte de formule Studio (Salon), plafonné.
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY.

import { randomUUID, randomBytes } from 'node:crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const ANON = 'sb_publishable_ZO93qi6gjZvsHU5lxKqLWA_fdif4BHl';
const MAX_SALONS = 10;                       // salon principal compris
const METIERS = ['coiffure', 'barbier', 'esthetique', 'onglerie', 'massage', 'patisserie', 'autre'];

const json = (res, statut, corps) => { res.statusCode = statut; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.end(JSON.stringify(corps)); };
const entetes = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' };
const rest = (chemin, opts = {}) => fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { ...opts, headers: { ...entetes, Prefer: 'return=representation', ...(opts.headers || {}) } });

async function nettoyer(id){ try{ await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${id}`, { method: 'DELETE', headers: entetes }); }catch(e){} }

export default async function handler(req, res){
  if(req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' });
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Serveur non configuré.' });
  let nouveau = null;
  try{
    const jeton = (req.headers.authorization || '').replace(/^Bearer /i, '');
    const u = jeton ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jeton}` } }) : null;
    const user = u && u.ok ? await u.json() : null;
    if(!user) return json(res, 401, { error: 'Connexion requise.' });

    let corps = req.body; if(typeof corps === 'string'){ try{ corps = JSON.parse(corps); }catch(e){ corps = {}; } }
    const nom = String((corps && corps.nom) || '').trim(), ville = String((corps && corps.ville) || '').trim();
    const metier = METIERS.includes(corps && corps.metier) ? corps.metier : 'coiffure';
    if(nom.length < 2 || nom.length > 80) return json(res, 400, { error: 'Le nom du salon doit faire entre 2 et 80 caractères.' });
    if(ville.length > 80) return json(res, 400, { error: 'Ville trop longue.' });

    const [profil] = await (await rest(`profiles?id=eq.${user.id}&select=plan,compte_technique`)).json();
    if(!profil) return json(res, 403, { error: 'Profil introuvable.' });
    if(profil.compte_technique) return json(res, 403, { error: 'Utilisez le compte du propriétaire du groupe.' });
    if(profil.plan !== 'studio') return json(res, 403, { error: 'Plusieurs salons : forfait Groupe à 79 €/mois, réservé aux comptes de la formule Équipe.' });
    const deja = await (await rest(`salon_gestionnaires?user_id=eq.${user.id}&select=salon_id`)).json();
    if(deja.length + 1 >= MAX_SALONS) return json(res, 400, { error: `Limite de ${MAX_SALONS} salons atteinte. Contactez-nous pour aller au-delà.` });

    const c = await fetch(`${SUPABASE_URL}/auth/v1/admin/users`, { method: 'POST', headers: entetes, body: JSON.stringify({
      email: `salon-${randomUUID()}@salons.mirrio.invalid`, password: randomBytes(24).toString('hex'), email_confirm: true,
      user_metadata: { full_name: nom, plan: 'studio' } }) });
    if(!c.ok) return json(res, 502, { error: 'Création du salon impossible pour le moment.' });
    nouveau = (await c.json()).id;

    // Le compte technique ne se connecte jamais directement : seul son gestionnaire y accède, par bascule d'espace.
    await fetch(`${SUPABASE_URL}/auth/v1/admin/users/${nouveau}`, { method: 'PUT', headers: entetes, body: JSON.stringify({ ban_duration: '876000h' }) }).catch(() => {});

    const p = await rest(`profiles?id=eq.${nouveau}`, { method: 'PATCH', body: JSON.stringify({ business_name: nom, metier, plan: 'studio', compte_technique: true, cree_par: user.id }) });
    if(!p.ok) throw new Error('profil');
    if(ville) await rest(`parametres_facturation?owner_id=eq.${nouveau}`, { method: 'PATCH', body: JSON.stringify({ emetteur_ville: ville, emetteur_nom: nom }) });
    const g = await rest('salon_gestionnaires', { method: 'POST', body: JSON.stringify({ salon_id: nouveau, user_id: user.id }) });
    if(!g.ok) throw new Error('gestionnaire');
    return json(res, 200, { id: nouveau, nom });
  }catch(e){
    if(nouveau) await nettoyer(nouveau);
    return json(res, 500, { error: 'Erreur serveur : le salon n\'a pas été créé.' });
  }
}
