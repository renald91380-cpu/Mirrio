// Cadence — création d'une session de paiement (Stripe ou PayPal), soit pour
// un rendez-vous déjà confirmé (phase 1, depuis site/agenda.html), soit pour
// un devis déjà émis (phase 2, depuis site/devis-factures.html — payer un
// devis le convertit automatiquement en facture acquittée, voir le webhook).
// PayPal n'est câblé QUE pour la surface « rendez-vous déjà confirmé » —
// même périmètre que Stripe phase 1, la plus simple (pas de client anonyme,
// pas de risque de double réservation). Le devis reste Stripe uniquement
// pour l'instant.
//
//   POST /api/paiement-creer-checkout   { rendez_vous_id, provider? }  — ou —  { document_id }
//   provider : 'stripe' (défaut) ou 'paypal' — ignoré pour document_id.
//   Authorization: Bearer <jeton d'accès Supabase du praticien connecté>
//
// Même patron d'authentification que api/envoyer-document.js : bearer token
// → /auth/v1/user → current_workspace_id() recalculé côté serveur (jamais
// fait confiance à un espaceId envoyé par le client). Zéro dépendance npm,
// même parti pris que le reste de api/.
//
// Le montant est TOUJOURS recalculé ici depuis `prestations.prix_unitaire`,
// jamais transmis par le navigateur — un rendez-vous sans prestation
// associée ne peut pas demander de paiement (voir CLAUDE.md §3.12 : la
// sélection de prestation existe déjà dans agenda.html, mais reste
// optionnelle sur un rendez-vous saisi à la main).
//
// Variables d'environnement attendues :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Clé publishable — déjà exposée côté client dans site/supabase-config.js,
// sans risque à relire ici pour authentifier l'appelant auprès de /auth/v1/user.
const SUPABASE_ANON_KEY = 'sb_publishable_ZO93qi6gjZvsHU5lxKqLWA_fdif4BHl';

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
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify(corps)
  });
  if(!r.ok){
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase PATCH ${r.status} sur ${chemin} : ${detail.slice(0, 200)}`);
  }
}

async function utilisateurConnecte(jeton){
  const r = await fetch(`${SUPABASE_URL}/auth/v1/user`, {
    headers: { apikey: SUPABASE_ANON_KEY, Authorization: `Bearer ${jeton}` }
  });
  if(!r.ok) return null;
  return r.json();
}

// Réplique current_workspace_id() côté serveur — même fonction que
// api/envoyer-document.js, dupliquée à dessein (pas de module partagé dans
// api/, voir CLAUDE.md).
async function espaceActif(userId){
  const profils = await supabaseGet(`profiles?id=eq.${userId}&select=espace_actif_id`);
  const souhaite = profils[0]?.espace_actif_id;
  if(!souhaite) return userId;
  const membres = await supabaseGet(
    `workspace_members?workspace_id=eq.${souhaite}&user_id=eq.${userId}&statut=eq.actif&select=id`);
  return membres.length ? souhaite : userId;
}

// Stripe attend un corps `application/x-www-form-urlencoded` avec la
// notation à crochets pour les objets/tableaux imbriqués (pas de JSON) —
// aucune bibliothèque officielle utilisée ici, juste cet aplatisseur minimal.
function aplatirFormulaire(objet, prefixe = ''){
  const paires = [];
  for(const [cle, valeur] of Object.entries(objet)){
    const nomChamp = prefixe ? `${prefixe}[${cle}]` : cle;
    if(valeur === undefined || valeur === null) continue;
    if(typeof valeur === 'object' && !Array.isArray(valeur)){
      paires.push(...aplatirFormulaire(valeur, nomChamp));
    }else if(Array.isArray(valeur)){
      valeur.forEach((v, i) => paires.push(...aplatirFormulaire({ [i]: v }, nomChamp)));
    }else{
      paires.push(`${encodeURIComponent(nomChamp)}=${encodeURIComponent(valeur)}`);
    }
  }
  return paires;
}

// Identique à envoyer-document.js — total TTC d'un devis à partir de ses
// lignes, TVA par ligne (jamais un taux unique par document, une facture
// peut légalement mélanger plusieurs taux). Dupliqué à dessein, pas de
// module partagé dans api/.
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

async function creerSessionStripe(cleSecrete, params){
  const corps = aplatirFormulaire(params).join('&');
  const r = await fetch('https://api.stripe.com/v1/checkout/sessions', {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${cleSecrete}`,
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: corps
  });
  const data = await r.json();
  if(!r.ok){
    throw new Error(`Stripe ${r.status} : ${data?.error?.message || 'erreur inconnue'}`);
  }
  return data;
}

