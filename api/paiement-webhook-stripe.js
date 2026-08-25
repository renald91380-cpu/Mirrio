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

// Phase 3 : délègue la confirmation (avec vérification anti-conflit) à la
// fonction SQL confirmer_reservation_payee() — voir
// schema-v10-paiement-rembourse-et-confirmation.sql pour le détail de
// pourquoi ça ne peut pas être fait de façon fiable en enchaînant de simples
// requêtes REST ici.
async function confirmerReservationPayee(rendezVousId, ownerId){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirmer_reservation_payee`, {
    method: 'POST',
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ p_rendez_vous_id: rendezVousId, p_owner_id: ownerId })
  });
  if(!r.ok){
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase RPC ${r.status} sur confirmer_reservation_payee : ${detail.slice(0, 200)}`);
  }
  const rows = await r.json();
  return rows[0];
}

async function creerRemboursementStripe(cleSecrete, paymentIntentId){
  const r = await fetch('https://api.stripe.com/v1/refunds', {
    method: 'POST',
    headers: { Authorization: `Bearer ${cleSecrete}`, 'Content-Type': 'application/x-www-form-urlencoded' },
    body: `payment_intent=${encodeURIComponent(paymentIntentId)}`
  });
  const data = await r.json();
  if(!r.ok){
    throw new Error(`Stripe refund ${r.status} : ${data?.error?.message || 'erreur inconnue'}`);
  }
  return data;
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
// Gabarit générique minimal, dupliqué de api/reservation-publique.js — sert
// aux deux emails de la phase 3 qui ne sont pas une facture (avis de
// conflit remboursé côté client, nouvelle réservation confirmée côté
// praticien).
function gabaritSimple({ titre, paragraphes }){
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light"><title>${echapperHtml(titre)}</title></head>
<body style="margin:0; padding:0; background:${PARCHDIM}; font-family:${SANS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PARCHDIM};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background:${PARCH}; border-radius:10px; overflow:hidden;">
<tr><td style="background:${INK}; padding:22px 32px;">
<span style="font-weight:700; font-size:17px; color:${PARCH};">Cadence</span>
</td></tr>
<tr><td style="padding:32px;">
<h1 style="margin:0 0 16px; font-size:20px; color:${INK};">${echapperHtml(titre)}</h1>
${paragraphes.map(p => `<p style="margin:0 0 14px; font-size:14.5px; line-height:1.6; color:${INK};">${p}</p>`).join('')}
</td></tr>
</table>
</td></tr>
</table>
</body></html>`;
}

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

// Phase 2 : un devis payé se convertit automatiquement en facture acquittée
// — même mécanique que le bouton "Convertir en facture" existant dans
// site/devis-factures.html (nouvelle ligne `documents`, lignes dupliquées,
// `converted_from` vers le devis d'origine), sauf que la facture naît déjà
// `statut:'paye'` au lieu de `'brouillon'`. Le devis d'origine passe à
// `statut:'accepte'` — payer vaut acceptation.
async function traiterPaiementDevis({ documentId, ownerId, req, res }){
  let docsConfirmes;
  try{
    docsConfirmes = await supabasePatchConditionnel(
      `documents?id=eq.${documentId}&owner_id=eq.${ownerId}&paiement_statut=eq.en_attente`,
      { paiement_statut: 'paye', statut: 'accepte' }
    );
  }catch(e){
    return json(res, 502, { error: 'Confirmation du paiement impossible.' });
  }
  if(!docsConfirmes.length){
    // Renvoi Stripe d'un événement déjà traité — rien à refaire.
    return json(res, 200, { recu: true, deja_traite: true });
  }
  const devis = docsConfirmes[0];

  // À partir d'ici, l'argent est marqué reçu quoi qu'il arrive : la
  // conversion en facture et l'email sont best-effort, jamais un motif de
  // renvoyer une erreur à Stripe (qui réessaierait indéfiniment un webhook
  // déjà utile). Si ça échoue, le praticien garde le bouton "Convertir en
  // facture" existant comme filet de rattrapage manuel.
  try{
    const [lignesDevis, clients, profils, facturation] = await Promise.all([
      supabaseGet(`document_lignes?document_id=eq.${devis.id}&select=description,quantite,prix_unitaire,tva_taux,position&order=position.asc`),
      supabaseGet(`clients?id=eq.${devis.client_id}&select=full_name,email`),
      supabaseGet(`profiles?id=eq.${ownerId}&select=business_name,full_name,logo_url`),
      supabaseGet(`parametres_facturation?owner_id=eq.${ownerId}&select=emetteur_nom,emetteur_email`)
    ]);
    const client = clients[0];
    const profil = profils[0] || {};
    const params = facturation[0] || {};

    const docs = await supabasePost('documents', {
      owner_id: ownerId,
      client_id: devis.client_id,
      type: 'facture',
      statut: 'paye',
      converted_from: devis.id,
      notes: `Devis ${devis.numero || ''} réglé en ligne par carte (Stripe) le ${new Date().toLocaleDateString('fr-FR')}.`
    });
    const facture = docs[0];

    if(lignesDevis.length){
      await Promise.all(lignesDevis.map(l => supabasePost('document_lignes', {
        document_id: facture.id,
        description: l.description,
        quantite: l.quantite,
        prix_unitaire: l.prix_unitaire,
        tva_taux: l.tva_taux || 0,
        position: l.position
      })));
    }

    if(client?.email && RESEND_API_KEY){
      const jetonPartage = await nouveauJetonPartage();
      await supabasePatchConditionnel(`documents?id=eq.${facture.id}`, { partage_token: jetonPartage });

      const origine = `https://${req.headers.host}`;
      const nomEmetteur = params.emetteur_nom || profil.business_name || profil.full_name || 'Cadence';
      await envoyerEmail({
        to: client.email,
        replyTo: params.emetteur_email || undefined,
        subject: `Facture ${facture.numero || ''} — ${nomEmetteur}`,
        html: gabaritEmailFacturePayee({
          nomEmetteur, logoUrl: profil.logo_url, nomClient: client.full_name,
          numero: facture.numero, montant: devis.paiement_montant,
          lienDocument: `${origine}/voir-document.html?t=${jetonPartage}`
        })
      });
    }
  }catch(e){ /* voir commentaire ci-dessus — best-effort */ }

  return json(res, 200, { recu: true });
}

