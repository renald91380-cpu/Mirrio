// Mirrio — envoi par email d'un devis/facture à son client.
//
//   POST /api/envoyer-document     { document_id }
//   Authorization: Bearer <jeton d'accès Supabase du praticien connecté>
//
// Aucune génération PDF côté serveur (choix assumé, voir CLAUDE.md §3 et §3.7) :
// l'email contient un lien vers site/voir-document.html, une page de lecture
// publique qui réutilise document-render.js — le client imprime/enregistre en
// PDF depuis son propre navigateur, exactement comme le praticien le fait déjà
// dans devis-factures.html. Zéro dépendance npm, même parti pris que
// api/agenda.js et api/relances.js.
//
// Variables d'environnement attendues (mêmes que api/relances.js) :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Mirrio <onboarding@resend.dev>';

// Clé publishable — déjà exposée côté client dans site/supabase-config.js,
// sans risque à relire ici pour authentifier l'appelant auprès de /auth/v1/user.
const SUPABASE_ANON_KEY = 'sb_publishable_ZO93qi6gjZvsHU5lxKqLWA_fdif4BHl';

const INK = '#1C2333', PARCH = '#F5F1E7', PARCHDIM = '#EAE4D4', AMBER = '#E2A63D';
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

async function supabasePatch(chemin, corps){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    },
    body: JSON.stringify(corps)
  });
  if(!r.ok) throw new Error(`Supabase PATCH ${r.status} sur ${chemin}`);
  const data = await r.json();
  return data[0];
}

// Jeton de partage : la même fonction SQL que calendar_feeds.token
// (public.new_feed_token(), schema-v2-personnalisation.sql) plutôt qu'un
// générateur maison côté Node — un seul endroit qui décide de ce qu'est un
// jeton valide dans tout le projet.
async function nouveauJetonPartage(){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/new_feed_token`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if(!r.ok) throw new Error(`Supabase RPC ${r.status} sur new_feed_token`);
  return r.json();
}

async function utilisateurConnecte(jeton){
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jeton}` }
  });
  if(!r.ok) return null;
  return r.json();
}

// Réplique current_workspace_id() (schema-v3-espaces-et-relances.sql) côté
// serveur : l'espace actif d'un membre n'est valide que s'il y est encore
// effectivement actif. Dupliqué ici plutôt qu'appelé en RPC avec le jeton de
// l'utilisateur, pour rester dans le même style « une seule clé, la
// service_role » que le reste de api/.
async function espaceActif(userId){
  const profils = await supabaseGet(`profiles?id=eq.${userId}&select=espace_actif_id`);
  const souhaite = profils[0]?.espace_actif_id;
  if(!souhaite) return userId;
  const membres = await supabaseGet(
    `workspace_members?workspace_id=eq.${souhaite}&user_id=eq.${userId}&statut=eq.actif&select=id`);
  if(membres.length) return souhaite;
  // Gestionnaire d'un salon du groupe (schema-v38) : même droit qu'un membre actif.
  const gestion = await supabaseGet(`salon_gestionnaires?salon_id=eq.${souhaite}&user_id=eq.${userId}&select=salon_id`).catch(() => []);
  return gestion.length ? souhaite : userId;
}

function totalTTC(lignes, assujettiTva, tauxDefaut){
  let totalHT = 0, totalTVA = 0;
  (lignes || []).forEach(l => {
    const ht = (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0);
    totalHT += ht;
    if(assujettiTva){
      const taux = Number(l.tva_taux ?? tauxDefaut) || 0;
      totalTVA += ht * taux / 100;
    }
  });
  return totalHT + totalTVA;
}

function formaterEuros(n){
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
}
function echapperHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gabaritEmail({ nomEmetteur, logoUrl, nomClient, estDevis, numero, montant, lienDocument }){
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light"><title>${estDevis ? 'Votre devis' : 'Votre facture'}</title></head>
<body style="margin:0; padding:0; background:${PARCHDIM}; font-family:${SANS};">
<div style="display:none; max-height:0; overflow:hidden;">${estDevis ? 'Devis' : 'Facture'} ${echapperHtml(numero)} — ${formaterEuros(montant)}.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PARCHDIM};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:${PARCH}; border-radius:10px; overflow:hidden;">
<tr><td style="background:${INK}; padding:22px 32px;">
${logoUrl
  ? `<img src="${echapperHtml(logoUrl)}" alt="${echapperHtml(nomEmetteur)}" style="max-height:40px; max-width:200px; display:block;">`
  : `<span style="font-family:${SERIF}; font-weight:700; font-size:19px; color:${PARCH};">${echapperHtml(nomEmetteur)}</span>`
}
</td></tr>
<tr><td style="padding:40px 32px 8px; text-align:center;">
<h1 style="margin:0 0 18px; font-family:${SERIF}; font-size:24px; color:${INK};">${estDevis ? 'Voici votre devis' : 'Voici votre facture'}</h1>
<p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${INK};">${echapperHtml(nomEmetteur)} vous envoie ${estDevis ? 'un devis' : 'une facture'}${nomClient ? `, ${echapperHtml(nomClient)}` : ''}.</p>
</td></tr>
<tr><td style="padding:0 32px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background:#fff; border:1px solid rgba(28,35,51,0.12); border-radius:8px;">
<tr><td style="padding:16px 20px;">
<div style="font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:rgba(28,35,51,0.5); margin-bottom:4px;">${estDevis ? 'Devis' : 'Facture'} ${echapperHtml(numero)}</div>
<div style="font-family:${SERIF}; font-size:26px; font-weight:700; color:${INK};">${formaterEuros(montant)}</div>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:26px 32px 6px; text-align:center;">
<a href="${lienDocument}" style="display:inline-block; background:${AMBER}; color:${INK}; font-weight:700; font-size:15px; text-decoration:none; padding:14px 28px; border-radius:6px;">${estDevis ? 'Voir mon devis' : 'Voir ma facture'}</a>
</td></tr>
<tr><td style="padding:20px 32px 30px; text-align:center;">
<p style="margin:0; font-size:13px; line-height:1.6; color:rgba(28,35,51,0.55);">Pour toute question, répondez directement à cet email.</p>
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

