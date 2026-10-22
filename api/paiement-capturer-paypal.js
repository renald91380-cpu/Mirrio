// Mirrio — retour PayPal : capture la commande et génère la facture
// acquittée (surface « agenda », rendez-vous déjà confirmé — miroir de la
// confirmation phase 1 Stripe, mais pour PayPal).
//
//   GET /api/paiement-capturer-paypal?o=<owner_id>
//   (PayPal ajoute lui-même &token=<order_id>&PayerID=<payer_id> à cette URL
//   au moment de rediriger le client depuis paypal.com — voir `return_url`
//   dans api/paiement-creer-checkout.js.)
//
// Pourquoi pas de webhook PayPal (contrairement à Stripe) dans cette
// première version : une commande PayPal (`intent: 'CAPTURE'`) ne déplace
// AUCUN argent tant qu'elle n'est pas explicitement capturée — l'approbation
// du client sur paypal.com ne fait qu'autoriser la capture, qui a lieu ICI,
// synchrone, à son retour. Si ce point de retour n'est jamais atteint
// (onglet fermé, coupure réseau juste après l'approbation), la commande
// n'est simplement jamais capturée : aucun argent n'est prélevé, le
// praticien peut redemander un paiement. C'est l'inverse de Stripe Checkout,
// où le paiement est déjà effectif dès `checkout.session.completed` et où un
// webhook est donc indispensable pour ne jamais rater une confirmation.
// Cette route est donc la SEULE à faire bouger de l'argent PayPal — pas de
// filet de rattrapage asynchrone dans cette v1, à ajouter plus tard
// (`PAYMENT.CAPTURE.COMPLETED` + vérification de signature) si le besoin
// s'en fait sentir.
//
// Idempotence : si ce point de retour est atteint deux fois (rechargement de
// page, double redirection), la capture PayPal elle-même renvoie
// ORDER_ALREADY_CAPTURED la seconde fois — traité comme un succès, pas une
// erreur. La confirmation côté Mirrio (paiement_statut, facture, email) est
// elle aussi protégée par un PATCH conditionné (compare-and-swap), comme le
// webhook Stripe.
//
// Zéro dépendance npm, même patron que api/paiement-webhook-stripe.js —
// dupliqué à dessein (pas de module partagé dans api/, voir CLAUDE.md).
//
// Variables d'environnement attendues :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM

import { icsParId, pieceJointe } from './_ics.js';

import { smsConfirmation } from './_sms.js';

import { gabaritConfirmation, lienWhatsapp } from './_email.js';
import { lienEspace } from './_client.js';
const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Mirrio <onboarding@resend.dev>';

const INK = '#1C2333', PARCH = '#F5F1E7', PARCHDIM = '#EAE4D4', AMBER = '#E2A63D';
const SERIF = "Georgia,'Times New Roman',serif";
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";

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

// PATCH conditionné (compare-and-swap) — voir api/paiement-webhook-stripe.js
// pour le même patron : ne renvoie que les lignes RÉELLEMENT modifiées.
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