// PayPal, surface agenda uniquement (voir en-tête). Deux hôtes d'API selon
// le mode choisi par le praticien (site/parametres.html) — contrairement à
// Stripe, une clé PayPal ne porte aucune marque test/live reconnaissable, il
// faut donc que le mode soit un réglage explicite (paypal_sandbox).
function basePaypal(sandbox){
  return sandbox ? 'https://api-m.sandbox.paypal.com' : 'https://api-m.paypal.com';
}

// OAuth2 client_credentials — un jeton neuf à chaque demande de paiement,
// pas de cache : ce n'est pas un chemin à fort trafic (un praticien qui
// clique « Demander un paiement »), pas la peine de gérer l'expiration d'un
// jeton mis en cache pour économiser un aller-retour occasionnel.
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

async function creerCommandePaypal(accessToken, sandbox, corps){
  const r = await fetch(`${basePaypal(sandbox)}/v2/checkout/orders`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' },
    body: JSON.stringify(corps)
  });
  const data = await r.json();
  if(!r.ok){
    throw new Error(`PayPal ${r.status} : ${data?.message || data?.error_description || 'erreur inconnue'}`);
  }
  return data;
}

// Phase 2 : demander un paiement sur un devis déjà émis. Payer le devis le
// convertit automatiquement en facture acquittée — voir
// api/paiement-webhook-stripe.js, qui fait le travail à la confirmation.
async function creerCheckoutDevis({ documentId, espaceId, req, res }){
  let docs;
  try{
    docs = await supabaseGet(
      `documents?id=eq.${documentId}&select=id,owner_id,type,numero,statut,client_id,paiement_statut,` +
      `document_lignes(description,quantite,prix_unitaire,tva_taux)`
    );
  }catch(e){
    return json(res, 502, { error: 'Lecture du devis impossible.' });
  }
  const doc = docs[0];
  // L'appartenance à l'ESPACE fait foi, comme envoyer-document.js : un
  // collaborateur peut demander un paiement sur un devis du propriétaire.
  if(!doc || doc.owner_id !== espaceId){
    return json(res, 404, { error: 'Devis introuvable.' });
  }
  if(doc.type !== 'devis'){
    return json(res, 400, { error: 'Seul un devis peut recevoir une demande de paiement — une facture se règle directement.' });
  }
  if(!['brouillon', 'envoye'].includes(doc.statut)){
    return json(res, 400, { error: 'Ce devis a déjà été traité (accepté, refusé, ou déjà réglé).' });
  }
  if(!doc.client_id){
    return json(res, 400, { error: "Ce devis n'a pas de client associé." });
  }
  if(!['non_requis', 'echoue'].includes(doc.paiement_statut)){
    return json(res, 409, { error: doc.paiement_statut === 'paye' ? 'Ce devis est déjà payé.' : 'Un paiement est déjà en cours pour ce devis.' });
  }
  if(!doc.document_lignes?.length){
    return json(res, 400, { error: 'Ce devis est vide — impossible de calculer un montant.' });
  }

  let clients, paiements, profils, facturations;
  try{
    [clients, paiements, profils, facturations] = await Promise.all([
      supabaseGet(`clients?id=eq.${doc.client_id}&select=full_name,email`),
      supabaseGet(`parametres_paiement?owner_id=eq.${espaceId}&select=stripe_actif,stripe_secret_key`),
      supabaseGet(`profiles?id=eq.${espaceId}&select=business_name,full_name`),
      supabaseGet(`parametres_facturation?owner_id=eq.${espaceId}&select=assujetti_tva,tva_taux_defaut`)
    ]);
  }catch(e){
    return json(res, 502, { error: 'Lecture des réglages impossible.' });
  }
  const client = clients[0];
  const paiement = paiements[0];
  if(!paiement?.stripe_actif || !paiement?.stripe_secret_key){
    return json(res, 400, { error: "Le paiement en ligne n'est pas configuré (Paramètres → Paiement)." });
  }
  const nomPraticien = profils[0]?.business_name || profils[0]?.full_name || 'Cadence';
  const params = facturations[0] || {};

  const montantTTC = totalTTC(doc.document_lignes, params.assujetti_tva, params.tva_taux_defaut);
  const montantCentimes = Math.round(montantTTC * 100);
  if(!(montantCentimes > 0)){
    return json(res, 400, { error: 'Le montant de ce devis est invalide.' });
  }

  const origine = `https://${req.headers.host}`;

  let session;
  try{
    session = await creerSessionStripe(paiement.stripe_secret_key, {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: montantCentimes,
          product_data: { name: `Devis ${doc.numero || ''} — ${nomPraticien}` }
        }
      }],
      customer_email: client?.email || undefined,
      success_url: `${origine}/paiement-merci.html?statut=succes`,
      cancel_url: `${origine}/paiement-merci.html?statut=annule`,
      metadata: { document_id: doc.id, owner_id: espaceId }
    });
  }catch(e){
    return json(res, 502, { error: 'La création du paiement a échoué.', detail: String(e.message || e) });
  }

  try{
    await supabasePatch(`documents?id=eq.${doc.id}`, {
      paiement_statut: 'en_attente',
      paiement_montant: montantTTC,
      paiement_provider: 'stripe',
      paiement_reference: session.id
    });
  }catch(e){
    return json(res, 502, { error: 'Impossible d’enregistrer la demande de paiement.' });
  }

  return json(res, 200, { url: session.url });
}

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète.' });
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
  const rendezVousId = body?.rendez_vous_id;
  const documentId = body?.document_id;
  const provider = body?.provider === 'paypal' ? 'paypal' : 'stripe';
  if(!rendezVousId && !documentId){
    return json(res, 400, { error: 'rendez_vous_id ou document_id manquant.' });
  }
  if(rendezVousId && documentId){
    return json(res, 400, { error: "Un seul des deux à la fois." });
  }

  let espaceId;
  try{
    espaceId = await espaceActif(utilisateur.id);
  }catch(e){
    return json(res, 502, { error: 'Vérification impossible.' });
  }

  if(documentId){
    return creerCheckoutDevis({ documentId, espaceId, req, res });
  }

  let rdvs;
  try{
    rdvs = await supabaseGet(
      `rendez_vous?id=eq.${rendezVousId}&select=id,owner_id,titre,statut,client_id,prestation_id,paiement_statut`
    );
  }catch(e){
    return json(res, 502, { error: 'Lecture du rendez-vous impossible.' });
  }
  const rdv = rdvs[0];
  // L'appartenance à l'ESPACE fait foi, comme envoyer-document.js : un
  // collaborateur peut demander un paiement sur un rendez-vous du propriétaire.
  if(!rdv || rdv.owner_id !== espaceId){
    return json(res, 404, { error: 'Rendez-vous introuvable.' });
  }
  // Phase 1 : uniquement un rendez-vous déjà confirmé (pas 'en_attente', qui
  // relève de la réservation en ligne — pas encore câblée) et non annulé.
  if(rdv.statut === 'annule' || rdv.statut === 'en_attente' || !rdv.client_id){
    return json(res, 400, { error: 'Ce rendez-vous doit être confirmé, avec une fiche client, avant de demander un paiement.' });
  }
  if(!['non_requis', 'echoue'].includes(rdv.paiement_statut)){
    return json(res, 409, { error: rdv.paiement_statut === 'paye' ? 'Ce rendez-vous est déjà payé.' : 'Un paiement est déjà en cours pour ce rendez-vous.' });
  }
  if(!rdv.prestation_id){
    return json(res, 400, { error: "Ce rendez-vous n'a pas de prestation associée — impossible de calculer un montant. Choisissez une prestation dans l'agenda avant de demander un paiement." });
  }

  let prestations, clients, paiements, profils;
  try{
    [prestations, clients, paiements, profils] = await Promise.all([
      supabaseGet(`prestations?id=eq.${rdv.prestation_id}&owner_id=eq.${espaceId}&select=libelle,prix_unitaire,tva_taux`),
      supabaseGet(`clients?id=eq.${rdv.client_id}&select=full_name,email`),
      supabaseGet(`parametres_paiement?owner_id=eq.${espaceId}&select=stripe_actif,stripe_secret_key,paypal_actif,paypal_client_id,paypal_client_secret,paypal_sandbox`),
      supabaseGet(`profiles?id=eq.${espaceId}&select=business_name,full_name`)
    ]);
  }catch(e){
    return json(res, 502, { error: 'Lecture des réglages impossible.' });
  }
  const prestation = prestations[0];
  if(!prestation){
    return json(res, 404, { error: 'Prestation introuvable.' });
  }
  const client = clients[0];
  const paiement = paiements[0];
  if(provider === 'stripe' && (!paiement?.stripe_actif || !paiement?.stripe_secret_key)){
    return json(res, 400, { error: "Le paiement par carte (Stripe) n'est pas configuré (Paramètres → Paiement)." });
  }
  if(provider === 'paypal' && (!paiement?.paypal_actif || !paiement?.paypal_client_id || !paiement?.paypal_client_secret)){
    return json(res, 400, { error: "Le paiement PayPal n'est pas configuré (Paramètres → Paiement)." });
  }
  const nomPraticien = profils[0]?.business_name || profils[0]?.full_name || 'Cadence';

  // `prestations.prix_unitaire` est HT, exactement comme `document_lignes` —
  // même paire de colonnes (prix_unitaire, tva_taux), même sens. Le montant
  // réellement facturé/encaissé est donc le TTC recalculé ici, jamais le HT
  // brut : c'est ce montant TTC qui part chez Stripe ET qui est conservé
  // dans `paiement_montant`, pour que la facture générée par le webhook
  // (api/paiement-webhook-stripe.js), qui relit la même prestation, totalise
  // exactement ce qui a été payé.
  const tauxTva = Number(prestation.tva_taux) || 0;
  const montantTTC = Number(prestation.prix_unitaire) * (1 + tauxTva / 100);
  const montantCentimes = Math.round(montantTTC * 100);
  if(!(montantCentimes > 0)){
    return json(res, 400, { error: 'Le prix de cette prestation est invalide.' });
  }

  const origine = `https://${req.headers.host}`;

  if(provider === 'paypal'){
    // Commande PayPal (intent CAPTURE, non capturée ici) : le client approuve
    // sur paypal.com, qui le redirige ensuite vers `return_url` — c'est LÀ
    // que l'argent bouge réellement, via api/paiement-capturer-paypal.js
    // (capture explicite côté serveur, pas de webhook PayPal dans cette
    // v1 : voir l'en-tête de ce fichier-là pour le compromis assumé). `?o=`
    // dans return_url/cancel_url permet à ces deux endpoints publics de
    // retrouver les identifiants PayPal DE CE praticien sans session.
    let accessToken, commande;
    try{
      accessToken = await jetonPaypal(paiement.paypal_client_id, paiement.paypal_client_secret, paiement.paypal_sandbox);
      commande = await creerCommandePaypal(accessToken, paiement.paypal_sandbox, {
        intent: 'CAPTURE',
        purchase_units: [{
          custom_id: rdv.id,
          description: `${prestation.libelle} — ${nomPraticien}`.slice(0, 127),
          amount: { currency_code: 'EUR', value: montantTTC.toFixed(2) }
        }],
        application_context: {
          brand_name: nomPraticien.slice(0, 127),
          user_action: 'PAY_NOW',
          return_url: `${origine}/api/paiement-capturer-paypal?o=${espaceId}`,
          cancel_url: `${origine}/api/paiement-annuler-paypal?o=${espaceId}&rdv=${rdv.id}`
        }
      });
    }catch(e){
      return json(res, 502, { error: 'La création du paiement PayPal a échoué.', detail: String(e.message || e) });
    }
    const lienApprobation = commande.links?.find(l => l.rel === 'approve')?.href;
    if(!lienApprobation){
      return json(res, 502, { error: 'PayPal n’a pas renvoyé de lien de paiement.' });
    }

    try{
      await supabasePatch(`rendez_vous?id=eq.${rdv.id}`, {
        paiement_statut: 'en_attente',
        paiement_montant: montantTTC,
        paiement_provider: 'paypal',
        paiement_reference: commande.id
      });
    }catch(e){
      return json(res, 502, { error: 'Impossible d’enregistrer la demande de paiement.' });
    }

    return json(res, 200, { url: lienApprobation });
  }

  let session;
  try{
    session = await creerSessionStripe(paiement.stripe_secret_key, {
      mode: 'payment',
      payment_method_types: ['card'],
      line_items: [{
        quantity: 1,
        price_data: {
          currency: 'eur',
          unit_amount: montantCentimes,
          product_data: { name: `${prestation.libelle} — ${nomPraticien}` }
        }
      }],
      customer_email: client?.email || undefined,
      success_url: `${origine}/paiement-merci.html?statut=succes`,
      cancel_url: `${origine}/paiement-merci.html?statut=annule`,
      metadata: { rendez_vous_id: rdv.id, owner_id: espaceId }
    });
  }catch(e){
    return json(res, 502, { error: 'La création du paiement a échoué.', detail: String(e.message || e) });
  }

  try{
    await supabasePatch(`rendez_vous?id=eq.${rdv.id}`, {
      paiement_statut: 'en_attente',
      paiement_montant: montantTTC,
      paiement_provider: 'stripe',
      paiement_reference: session.id
    });
  }catch(e){
    return json(res, 502, { error: 'Impossible d’enregistrer la demande de paiement.' });
  }

  return json(res, 200, { url: session.url });
}