async function envoyerEmail({ to, replyTo, subject, html }){
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], reply_to: replyTo || undefined, subject, html })
  });
  if(!r.ok){
    const corps = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status} : ${corps.slice(0, 200)}`);
  }
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète.' });
  }
  // Comme relances.js : sans clé Resend, on ne bloque pas l'app, on n'envoie
  // simplement rien. `ignore` dans la réponse permet au bouton d'expliquer
  // pourquoi à l'utilisateur plutôt que d'afficher un succès trompeur.
  if(!RESEND_API_KEY){
    return json(res, 200, { envoye: false, ignore: 'RESEND_API_KEY absent — aucun envoi.' });
  }

  const jeton = (req.headers.authorization || '').replace(/^Bearer\s+/i, '');
  if(!jeton){
    return json(res, 401, { error: 'Non connecté.' });
  }
  const utilisateur = await utilisateurConnecte(jeton);
  if(!utilisateur?.id){
    return json(res, 401, { error: 'Session invalide.' });
  }

  let body = req.body;
  if(typeof body === 'string'){
    try{ body = JSON.parse(body); }catch(e){ body = {}; }
  }
  const documentId = body?.document_id;
  if(!documentId){
    return json(res, 400, { error: 'document_id manquant.' });
  }

  let espaceId;
  try{
    espaceId = await espaceActif(utilisateur.id);
  }catch(e){
    return json(res, 502, { error: 'Vérification impossible.' });
  }

  let docs;
  try{
    docs = await supabaseGet(
      `documents?id=eq.${documentId}&select=id,owner_id,type,numero,statut,client_id,partage_token,` +
      `document_lignes(quantite,prix_unitaire,tva_taux)`
    );
  }catch(e){
    return json(res, 502, { error: 'Lecture du document impossible.' });
  }
  const doc = docs[0];
  // L'appartenance à l'ESPACE fait foi, pas au compte connecté : un
  // collaborateur peut envoyer un document créé par le propriétaire.
  if(!doc || doc.owner_id !== espaceId){
    return json(res, 404, { error: 'Document introuvable.' });
  }
  if(!doc.client_id){
    return json(res, 400, { error: "Ce document n'a pas de client associé." });
  }

  let clients, reglages;
  try{
    [clients, reglages] = await Promise.all([
      supabaseGet(`clients?id=eq.${doc.client_id}&select=full_name,email`),
      supabaseGet(`parametres_facturation?owner_id=eq.${espaceId}&select=emetteur_nom,emetteur_email,assujetti_tva,tva_taux_defaut`)
    ]);
  }catch(e){
    return json(res, 502, { error: 'Lecture des réglages impossible.' });
  }
  const client = clients[0];
  if(!client?.email){
    return json(res, 400, { error: "Ce client n'a pas d'email renseigné." });
  }
  const params = reglages[0] || {};

  let profil = {};
  try{
    profil = (await supabaseGet(`profiles?id=eq.${espaceId}&select=business_name,full_name,logo_url`))[0] || {};
  }catch(e){ /* pas bloquant : on retombe sur "Mirrio" plus bas */ }

  let jetonPartage = doc.partage_token;
  if(!jetonPartage){
    try{
      jetonPartage = await nouveauJetonPartage();
    }catch(e){
      return json(res, 502, { error: 'Impossible de préparer le lien de partage.' });
    }
  }

  // Même origine que la requête (fonctionne en production comme sur un
  // déploiement de prévisualisation Vercel) plutôt qu'une URL en dur.
  const origine = `https://${req.headers.host}`;
  const lienDocument = `${origine}/voir-document.html?t=${jetonPartage}`;
  const montant = totalTTC(doc.document_lignes, params.assujetti_tva, params.tva_taux_defaut);
  const nomEmetteur = params.emetteur_nom || profil.business_name || profil.full_name || 'Mirrio';
  const estDevis = doc.type === 'devis';

  try{
    await envoyerEmail({
      to: client.email,
      replyTo: params.emetteur_email || undefined,
      subject: `${estDevis ? 'Votre devis' : 'Votre facture'} ${doc.numero || ''} — ${nomEmetteur}`,
      html: gabaritEmail({
        nomEmetteur, logoUrl: profil.logo_url, nomClient: client.full_name,
        estDevis, numero: doc.numero, montant, lienDocument
      })
    });
  }catch(e){
    return json(res, 502, { error: "L'envoi a échoué. Réessayez." });
  }

  // Un brouillon envoyé n'en est plus un — mais on ne touche jamais un statut
  // déjà avancé (accepté, payé…) : seul un changement manuel doit pouvoir
  // faire reculer un document dans son cycle de vie.
  const maj = { partage_token: jetonPartage, dernier_envoi_le: new Date().toISOString() };
  if(doc.statut === 'brouillon') maj.statut = 'envoye';

  try{
    await supabasePatch(`documents?id=eq.${doc.id}`, maj);
  }catch(e){ /* l'email est déjà parti : ne pas faire échouer la requête pour ça */ }

  return json(res, 200, { envoye: true });
}