function basePaypal(sandbox){
  return sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

async function jetonPaypal(clientId, clientSecret, sandbox){
  const r = await fetch(`${basePaypal(sandbox)}/v1/oauth2/token`, {
    method: 'POST',
    headers: {
      Authorization: `Basic ${Buffer.from(`${clientId}:${clientSecret}`).toString('base64')}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: 'grant_type=client_credentials'
  });
  const data = await r.json();
  if(!r.ok){
    throw new Error(`PayPal auth ${r.status} : ${data?.error_description || data?.error || 'erreur inconnue'}`);
  }
  return data.access_token;
}

// Capture explicite d'une commande approuvée — c'est CET appel, et lui seul,
// qui déplace l'argent. `ok:false` avec `dejaCapturee:true` signifie que ce
// retour a déjà été traité une première fois (rechargement de page) : pas
// une erreur, PayPal refuse juste de capturer deux fois la même commande.
async function capturerCommandePaypal(accessToken, sandbox, orderId){
  const r = await fetch(`${basePaypal(sandbox)}/v2/checkout/orders/${orderId}/capture`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }
  });
  const data = await r.json();
  const dejaCapturee = !r.ok && (data?.details || []).some(d => d.issue === 'ORDER_ALREADY_CAPTURED');
  return { ok: r.ok, dejaCapturee, data };
}

function formaterEuros(n){
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
}
function echapperHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

// Identique à api/paiement-webhook-stripe.js — dupliqué à dessein.
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

async function envoyerEmail({ to, replyTo, subject, html, attachments }){
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST',
    headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], reply_to: replyTo || undefined, subject, html, attachments })
  });
  if(!r.ok){
    const corps = await r.text().catch(() => '');
    throw new Error(`Resend ${r.status} : ${corps.slice(0, 200)}`);
  }
}

export default async function handler(req, res){
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète.' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const origine = `https://${req.headers.host}`;
  const ownerId = url.searchParams.get('o');
  const orderId = url.searchParams.get('token'); // ajouté par PayPal lui-même
  if(!ownerId || !orderId){
    return redirection(res, `${origine}/paiement-merci.html?statut=erreur`);
  }

  let paiements;
  try{
    paiements = await supabaseGet(
      `parametres_paiement?owner_id=eq.${ownerId}&select=paypal_client_id,paypal_client_secret,paypal_sandbox`);
  }catch(e){
    return redirection(res, `${origine}/paiement-merci.html?statut=erreur`);
  }
  const paiement = paiements[0];
  if(!paiement?.paypal_client_id || !paiement?.paypal_client_secret){
    return redirection(res, `${origine}/paiement-merci.html?statut=erreur`);
  }

  let accessToken, capture;
  try{
    accessToken = await jetonPaypal(paiement.paypal_client_id, paiement.paypal_client_secret, paiement.paypal_sandbox);
    capture = await capturerCommandePaypal(accessToken, paiement.paypal_sandbox, orderId);
  }catch(e){
    return redirection(res, `${origine}/paiement-merci.html?statut=erreur`);
  }

  if(!capture.ok && !capture.dejaCapturee){
    return redirection(res, `${origine}/paiement-merci.html?statut=erreur`);
  }
  // Capturée à l'instant mais pas encore au statut final (rare — ex. moyen de
  // paiement asynchrone type eCheck) : pas de webhook PayPal dans cette v1
  // pour rattraper la confirmation différée, donc pas de paiement_statut à
  // 'paye' tant que ce n'est pas COMPLETED — le praticien devra vérifier son
  // tableau de bord PayPal si ce cas se présente.
  if(capture.ok && capture.data.status !== 'COMPLETED'){
    return redirection(res, `${origine}/paiement-merci.html?statut=erreur`);
  }

  // À partir d'ici, l'argent est capturé (ou l'a déjà été lors d'un retour
  // précédent) quoi qu'il arrive côté Mirrio — la confirmation ci-dessous
  // est best-effort, jamais un motif d'afficher une erreur au client, qui a
  // bel et bien payé.
  let rdvsConfirmes;
  try{
    rdvsConfirmes = await supabasePatchConditionnel(
      `rendez_vous?paiement_reference=eq.${orderId}&owner_id=eq.${ownerId}&paiement_statut=eq.en_attente`,
      { paiement_statut: 'paye' }
    );
  }catch(e){
    return redirection(res, `${origine}/paiement-merci.html?statut=succes`);
  }
  if(!rdvsConfirmes.length){
    // Retour PayPal rejoué (déjà confirmé la première fois) — rien à refaire.
    return redirection(res, `${origine}/paiement-merci.html?statut=succes`);
  }
  const rdv = rdvsConfirmes[0];

  try{
    const [liees, clients, profils, facturation] = await Promise.all([
      // Voir schema-v13 : un rendez-vous peut porter plusieurs prestations,
      // la liste complète vit dans rendez_vous_prestations.
      supabaseGet(`rendez_vous_prestations?rendez_vous_id=eq.${rdv.id}&select=position,prestations(libelle,prix_unitaire,tva_taux)&order=position.asc`),
      supabaseGet(`clients?id=eq.${rdv.client_id}&select=full_name,email,phone`),
      supabaseGet(`profiles?id=eq.${ownerId}&select=business_name,full_name,logo_url`),
      supabaseGet(`parametres_facturation?owner_id=eq.${ownerId}&select=emetteur_nom,emetteur_email`)
    ]);
    // Rétrocompatible : un rendez-vous sans ligne dans rendez_vous_prestations
    // (saisi à la main, ou créé avant schema-v13) retombe sur prestation_id.
    let prestationsOrdonnees = liees.map(l => l.prestations).filter(Boolean);
    if(!prestationsOrdonnees.length && rdv.prestation_id){
      prestationsOrdonnees = await supabaseGet(`prestations?id=eq.${rdv.prestation_id}&select=libelle,prix_unitaire,tva_taux`);
    }
    const client = clients[0];
    const profil = profils[0] || {};
    const params = facturation[0] || {};

    // SMS de confirmation (si le salon l'a activé) : paiement PayPal reçu.
    await smsConfirmation({ rdvId: rdv.id, ownerId, telephone: client?.phone || rdv.prospect_telephone, origine });

    // Heures creuses : remise appliquée à la réservation, répercutée sur la facture.
    const remise = Number(rdv.remise_pct) || 0, facteur = 1 - remise / 100;
    const docs = await supabasePost('documents', {
      owner_id: ownerId,
      client_id: rdv.client_id,
      type: 'facture',
      statut: 'paye',
      notes: `Réglée en ligne par PayPal le ${new Date().toLocaleDateString('fr-FR')}.${remise ? ` ${rdv.tarif === 'enfant' ? 'Tarif enfant' : (rdv.tarif === 'etudiant' ? 'Tarif étudiant' : 'Remise heures creuses')} : ${remise} % de réduction appliquée.` : ''}`
    });
    const doc = docs[0];

    if(prestationsOrdonnees.length){
      await Promise.all(prestationsOrdonnees.map((p, i) => supabasePost('document_lignes', {
        document_id: doc.id,
        description: p.libelle,
        quantite: 1,
        prix_unitaire: remise ? Math.round(Number(p.prix_unitaire) * facteur * 10000) / 10000 : p.prix_unitaire,
        position: i,
        tva_taux: p.tva_taux || 0
      })));
    }

    if(client?.email && RESEND_API_KEY){
      const jetonPartage = await nouveauJetonPartage();
      await supabasePatchConditionnel(`documents?id=eq.${doc.id}`, { partage_token: jetonPartage });

      const nomEmetteur = params.emetteur_nom || profil.business_name || profil.full_name || 'Mirrio';
      const ical = await icsParId(rdv.id, origine);
      let avec = null, adresse = null;
      try{
        if(rdv.intervenant_id) avec = (await supabaseGet(`vitrine_equipe?id=eq.${rdv.intervenant_id}&select=nom`))[0]?.nom || null;
        adresse = (await supabaseGet(`parametres_reservation?owner_id=eq.${ownerId}&select=adresse_annuaire`))[0]?.adresse_annuaire || null;
      }catch(e){ /* facultatif */ }
      let whatsappSalon = null;
      try{ whatsappSalon = lienWhatsapp((await supabaseGet(`vitrine?owner_id=eq.${ownerId}&select=whatsapp`))[0]?.whatsapp, nomEmetteur); }catch(e){ /* schema-v26 absent : pas de bouton */ }
      await envoyerEmail({
        to: client.email,
        replyTo: params.emetteur_email || undefined,
        attachments: pieceJointe(ical?.ics),
        subject: `Votre rendez-vous est confirmé chez ${nomEmetteur}`,
        html: gabaritConfirmation({
          salon: nomEmetteur, logoUrl: profil.logo_url, titre: 'Rendez-vous confirmé',
          reference: doc.numero || String(rdv.id).slice(0, 8).toUpperCase(),
          debut: rdv.date_debut, fin: rdv.date_fin, avec, adresse,
          lignes: prestationsOrdonnees.map(p => ({ libelle: p.libelle, prix: Number(p.prix_unitaire) * facteur * (1 + (Number(p.tva_taux) || 0) / 100) })),
          acompteDeduit: 0, reste: 0,
          paiement: { montant: Number(rdv.paiement_montant) || 0, date: new Date().toISOString(), moyen: 'PayPal' },
          boutons: [
            { href: lienEspace(client.email, origine), texte: 'Voir ou annuler mon rendez-vous', fort: true },
            ...(ical?.lien ? [{ href: ical.lien, texte: 'Ajouter à mon agenda' }] : []),
            { href: `${origine}/voir-document.html?t=${jetonPartage}`, texte: 'Voir ma facture' },
            ...(whatsappSalon ? [{ href: whatsappSalon, texte: 'Une question ? WhatsApp' }] : [])
          ]
        })
      });
    }
  }catch(e){
    // Le paiement reste confirmé même si la facture/l'email a raté — pas de
    // filet de rattrapage automatique (à traiter à la main depuis
    // devis-factures.html si jamais ça arrive, exactement comme en phase 1
    // Stripe).
  }

  return redirection(res, `${origine}/paiement-merci.html?statut=succes`);
}
