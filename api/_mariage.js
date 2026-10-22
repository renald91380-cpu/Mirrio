// Mirrio — notifications par e-mail de l'univers Mariage (best-effort : la demande existe déjà en base, un e-mail manquant ne la bloque jamais).
//
//   POST /api/mariage   { demande_id, evenement: 'demande' | 'reponse' }      Authorization: Bearer <jeton Supabase>
//     - 'demande' : appelé par le COUPLE juste après mariage_demander() → prévient le prestataire (emetteur_email de son espace).
//     - 'reponse' : appelé par le PRESTATAIRE (ou un membre actif de son espace) après mariage_repondre() → prévient le couple.
// Le contenu de l'e-mail est relu en base à partir de l'identifiant : le navigateur ne peut rien y glisser.
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM, SITE_URL.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Mirrio <onboarding@resend.dev>';
const SITE = (process.env.SITE_URL || 'https://cadence-site-cadence-65cc.vercel.app').replace(/\/$/, '');
const ANON = 'sb_publishable_ZO93qi6gjZvsHU5lxKqLWA_fdif4BHl';

const json = (res, statut, corps) => { res.statusCode = statut; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.setHeader('X-Robots-Tag', 'noindex, nofollow'); res.end(JSON.stringify(corps)); };
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const get = async chemin => { const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } }); if(!r.ok) throw new Error('Supabase ' + r.status); return r.json(); };
const eur = n => Number(n).toLocaleString('fr-FR', { style: 'currency', currency: 'EUR', maximumFractionDigits: 0 });

async function envoyer(a, replyTo, sujet, corps, lien, libelleLien){
  if(!RESEND_API_KEY) return false;
  const html = `<div style="font-family:-apple-system,Segoe UI,Roboto,sans-serif;max-width:560px;margin:auto;color:#101216;line-height:1.55"><h2 style="font-size:20px">${esc(sujet)}</h2>${corps}
    <p style="margin-top:22px"><a href="${esc(lien)}" style="background:#E2A63D;color:#101216;padding:12px 22px;border-radius:999px;text-decoration:none;font-weight:600">${esc(libelleLien)}</a></p>
    <p style="color:#5B606B;font-size:13px;margin-top:26px">Mirrio, plateforme éditée par Dima Artistry SARL.</p></div>`;
  const r = await fetch('https://api.resend.com/emails', { method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [a], reply_to: replyTo, subject: sujet, html }) });
  return r.ok;
}

export default async function handler(req, res){
  if(req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' });
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Serveur non configuré.' });
  try{
    const jeton = (req.headers.authorization || '').replace(/^Bearer /i, '');
    const u = jeton ? await fetch(`${SUPABASE_URL}/auth/v1/user`, { headers: { apikey: ANON, Authorization: `Bearer ${jeton}` } }) : null;
    const user = u && u.ok ? await u.json() : null;
    if(!user) return json(res, 401, { error: 'Connexion requise.' });

    let corps = req.body; if(typeof corps === 'string'){ try{ corps = JSON.parse(corps); }catch(e){ corps = {}; } }
    const id = String((corps && corps.demande_id) || '');
    if(!/^[0-9a-f-]{36}$/i.test(id)) return json(res, 400, { error: 'Demande invalide.' });
    const [d] = await get(`mariage_demandes?id=eq.${id}&select=*`);
    if(!d) return json(res, 404, { error: 'Demande introuvable.' });

    if(corps.evenement === 'demande'){
      if(d.owner_id !== user.id) return json(res, 403, { error: 'Interdit.' });
      const [f] = await get(`parametres_facturation?owner_id=eq.${d.prestataire_id}&select=emetteur_email`);
      if(!f || !f.emetteur_email) return json(res, 200, { envoye: false });
      const lignes = [d.date_evenement && `Date : ${d.date_evenement}`, d.nb_invites != null && `Invités : ${d.nb_invites}`, d.budget_indicatif != null && `Budget indicatif : ${eur(d.budget_indicatif)}`].filter(Boolean);
      const ok = await envoyer(f.emetteur_email, d.contact_email, 'Nouvelle demande de devis pour un mariage',
        `<p><b>${esc(d.contact_nom)}</b> vous demande un devis.</p><blockquote style="margin:12px 0;padding:10px 14px;background:#F5F5F3;border-radius:10px">${esc(d.message).replace(/\n/g, '<br>')}</blockquote><p>${lignes.map(esc).join('<br>')}</p>`,
        `${SITE}/mariage-pro.html`, 'Répondre à la demande');
      return json(res, 200, { envoye: ok });
    }

    if(corps.evenement === 'reponse'){
      const [m] = user.id === d.prestataire_id ? [{}] : await get(`workspace_members?workspace_id=eq.${d.prestataire_id}&user_id=eq.${user.id}&statut=eq.actif&select=id`);
      if(!m) return json(res, 403, { error: 'Interdit.' });
      const ok = await envoyer(d.contact_email, null, `${d.prestataire_nom || 'Un prestataire'} a répondu à votre demande`,
        d.statut === 'indisponible' ? `<p>${esc(d.prestataire_nom)} n'est malheureusement pas disponible pour votre date.</p>`
          : `<p>${esc(d.prestataire_nom)} vous a répondu${d.montant_propose != null ? ` : devis de <b>${eur(d.montant_propose)}</b>` : ''}.</p>${d.reponse ? `<blockquote style="margin:12px 0;padding:10px 14px;background:#F5F5F3;border-radius:10px">${esc(d.reponse).replace(/\n/g, '<br>')}</blockquote>` : ''}`,
        `${SITE}/mon-mariage.html`, 'Voir la réponse');
      return json(res, 200, { envoye: ok });
    }
    return json(res, 400, { error: 'Événement inconnu.' });
  }catch(e){ return json(res, 500, { error: 'Erreur serveur.' }); }
}