// Phase 3 : rendez-vous créé par une réservation en ligne payée — `client_id`
// est encore vide (voir api/reservation-publique.js, prospect_* renseignés à
// la place). La confirmation passe par confirmer_reservation_payee(), seule
// façon fiable de revérifier l'absence de conflit ET créer la fiche client
// de façon atomique — voir schema-v10-paiement-rembourse-et-confirmation.sql
// pour le détail du pourquoi de simples requêtes REST enchaînées ici ne
// suffiraient pas à empêcher une double réservation entre deux paiements
// concurrents sur des créneaux qui se chevauchent.
async function traiterConfirmationReservation({ rdv, session, ownerId, stripeSecretKey, req, res }){
  let resultat;
  try{
    resultat = await confirmerReservationPayee(rdv.id, ownerId);
  }catch(e){
    // Le paiement est déjà marqué 'paye' (compare-and-swap fait plus haut,
    // avant cet appel) — pas la peine de faire réessayer Stripe
    // indéfiniment sur une erreur qui ne fait que se répéter. Le praticien
    // verra la ligne 'en_attente' avec paiement 'paye' dans son agenda et
    // pourra confirmer à la main si jamais ça arrive vraiment.
    return json(res, 200, { recu: true, erreur: 'confirmation_impossible' });
  }

  if(!resultat || resultat.resultat === 'introuvable'){
    // Garde-fou, ne devrait pas arriver en pratique : le rendez-vous
    // existait forcément pour que ce paiement ait pu être créé.
    return json(res, 200, { recu: true, ignore: 'rendez-vous introuvable' });
  }

  if(resultat.resultat === 'conflit'){
    // Un autre rendez-vous confirmé occupait déjà ce créneau au moment du
    // paiement — remboursement automatique, jamais d'argent gardé sans
    // service, jamais de double réservation silencieuse.
    try{
      if(stripeSecretKey && session.payment_intent){
        await creerRemboursementStripe(stripeSecretKey, session.payment_intent);
        await supabasePatchConditionnel(
          `rendez_vous?id=eq.${rdv.id}&owner_id=eq.${ownerId}`,
          { paiement_statut: 'rembourse' }
        );
      }
    }catch(e){ /* best-effort — le praticien garde la main depuis l'agenda */ }

    try{
      if(resultat.prospect_email && RESEND_API_KEY){
        await envoyerEmail({
          to: resultat.prospect_email,
          subject: 'Votre créneau vient d’être pris — remboursement en cours',
          html: gabaritSimple({
            titre: 'Ce créneau vient d’être réservé entre-temps',
            paragraphes: [
              `Bonjour ${echapperHtml(resultat.prospect_nom || '')},`,
              `Nous sommes désolés : le créneau que vous veniez de payer a été réservé par quelqu’un d’autre quelques instants avant vous. Votre paiement va être intégralement remboursé (comptez quelques jours ouvrés selon votre banque).`,
              `N’hésitez pas à choisir un autre créneau sur la page de réservation.`
            ]
          })
        });
      }
    }catch(e){ /* best-effort */ }

    return json(res, 200, { recu: true, conflit: true });
  }

  // resultat.resultat === 'confirme' : fiche client créée (ou déjà créée par
  // un renvoi précédent — idempotent). Génère la facture acquittée comme en
  // phase 1, PLUS un email de notification au praticien : contrairement aux
  // phases 1/2, il n'était pas déjà au courant de ce rendez-vous.
  try{
    const [liees, profils, facturation] = await Promise.all([
      // Voir schema-v13 : la liste complète des prestations de ce
      // rendez-vous (pas seulement rendez_vous.prestation_id, qui ne porte
      // que la première depuis une réservation multi-prestations).
      supabaseGet(`rendez_vous_prestations?rendez_vous_id=eq.${rdv.id}&select=position,prestations(libelle,prix_unitaire,tva_taux)&order=position.asc`),
      supabaseGet(`profiles?id=eq.${ownerId}&select=business_name,full_name,logo_url`),
      supabaseGet(`parametres_facturation?owner_id=eq.${ownerId}&select=emetteur_nom,emetteur_email`)
    ]);
    let prestationsOrdonnees = liees.map(l => l.prestations).filter(Boolean);
    if(!prestationsOrdonnees.length && resultat.prestation_id){
      prestationsOrdonnees = await supabaseGet(`prestations?id=eq.${resultat.prestation_id}&select=libelle,prix_unitaire,tva_taux`);
    }
    const libelleCombine = prestationsOrdonnees.map(p => p.libelle).join(' + ');
    const profil = profils[0] || {};
    const params = facturation[0] || {};
    const nomEmetteur = params.emetteur_nom || profil.business_name || profil.full_name || 'Cadence';

    const docs = await supabasePost('documents', {
      owner_id: ownerId,
      client_id: resultat.client_id,
      type: 'facture',
      statut: 'paye',
      notes: `Réservation en ligne réglée par carte (Stripe) le ${new Date().toLocaleDateString('fr-FR')}.`
    });
    const doc = docs[0];

    if(prestationsOrdonnees.length){
      await Promise.all(prestationsOrdonnees.map((p, i) => supabasePost('document_lignes', {
        document_id: doc.id,
        description: p.libelle,
        quantite: 1,
        prix_unitaire: p.prix_unitaire,
        position: i,
        tva_taux: p.tva_taux || 0
      })));
    }

    const origine = `https://${req.headers.host}`;

    if(resultat.prospect_email && RESEND_API_KEY){
      const jetonPartage = await nouveauJetonPartage();
      await supabasePatchConditionnel(`documents?id=eq.${doc.id}`, { partage_token: jetonPartage });
      await envoyerEmail({
        to: resultat.prospect_email,
        replyTo: params.emetteur_email || undefined,
        subject: `Facture ${doc.numero || ''} — ${nomEmetteur}`,
        html: gabaritEmailFacturePayee({
          nomEmetteur, logoUrl: profil.logo_url, nomClient: resultat.prospect_nom,
          numero: doc.numero, montant: resultat.paiement_montant,
          lienDocument: `${origine}/voir-document.html?t=${jetonPartage}`
        })
      });
    }

    // Le praticien n'a rien initié ici (contrairement aux phases 1/2) — à
    // prévenir qu'un nouveau créneau vient d'être confirmé automatiquement
    // dans son agenda, sur le même modèle que la notification "nouvelle
    // demande" de api/reservation-publique.js.
    if(params.emetteur_email && RESEND_API_KEY){
      await envoyerEmail({
        to: params.emetteur_email,
        replyTo: resultat.prospect_email || undefined,
        subject: `Nouveau rendez-vous payé et confirmé — ${resultat.prospect_nom || ''}`,
        html: gabaritSimple({
          titre: 'Nouveau rendez-vous confirmé automatiquement',
          paragraphes: [
            `<strong>${echapperHtml(resultat.prospect_nom || 'Un client')}</strong> vient de réserver et payer un créneau en ligne — le paiement a automatiquement confirmé le rendez-vous.`,
            `${libelleCombine ? echapperHtml(libelleCombine) : 'Prestation'} — le ${echapperHtml(new Date(resultat.date_debut).toLocaleString('fr-FR', { dateStyle: 'full', timeStyle: 'short' }))}.`,
            `Contact : ${echapperHtml(resultat.prospect_email || '')}${resultat.prospect_telephone ? ` — ${echapperHtml(resultat.prospect_telephone)}` : ''}.`,
            `Aucune action n’est requise : c’est déjà confirmé dans votre agenda.`
          ]
        })
      });
    }
  }catch(e){
    // Le rendez-vous reste confirmé même si la facture/les emails ont raté
    // — filet de rattrapage manuel possible depuis l'agenda si besoin.
  }

  return json(res, 200, { recu: true });
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
      // `stripe_secret_key` : nécessaire ici pour un remboursement éventuel
      // (phase 3, conflit de créneau) — voir traiterConfirmationReservation.
      `parametres_paiement?owner_id=eq.${ownerId}&select=stripe_actif,stripe_webhook_secret,stripe_secret_key`);
  }catch(e){
    // Ne renvoie jamais de détail à un appelant non authentifié à ce stade
    // (la signature n'est pas encore vérifiée) — 500 générique, Stripe
    // réessaiera.
    return json(res, 500, { error: 'Erreur temporaire.' });
  }
  const secret = paiements[0]?.stripe_webhook_secret;
  const stripeSecretKey = paiements[0]?.stripe_secret_key;
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
  const documentId = session?.metadata?.document_id;
  const ownerIdSession = session?.metadata?.owner_id;
  if((!rendezVousId && !documentId) || !ownerIdSession){
    return json(res, 200, { recu: true, ignore: 'métadonnées absentes' });
  }
  // Garde-fou supplémentaire : l'espace qui a créé la session doit être
  // exactement celui de l'URL du webhook — protège d'une mauvaise
  // configuration croisée (une clé secrète collée dans le mauvais espace).
  if(ownerIdSession !== ownerId){
    return json(res, 200, { recu: true, ignore: 'espace non correspondant' });
  }

  // `rendez_vous` (phase 1, agenda) et `documents` (phase 2, devis) portent
  // toutes deux les mêmes colonnes paiement_* — voir schema-v8-paiements.sql
  // et schema-v9-paiement-devis.sql.
  const table = rendezVousId ? 'rendez_vous' : 'documents';
  const cibleId = rendezVousId || documentId;

  if(event.type === 'checkout.session.expired'){
    // Libère la tentative de paiement pour permettre d'en redemander une —
    // ne touche rien si le paiement a entre-temps déjà abouti (idempotence
    // par le même filtre `paiement_statut=eq.en_attente`).
    try{
      await supabasePatchConditionnel(
        `${table}?id=eq.${cibleId}&owner_id=eq.${ownerId}&paiement_statut=eq.en_attente`,
        { paiement_statut: 'echoue' }
      );
    }catch(e){ /* Stripe réessaiera si ça échoue vraiment côté réseau */ }
    return json(res, 200, { recu: true });
  }

  if(session.payment_status !== 'paid'){
    return json(res, 200, { recu: true, ignore: 'paiement non finalisé' });
  }

  if(documentId){
    return traiterPaiementDevis({ documentId, ownerId, req, res });
  }

  // --- Rendez-vous déjà confirmé (phase 1, agenda) ---
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

  // Phase 3 : un rendez-vous issu d'une réservation en ligne n'a pas encore
  // de client_id à ce stade (voir api/reservation-publique.js) — bascule sur
  // le parcours dédié (anti-conflit + auto-confirmation) plutôt que de
  // continuer ci-dessous, qui suppose client_id/prestation_id déjà présents
  // (vrai uniquement pour un rendez-vous déjà confirmé, phase 1).
  if(!rdv.client_id){
    return traiterConfirmationReservation({ rdv, session, ownerId, stripeSecretKey, req, res });
  }

  // --- Phase 1 (agenda) : rendez-vous déjà confirmé, client déjà connu ---
  // À partir d'ici, l'argent est marqué reçu quoi qu'il arrive : la
  // génération de facture et l'email sont best-effort, jamais un motif de
  // renvoyer une erreur à Stripe (qui réessaierait indéfiniment un webhook
  // déjà utile).
  try{
    const [liees, clients, profils, facturation] = await Promise.all([
      // Voir schema-v13 : la liste complète des prestations de ce
      // rendez-vous (pas seulement rendez_vous.prestation_id, qui ne porte
      // que la première depuis une réservation multi-prestations).
      supabaseGet(`rendez_vous_prestations?rendez_vous_id=eq.${rdv.id}&select=position,prestations(libelle,prix_unitaire,tva_taux)&order=position.asc`),
      supabaseGet(`clients?id=eq.${rdv.client_id}&select=full_name,email`),
      supabaseGet(`profiles?id=eq.${ownerId}&select=business_name,full_name,logo_url`),
      supabaseGet(`parametres_facturation?owner_id=eq.${ownerId}&select=emetteur_nom,emetteur_email`)
    ]);
    let prestationsOrdonnees = liees.map(l => l.prestations).filter(Boolean);
    if(!prestationsOrdonnees.length && rdv.prestation_id){
      prestationsOrdonnees = await supabaseGet(`prestations?id=eq.${rdv.prestation_id}&select=libelle,prix_unitaire,tva_taux`);
    }
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

    if(prestationsOrdonnees.length){
      await Promise.all(prestationsOrdonnees.map((p, i) => supabasePost('document_lignes', {
        document_id: doc.id,
        description: p.libelle,
        quantite: 1,
        prix_unitaire: p.prix_unitaire,
        position: i,
        tva_taux: p.tva_taux || 0
      })));
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
