// Cadence — webhook Stripe : confirme un paiement anticipé et génère la
// facture acquittée correspondante (phase 1 : rendez-vous déjà confirmé,
// demandé depuis site/agenda.html via api/paiement-creer-checkout.js).
//
//   POST /api/paiement-webhook-stripe?o=<owner_id>
//
// Pourquoi `?o=` dans l'URL : un webhook arrive sans session, donc sans
// aucun moyen de savoir quel praticien vérifier — chaque praticien colle
// SA PROPRE URL (avec son propre espaceId) dans SON PROPRE dashboard
// Stripe (site/parametres.html → onglet Paiement l'affiche déjà formée).
// Ça ne fait par contre confiance à rien : la signature est vérifiée avec
// le `stripe_webhook_secret` DE CET ESPACE, donc seul le vrai compte
// Stripe de ce praticien peut produire un événement qui passe la
// vérification pour ce `o`-là.
//
// Corps brut obligatoire pour la vérification de signature Stripe — d'où
// `config.api.bodyParser = false` et une lecture manuelle du flux, AVANT
// tout JSON.parse. Vérification HMAC-SHA256 via le module `crypto` natif
// de Node, zéro dépendance, comme le reste de api/.
//
// Idempotence : Stripe peut renvoyer le même événement plusieurs fois. La
// confirmation se fait par un UPDATE conditionné à l'état actuel
// (paiement_statut='en_attente' → 'paye') ; si aucune ligne n'est touchée,
// c'est un renvoi ou un événement déjà traité, et on s'arrête là sans
// dupliquer facture ni email.
//
// Variables d'environnement attendues :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM

export const config = { api: { bodyParser: false } };

import crypto from 'crypto';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Cadence <onboarding@resend.dev>';

const TOLERANCE_SECONDES = 300;

const INK = '#1C2333', PARCH = '#F5F1E7', PARCHDIM = '#EAE4D4', AMBER = '#E2A63D';
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

function json(res, statut, corps){
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.end(JSON.stringify(corps));
}

function lireCorpsBrut(req){
  return new Promise((resolve, reject) => {
    const morceaux = [];
    req.on('data', c => morceaux.push(c));
    req.on('end', () => resolve(Buffer.concat(morceaux)));
    req.on('error', reject);
  });
}

async function supabaseGet(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  });
  if(!r.ok) throw new Error(`Supabase GET ${r.status} sur ${chemin}`);
  return r.json();
}

async function supabasePost(chemin, corps){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=representation'
    },
    body: JSON.stringify(corps)
  });
  if(!r.ok){
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase POST ${r.status} sur ${chemin} : ${detail.slice(0, 200)}`);
  }
  return r.json();
}

// PATCH conditionné (compare-and-swap) — renvoie les lignes RÉELLEMENT
// modifiées, pour que l'appelant sache si la condition a matché ou non.
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

async function nouveauJetonPartage(){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/new_feed_token`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({})
  });
  if(!r.ok) throw new Error(`Supabase RPC ${r.status} sur new_feed_token`);
  return r.json();
}

// Vérifie l'en-tête `Stripe-Signature: t=<timestamp>,v1=<signature>[,v1=...]`
// contre le corps brut — voir https://stripe.com/docs/webhooks#verify-manually.
// `corpsBrut` doit être le Buffer exact reçu, non ré-encodé.
function verifierSignatureStripe(corpsBrut, enTete, secret){
  if(!enTete || !secret) return false;
  const parties = {};
  for(const morceau of enTete.split(',')){
    const [cle, valeur] = morceau.split('=');
    if(cle === 't') parties.t = valeur;
    // Plusieurs `v1=` sont possibles (rotation de secret côté Stripe) —
    // on les accepte toutes, une seule doit matcher.
    if(cle === 'v1') (parties.v1 = parties.v1 || []).push(valeur);
  }
  if(!parties.t || !parties.v1?.length) return false;

  const age = Math.abs(Date.now() / 1000 - Number(parties.t));
  if(!Number.isFinite(age) || age > TOLERANCE_SECONDES) return false;

  const payload = Buffer.concat([Buffer.from(`${parties.t}.`, 'utf8'), corpsBrut]);
  const attendu = crypto.createHmac('sha256', secret).update(payload).digest('hex');
  const attenduBuf = Buffer.from(attendu, 'hex');

  return parties.v1.some(candidate => {
    try{
      const candidatBuf = Buffer.from(candidate, 'hex');
      return candidatBuf.length === attenduBuf.length && crypto.timingSafeEqual(candidatBuf, attenduBuf);
    }catch(e){ return false; }
  });
}

function formaterEuros(n){
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
}
function echapperHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Gabarit d'email minimal, dérivé de celui de envoyer-document.js (dupliqué
// à dessein, pas de module partagé dans api/) — spécialisé "facture payée",
// pas de bouton "voir mon devis" à distinguer ici.
function gabaritEmailFacturePayee({ nomEmetteur, logoUrl, nomClient, numero, montant, lienDocument }){
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light"><title>Votre facture</title></head>
<body style="margin:0; padding:0; background:${PARCHDIM}; font-family:${SANS};">
<div style="display:none; max-height:0; overflow:hidden;">Facture ${echapperHtml(numero)} — ${formaterEuros(montant)}, réglée.</div>
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
<h1 style="margin:0 0 18px; font-family:${SERIF}; font-size:24px; color:${INK};">Paiement reçu, merci !</h1>
<p style="margin:0 0 24px; font-size:15px; line-height:1.6; color:${INK};">${echapperHtml(nomEmetteur)} a bien reçu votre paiement${nomClient ? `, ${echapperHtml(nomClient)}` : ''}. Voici votre facture acquittée.</p>
</td></tr>
<tr><td style="padding:0 32px 8px;">
<table role="presentation" cellpadding="0" cellspacing="0" style="width:100%; background:#fff; border:1px solid rgba(28,35,51,0.12); border-radius:8px;">
<tr><td style="padding:16px 20px;">
<div style="font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:rgba(28,35,51,0.5); margin-bottom:4px;">Facture ${echapperHtml(numero)} — réglée</div>
<div style="font-family:${SERIF}; font-size:26px; font-weight:700; color:${INK};">${formaterEuros(montant)}</div>
</td></tr>
</table>
</td></tr>
<tr><td style="padding:26px 32px 6px; text-align:center;">
<a href="${lienDocument}" style="display:inline-block; background:${AMBER}; color:${INK}; font-weight:700; font-size:15px; text-decoration:none; padding:14px 28px; border-radius:6px;">Voir ma facture</a>
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

  const url = new URL(req.url, `https://${req.headers.host}`);
  const ownerId = url.searchParams.get('o');
  if(!ownerId){
    return json(res, 400, { error: "Paramètre 'o' manquant." });
  }

  const corpsBrut = await lireCorpsBrut(req);

  let paiements;
  try{
    paiements = await supabaseGet(
      `parametres_paiement?owner_id=eq.${ownerId}&select=stripe_actif,stripe_webhook_secret`);
  }catch(e){
    // Ne renvoie jamais de détail à un appelant non authentifié à ce stade
    // (la signature n'est pas encore vérifiée) — 500 générique, Stripe
    // réessaiera.
    return json(res, 500, { error: 'Erreur temporaire.' });
  }
  const secret = paiements[0]?.stripe_webhook_secret;
  if(!secret){
    // Espace inconnu ou paiement Stripe jamais configuré pour ce `o` — pas
    // la peine de faire réessayer Stripe indéfiniment sur une URL mal
    // collée, mais on ne révèle rien de plus qu'un 400 générique.
    return json(res, 400, { error: 'Webhook non configuré pour cet espace.' });
  }

  const signatureValide = verifierSignatureStripe(corpsBrut, req.headers['stripe-signature'], secret);
  if(!signatureValide){
    return json(res, 400, { error: 'Signature invalide.' });
  }

  let event;
  try{
    event = JSON.parse(corpsBrut.toString('utf8'));
  }catch(e){
    return json(res, 400, { error: 'Corps JSON invalide.' });
  }

  // Tout événement autre que ceux qui nous intéressent est accepté sans
  // action — Stripe considère un webhook non géré comme un succès dès lors
  // que la requête répond 2xx.
  if(event.type !== 'checkout.session.completed' && event.type !== 'checkout.session.expired'){
    return json(res, 200, { recu: true, ignore: event.type });
  }

  const session = event.data?.object;
  const rendezVousId = session?.metadata?.rendez_vous_id;
  const ownerIdSession = session?.metadata?.owner_id;
  if(!rendezVousId || !ownerIdSession){
    return json(res, 200, { recu: true, ignore: 'métadonnées absentes' });
  }
  // Garde-fou supplémentaire : l'espace qui a créé la session doit être
  // exactement celui de l'URL du webhook — protège d'une mauvaise
  // configuration croisée (une clé secrète collée dans le mauvais espace).
  if(ownerIdSession !== ownerId){
    return json(res, 200, { recu: true, ignore: 'espace non correspondant' });
  }

  if(event.type === 'checkout.session.expired'){
    // Libère la tentative de paiement pour permettre d'en redemander une —
    // ne touche rien si le paiement a entre-temps déjà abouti (idempotence
    // par le même filtre `paiement_statut=eq.en_attente`).
    try{
      await supabasePatchConditionnel(
        `rendez_vous?id=eq.${rendezVousId}&owner_id=eq.${ownerId}&paiement_statut=eq.en_attente`,
        { paiement_statut: 'echoue' }
      );
    }catch(e){ /* Stripe réessaiera si ça échoue vraiment côté réseau */ }
    return json(res, 200, { recu: true });
  }

  if(session.payment_status !== 'paid'){
    return json(res, 200, { recu: true, ignore: 'paiement non finalisé' });
  }

  // Confirmation idempotente : ne procède à la suite (facture + email) que
  // si CETTE requête est bien celle qui a fait passer 'en_attente' → 'paye'.
  let rdvsConfirmes;
  try{
    rdvsConfirmes = await supabasePatchConditionnel(
      `rendez_vous?id=eq.${rendezVousId}&owner_id=eq.${ownerId}&paiement_statut=eq.en_attente`,
      { paiement_statut: 'paye' }
    );
  }catch(e){
    return json(res, 502, { error: 'Confirmation du paiement impossible.' });
  }
  if(!rdvsConfirmes.length){
    // Renvoi Stripe d'un événement déjà traité (ou paiement déjà marqué
    // autrement) — rien à refaire.
    return json(res, 200, { recu: true, deja_traite: true });
  }
  const rdv = rdvsConfirmes[0];

  // À partir d'ici, l'argent est marqué reçu quoi qu'il arrive : la
  // génération de facture et l'email sont best-effort, jamais un motif de
  // renvoyer une erreur à Stripe (qui réessaierait indéfiniment un webhook
  // déjà utile).
  try{
    const [prestations, clients, profils, facturation] = await Promise.all([
      supabaseGet(`prestations?id=eq.${rdv.prestation_id}&select=libelle,prix_unitaire,tva_taux`),
      supabaseGet(`clients?id=eq.${rdv.client_id}&select=full_name,email`),
      supabaseGet(`profiles?id=eq.${ownerId}&select=business_name,full_name,logo_url`),
      supabaseGet(`parametres_facturation?owner_id=eq.${ownerId}&select=emetteur_nom,emetteur_email`)
    ]);
    const prestation = prestations[0];
    const client = clients[0];
    const profil = profils[0] || {};
    const params = facturation[0] || {};

    const docs = await supabasePost('documents', {
      owner_id: ownerId,
      client_id: rdv.client_id,
      type: 'facture',
      statut: 'paye',
      notes: `Réglée en ligne par carte (Stripe) le ${new Date().toLocaleDateString('fr-FR')}.`
    });
    const doc = docs[0];

    if(prestation){
      await supabasePost('document_lignes', {
        document_id: doc.id,
        description: prestation.libelle,
        quantite: 1,
        prix_unitaire: prestation.prix_unitaire,
        position: 0,
        tva_taux: prestation.tva_taux || 0
      });
    }

    if(client?.email && RESEND_API_KEY){
      const jetonPartage = await nouveauJetonPartage();
      await supabasePatchConditionnel(`documents?id=eq.${doc.id}`, { partage_token: jetonPartage });

      const origine = `https://${req.headers.host}`;
      const nomEmetteur = params.emetteur_nom || profil.business_name || profil.full_name || 'Cadence';
      await envoyerEmail({
        to: client.email,
        replyTo: params.emetteur_email || undefined,
        subject: `Facture ${doc.numero || ''} — ${nomEmetteur}`,
        html: gabaritEmailFacturePayee({
          nomEmetteur, logoUrl: profil.logo_url, nomClient: client.full_name,
          numero: doc.numero, montant: rdv.paiement_montant,
          lienDocument: `${origine}/voir-document.html?t=${jetonPartage}`
        })
      });
    }
  }catch(e){
    // Le paiement reste confirmé même si la facture/l'email a raté — pas de
    // filet de rattrapage automatique en phase 1 (à traiter à la main
    // depuis devis-factures.html si jamais ça arrive).
  }

  return json(res, 200, { recu: true });
}
