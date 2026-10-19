// Mirrio — création d'un rendez-vous « en attente » depuis le widget public
// de réservation en ligne (site/reservation.html).
//
//   POST /api/reservation-publique
//   { slug, prestation_id, date_debut, nom, email, telephone? }
//
// Crée une ligne `rendez_vous` avec `statut:'en_attente'` et `client_id:null` —
// les coordonnées du prospect vivent dans les colonnes `prospect_*` jusqu'à ce
// que le praticien confirme (et crée alors lui-même la fiche client depuis
// site/agenda.html) ou refuse. Aucune fiche client n'est créée ici.
//
// Toutes les règles (jours ouverts, horaires, délai minimum, horizon,
// chevauchement) sont re-vérifiées ici côté serveur — défense en profondeur
// contre un appel forgé qui contournerait le widget. La fenêtre de course
// entre la lecture des créneaux (api/reservation-disponibilites.js) et cet
// insert reste possible en théorie (v1, choix assumé — voir CLAUDE.md) ;
// cette re-vérification la réduit sans l'éliminer complètement.
//
// Emails best-effort (jamais bloquants), même logique que
// api/envoyer-document.js : sans RESEND_API_KEY configurée, on ignore
// simplement l'envoi plutôt que de faire échouer la réservation.
//
// Zéro dépendance npm, comme le reste de api/.
//
// Variables d'environnement attendues :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM

import { icsParId, pieceJointe } from './_ics.js';

import { contexte, occupes as chargerOccupes, choisirRessource } from './_dispo.js';
import { smsConfirmation } from './_sms.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Mirrio <onboarding@resend.dev>';

const INK = '#1C2333', PARCH = '#F5F1E7', PARCHDIM = '#EAE4D4', AMBER = '#E2A63D';
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

async function supabasePost(chemin, corps){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    method: 'POST',
    headers: {
      apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify(corps)
  });
  if(!r.ok){
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase POST ${r.status} sur ${chemin} : ${detail.slice(0, 200)}`);
  }
}

// Variante qui renvoie la ligne créée — seulement utile quand un paiement
// doit suivre (phase 3) : il faut l'id du rendez-vous fraîchement inséré
// pour les métadonnées de la session Stripe. Le chemin sans paiement garde
// `supabasePost` (return=minimal), inchangé.
async function supabasePostRepresentation(chemin, corps){
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

// Insère un rendez-vous avec les colonnes de paiement de schema-v19 ; si la
// migration n'a pas encore été exécutée (colonne inconnue), réessaie sans
// elles plutôt que de faire échouer toute la réservation.
async function insererRendezVous(corps, infos){
  try{
    return await supabasePostRepresentation('rendez_vous', { ...corps, ...infos });
  }catch(e){
    if(!/paiement_mode|total_ttc|reste_sur_place|intervenant_id|PGRST204|42703/.test(String(e.message))) throw e;
    return supabasePostRepresentation('rendez_vous', corps);
  }
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

// Stripe attend un corps `application/x-www-form-urlencoded` avec la
// notation à crochets pour les objets/tableaux imbriqués — même aplatisseur
// que api/paiement-creer-checkout.js, dupliqué à dessein (pas de module
// partagé dans api/, voir CLAUDE.md).
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

// ------------------------------------------------------------ fuseau horaire
// Même helper que api/reservation-disponibilites.js (dupliqué à dessein : pas
// de fichier partagé dans api/, chaque route reste autonome — voir
// api/envoyer-document.js pour le même parti pris ailleurs dans le projet).
function composantsParis(date){
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', {
      timeZone: 'Europe/Paris', hourCycle: 'h23',
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit'
    }).formatToParts(date).map(p => [p.type, p.value])
  );
  return { annee: +parts.year, mois: +parts.month, jour: +parts.day, heure: +parts.hour, minute: +parts.minute };
}

function formaterEuros(n){
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
}
function formaterDateHeure(date){
  return new Intl.DateTimeFormat('fr-FR', {
    timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long', hour: '2-digit', minute: '2-digit'
  }).format(date);
}
function echapperHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
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

function gabaritSimple({ titre, paragraphes, accent }){
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light"><title>${echapperHtml(titre)}</title></head>
<body style="margin:0; padding:0; background:${PARCHDIM}; font-family:${SANS};">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PARCHDIM};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px; width:100%; background:${PARCH}; border-radius:10px; overflow:hidden;">
<tr><td style="background:${INK}; padding:22px 32px;">
<span style="font-weight:700; font-size:17px; color:${PARCH};">Mirrio</span>
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

export default async function handler(req, res){
  if(req.method !== 'POST'){
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète.' });
  }

  let body = req.body;
  if(typeof body === 'string'){
    try{ body = JSON.parse(body); }catch(e){ body = {}; }
  }
  const slug = String(body?.slug || '');
  // `prestation_ids` (tableau) est le format actuel — `prestation_id`
  // (singulier) reste accepté pour un appel plus ancien, converti dans la
  // même liste juste en dessous.
  const prestationIdsBrut = Array.isArray(body?.prestation_ids)
    ? body.prestation_ids
    : (body?.prestation_id ? [body.prestation_id] : []);
  const prestationIds = [...new Set(prestationIdsBrut.map(String).filter(Boolean))];
  const dateDebutStr = String(body?.date_debut || '');
  const nom = String(body?.nom || '').trim();
  const email = String(body?.email || '').trim();
  const telephone = String(body?.telephone || '').trim();
  // 'en_ligne' = CB, prix total ; 'sur_place' = acompte par carte + solde en espèces au salon.
  const modeDemande = body?.mode_paiement === 'sur_place' ? 'sur_place' : 'en_ligne';
  // Id d'un membre de l'équipe, ou 'any' / absent = premier disponible.
  const intervenantDemande = String(body?.intervenant_id || 'any');
  if(intervenantDemande !== 'any' && !/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(intervenantDemande)){
    return json(res, 400, { error: 'Intervenant invalide.' });
  }

  if(!/^[a-z0-9-]{3,40}$/.test(slug)){
    return json(res, 404, { error: 'Page de réservation introuvable.' });
  }
  const idValide = id => /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(id);
  if(!prestationIds.length || !prestationIds.every(idValide)){
    return json(res, 400, { error: 'Prestation invalide.' });
  }
  const dateDebut = new Date(dateDebutStr);
  if(isNaN(dateDebut.getTime()) || dateDebut.getTime() < Date.now()){
    return json(res, 400, { error: 'Créneau invalide.' });
  }
  if(nom.length < 2){
    return json(res, 400, { error: 'Indiquez votre nom.' });
  }
  if(!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)){
    return json(res, 400, { error: 'Adresse email invalide.' });
  }
  // Obligatoire désormais (plus seulement recommandé) : le canal SMS
  // (confirmation, rappel la veille — à venir) en a besoin en plus de
  // l'email. Revalidé ici même si site/reservation.html le valide déjà
  // côté client — jamais confiance dans une entrée non revérifiée côté
  // serveur.
  if(!/^(?:\+33[1-9]\d{8}|0[1-9]\d{8})$/.test(telephone.replace(/[\s.-]/g, ''))){
    return json(res, 400, { error: 'Numéro de téléphone invalide.' });
  }

  let reglages;
  try{
    reglages = await supabaseGet(
      `parametres_reservation?slug=eq.${slug}&activee=eq.true&select=owner_id,jours_ouvres,heure_debut,heure_fin,intervalle_minutes,delai_min_heures,horizon_jours`
    );
  }catch(e){
    return json(res, 503, { error: 'Page de réservation temporairement indisponible.' });
  }
  const reglage = reglages[0];
  if(!reglage){
    return json(res, 404, { error: 'Page de réservation introuvable.' });
  }
  const ownerId = reglage.owner_id;

  let prestations;
  try{
    prestations = await supabaseGet(
      `prestations?id=in.(${prestationIds.join(',')})&owner_id=eq.${ownerId}&actif=eq.true` +
      `&select=id,libelle,prix_unitaire,tva_taux,duree_minutes`
    );
  }catch(e){
    return json(res, 503, { error: 'Page de réservation temporairement indisponible.' });
  }
  if(prestations.length !== prestationIds.length){
    return json(res, 404, { error: 'Prestation introuvable.' });
  }
  // Remet les prestations dans l'ordre choisi par le client (Supabase ne
  // garantit pas l'ordre d'un `in.(...)`) — sert à l'ordre des lignes de la
  // facture générée et du libellé du rendez-vous.
  const prestationsParId = new Map(prestations.map(p => [p.id, p]));
  const prestationsOrdonnees = prestationIds.map(id => prestationsParId.get(id));
  const dureeMinutesTotale = prestationsOrdonnees.reduce((s, p) => s + (Number(p.duree_minutes) || 0), 0);
  const montantTTC = prestationsOrdonnees.reduce((s, p) => {
    const taux = Number(p.tva_taux) || 0;
    return s + Number(p.prix_unitaire) * (1 + taux / 100);
  }, 0);
  const libelleCombine = prestationsOrdonnees.map(p => p.libelle).join(' + ');
  // Représentant unique pour les colonnes historiques (rendez_vous.prestation_id,
  // affichage à un seul champ dans agenda.html) — toujours la première
  // prestation choisie, la liste complète vit dans rendez_vous_prestations.
  const prestationPrincipale = prestationsOrdonnees[0];

  // ---- défense en profondeur : re-vérifier les règles côté serveur ----
  // Délai minimum et horizon (la personne et ses horaires sont vérifiés plus bas).
  const maintenant = Date.now();
  if(dateDebut.getTime() < maintenant + (reglage.delai_min_heures || 0) * 3600000){
    return json(res, 409, { error: 'Ce créneau est trop proche, choisissez-en un plus tard.' });
  }
  if(dateDebut.getTime() > maintenant + (reglage.horizon_jours || 0) * 86400000){
    return json(res, 409, { error: 'Ce créneau est trop lointain.' });
  }

  const dateFin = new Date(dateDebut.getTime() + dureeMinutesTotale * 60000);

  // ---- qui assure ce rendez-vous, et est-il/elle libre ? (juste avant l'insert) ----
  // Même logique que la page des créneaux (api/_dispo.js) : une personne éligible
  // (qui assure TOUTES les prestations choisies), ouverte à cette heure, sans
  // chevauchement. « Premier disponible » prend la moins chargée du jour.
  let intervenantAffecte = null;
  try{
    const ctx = await contexte(ownerId, reglage, prestationIds);
    if(!ctx.solo && !ctx.eligibles.length){
      return json(res, 409, { error: 'Aucun membre de l\'équipe n\'assure toutes ces prestations ensemble. Retirez-en une ou réservez-les séparément.' });
    }
    if(!ctx.solo && intervenantDemande !== 'any' && !ctx.eligibles.some(i => i.id === intervenantDemande)){
      return json(res, 409, { error: 'Cette personne n\'assure pas toutes les prestations choisies.' });
    }
    const jourDebut = composantsParis(dateDebut);
    const debutJour = new Date(Date.UTC(jourDebut.annee, jourDebut.mois - 1, jourDebut.jour) - 12 * 3600000).toISOString();
    const finJour = new Date(Date.UTC(jourDebut.annee, jourDebut.mois - 1, jourDebut.jour + 1) + 36 * 3600000).toISOString();
    const busy = await chargerOccupes(ownerId, debutJour, finJour);
    const choix = choisirRessource(ctx, busy, dateDebut, intervenantDemande);
    if(!choix.ok){
      return json(res, 409, { error: 'Ce créneau n\'est plus disponible, choisissez-en un autre.' });
    }
    intervenantAffecte = choix.intervenantId;
  }catch(e){
    return json(res, 503, { error: 'Vérification impossible, réessayez.' });
  }
  const infosIntervenant = intervenantAffecte ? { intervenant_id: intervenantAffecte } : {};

  // ---- phase 3 : paiement anticipé, si le praticien l'a activé ----
  // Rétrocompatible : sans Stripe configuré, le parcours reste exactement
  // celui d'avant (demande en attente, confirmation manuelle) — voir plus
  // bas. Avec Stripe actif, la réservation devient payante et
  // s'auto-confirme au paiement — voir api/paiement-webhook-stripe.js.
  let paiementConfig;
  try{
    paiementConfig = (await supabaseGet(
      `parametres_paiement?owner_id=eq.${ownerId}&select=stripe_actif,stripe_secret_key,especes_actif,acompte_minimum,acompte_pourcentage`
    ))[0];
  }catch(e){
    try{
      paiementConfig = (await supabaseGet(`parametres_paiement?owner_id=eq.${ownerId}&select=stripe_actif,stripe_secret_key`))[0];
    }catch(e2){
      return json(res, 503, { error: 'Vérification impossible, réessayez.' });
    }
  }
  const stripeActif = !!(paiementConfig?.stripe_actif && paiementConfig?.stripe_secret_key);
  // Pas de réservation sans paiement en ligne : un acompte est toujours exigé.
  if(!stripeActif){
    return json(res, 409, { error: 'Ce salon n’a pas encore activé le paiement en ligne : la réservation n’est pas disponible. Contactez-le directement.' });
  }

  // ---- mode de paiement : CB (total) ou espèces (acompte + solde sur place) ----
  const especesAutorise = paiementConfig?.especes_actif !== false;
  const totalCentimes = Math.round(montantTTC * 100);
  // Règle Mirrio : toujours au moins 5 € d'acompte par carte (garantie contre les absences), quoi que dise le réglage.
  const acompteMin = Math.max(500, Math.round(Number(paiementConfig?.acompte_minimum ?? 5) * 100));
  const acomptePct = Number(paiementConfig?.acompte_pourcentage ?? 0);
  // Acompte = le plus grand de (minimum, pourcentage du total), jamais plus que le total.
  const acompteCentimes = Math.min(totalCentimes, Math.max(acompteMin, Math.round(totalCentimes * acomptePct / 100)));
  let mode = modeDemande;
  if(mode === 'sur_place' && !especesAutorise){
    return json(res, 400, { error: 'Le règlement sur place n\'est pas proposé par ce salon.' });
  }
  // Acompte égal au total : autant régler en ligne, rien à payer sur place.
  if(mode === 'sur_place' && stripeActif && acompteCentimes >= totalCentimes) mode = 'en_ligne';
  // Montant débité maintenant par carte, et solde dû en espèces.
  const aPayerEnLigneCentimes = (mode === 'sur_place') ? acompteCentimes : totalCentimes;
  const resteSurPlace = (totalCentimes - (stripeActif ? aPayerEnLigneCentimes : 0)) / 100;
  // Sans Stripe, tout se règle sur place ; avec Stripe, un paiement en ligne n'a lieu que si > 0.
  const paiementRequis = stripeActif && aPayerEnLigneCentimes > 0;
  const modeEnregistre = stripeActif ? mode : 'sur_place';
  // Colonnes schema-v19 : ajoutées seulement si présentes en base (voir insertSouple).
  const infosPaiement = { paiement_mode: modeEnregistre, total_ttc: montantTTC, reste_sur_place: resteSurPlace };

  if(paiementRequis){
    const montantCentimes = aPayerEnLigneCentimes;
    if(!(totalCentimes > 0)){
      return json(res, 400, { error: 'Le prix de cette prestation est invalide.' });
    }

    // Le hold occupe le créneau dès l'insert (même logique de chevauchement
    // que les demandes gratuites), mais expire tout seul dans 15 minutes —
    // voir la note sur `expire_le` dans api/reservation-disponibilites.js.
    // `paiement_montant` posé dès la création (pas seulement au retour de
    // Stripe) : c'est ce total, toutes prestations comprises, que relit la
    // facture générée par le webhook et l'email de confirmation.
    let rdv;
    try{
      // `paiement_montant` = ce qui est réellement débité par carte (total, ou acompte en mode espèces).
      const rows = await insererRendezVous({
        owner_id: ownerId,
        titre: `${libelleCombine} — ${nom}`,
        prestation_id: prestationPrincipale.id,
        date_debut: dateDebut.toISOString(),
        date_fin: dateFin.toISOString(),
        statut: 'en_attente',
        client_id: null,
        prospect_nom: nom,
        prospect_email: email,
        prospect_telephone: telephone,
        paiement_statut: 'en_attente',
        paiement_provider: 'stripe',
        paiement_montant: montantCentimes / 100,
        expire_le: new Date(Date.now() + 15 * 60000).toISOString()
      }, { ...infosPaiement, ...infosIntervenant });
      rdv = rows[0];
    }catch(e){
      return json(res, 502, { error: 'La réservation a échoué. Réessayez.' });
    }

    try{
      await supabasePost('rendez_vous_prestations', prestationsOrdonnees.map((p, i) => ({
        rendez_vous_id: rdv.id, prestation_id: p.id, position: i
      })));
    }catch(e){
      // Pas bloquant côté créneau/paiement (déjà réservés ci-dessus), mais la
      // facture générée par le webhook retombera sur la seule prestation
      // principale plutôt que la liste complète — mieux qu'un échec total de
      // la réservation pour ça.
    }

    let nomPraticien = 'Mirrio';
    try{
      const profils = await supabaseGet(`profiles?id=eq.${ownerId}&select=business_name,full_name`);
      nomPraticien = profils[0]?.business_name || profils[0]?.full_name || 'Mirrio';
    }catch(e){ /* pas bloquant : "Mirrio" par défaut sur la page Stripe */ }

    const origine = `https://${req.headers.host}`;
    let session;
    try{
      session = await creerSessionStripe(paiementConfig.stripe_secret_key, {
        mode: 'payment',
        payment_method_types: ['card'],
        // Une ligne Stripe par prestation choisie — un reçu détaillé plutôt
        // qu'un unique montant global.
        line_items: modeEnregistre === 'sur_place'
          // Acompte : une seule ligne, le solde est réglé en espèces au salon.
          ? [{ quantity: 1, price_data: { currency: 'eur', unit_amount: montantCentimes,
              product_data: { name: `Acompte, ${libelleCombine} chez ${nomPraticien}`,
                description: `Acompte déduit du prix final, non remboursé en cas d'absence. Reste ${(resteSurPlace).toFixed(2).replace('.', ',')} € à régler en espèces au salon.` } } }]
          : prestationsOrdonnees.map(p => {
              const taux = Number(p.tva_taux) || 0;
              const montant = Number(p.prix_unitaire) * (1 + taux / 100);
              return {
                quantity: 1,
                price_data: {
                  currency: 'eur',
                  unit_amount: Math.round(montant * 100),
                  product_data: { name: `${p.libelle} chez ${nomPraticien}` }
                }
              };
            }),
        customer_email: email,
        success_url: `${origine}/paiement-merci.html?statut=succes`,
        cancel_url: `${origine}/paiement-merci.html?statut=annule`,
        metadata: { rendez_vous_id: rdv.id, owner_id: ownerId }
      });
    }catch(e){
      // La ligne « en_attente » reste en base : elle expirera d'elle-même
      // (expire_le) et sera nettoyée par api/paiement-nettoyer.js, exactement
      // comme un client qui abandonne le paiement Stripe en cours de route —
      // aucun rollback manuel nécessaire ici.
      return json(res, 502, { error: 'La création du paiement a échoué. Réessayez.' });
    }

    try{
      await supabasePatch(`rendez_vous?id=eq.${rdv.id}`, { paiement_reference: session.id });
    }catch(e){ /* pas bloquant : le webhook retrouve le rendez-vous par metadata.rendez_vous_id */ }

    return json(res, 200, { url: session.url });
  }

  // ---- sans paiement en ligne : le créneau est libre, on confirme tout de suite ----
  // (sauf si le praticien a désactivé « Confirmer automatiquement » : la demande reste alors à valider.)
  let rdvGratuit;
  try{
    const rows = await insererRendezVous({
      owner_id: ownerId,
      titre: `${libelleCombine} — ${nom}`,
      prestation_id: prestationPrincipale.id,
      date_debut: dateDebut.toISOString(),
      date_fin: dateFin.toISOString(),
      statut: 'en_attente',
      client_id: null,
      prospect_nom: nom,
      prospect_email: email,
      prospect_telephone: telephone
    }, { ...infosPaiement, ...infosIntervenant });
    rdvGratuit = rows[0];
  }catch(e){
    return json(res, 502, { error: 'La réservation a échoué. Réessayez.' });
  }

  try{
    await supabasePost('rendez_vous_prestations', prestationsOrdonnees.map((p, i) => ({
      rendez_vous_id: rdvGratuit.id, prestation_id: p.id, position: i
    })));
  }catch(e){ /* pas bloquant, voir la même note plus haut sur le chemin payant */ }

  // Confirmation automatique : on réutilise la fonction SQL atomique du chemin payant
  // (verrou + conflit par intervenant + création de la fiche client). Elle seule fait
  // foi : si un autre client a confirmé ce créneau entre-temps, on répond 409.
  let validationAuto = true;
  try{
    const v = await supabaseGet(`parametres_reservation?owner_id=eq.${ownerId}&select=validation_auto`);
    if(v[0] && v[0].validation_auto === false) validationAuto = false;
  }catch(e){ /* schema-v20 absent : confirmation automatique par défaut */ }
  let confirme = false;
  if(validationAuto){
    try{
      const r = await fetch(`${SUPABASE_URL}/rest/v1/rpc/confirmer_reservation_payee`, {
        method: 'POST',
        headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ p_rendez_vous_id: rdvGratuit.id, p_owner_id: ownerId })
      });
      const lignes = r.ok ? await r.json() : [];
      const retour = Array.isArray(lignes) ? lignes[0] : lignes;
      if(retour?.resultat === 'conflit'){
        return json(res, 409, { error: 'Ce créneau vient d’être pris, choisissez-en un autre.' });
      }
      confirme = retour?.resultat === 'confirme';
    }catch(e){ /* échec technique : la demande reste en attente, le praticien la validera */ }
  }

  // Nom de la personne qui assurera le rendez-vous (pour les emails et l'écran de confirmation).
  let nomIntervenant = null;
  if(intervenantAffecte){
    try{ nomIntervenant = (await supabaseGet(`vitrine_equipe?id=eq.${intervenantAffecte}&select=nom`))[0]?.nom || null; }catch(e){ /* facultatif */ }
  }

  // .ics du rendez-vous (calculé APRÈS confirmation : statut CONFIRMED, pas TENTATIVE).
  const ical = await icsParId(rdvGratuit.id, `https://${req.headers.host}`);

  // SMS de confirmation (si le salon l'a activé) : seulement une fois le rendez-vous réellement confirmé.
  if(confirme) await smsConfirmation({ rdvId: rdvGratuit.id, ownerId, telephone, origine: `https://${req.headers.host}` });

  // ---- emails best-effort : jamais bloquants ----
  if(RESEND_API_KEY){
    let profil = {}, facturation = {};
    try{
      const [profils, facs] = await Promise.all([
        supabaseGet(`profiles?id=eq.${ownerId}&select=business_name,full_name`),
        supabaseGet(`parametres_facturation?owner_id=eq.${ownerId}&select=emetteur_email`)
      ]);
      profil = profils[0] || {};
      facturation = facs[0] || {};
    }catch(e){ /* pas bloquant */ }
    const nomPraticien = profil.business_name || profil.full_name || 'Mirrio';
    const quand = formaterDateHeure(dateDebut);

    try{
      await envoyerEmail({
        to: email,
        attachments: pieceJointe(ical?.ics),
        subject: confirme ? `Votre rendez-vous est confirmé, ${nomPraticien}` : `Votre demande de rendez-vous, ${nomPraticien}`,
        html: gabaritSimple({
          titre: confirme ? 'Votre rendez-vous est confirmé' : 'Votre demande a bien été reçue',
          paragraphes: [
            `${confirme ? 'Votre rendez-vous' : 'Vous avez demandé un rendez-vous'} pour <strong>${echapperHtml(libelleCombine)}</strong> le ${echapperHtml(quand)}, auprès de ${echapperHtml(nomPraticien)}${nomIntervenant ? `, avec ${echapperHtml(nomIntervenant)}` : ''}${confirme ? ' est confirmé.' : '.'}`,
            confirme ? `Un fichier calendrier est joint pour l'ajouter à votre agenda.` : `Cette demande est <strong>en attente de confirmation</strong>, vous recevrez un message dès qu’elle sera validée.`,
            `Règlement <strong>sur place, en espèces</strong> : ${formaterEuros(montantTTC)}.`,
            ...(ical?.lien ? [`<a href="${echapperHtml(ical.lien)}">Ajouter à mon agenda</a> (fichier .ics également joint à cet email).`] : [])
          ]
        })
      });
    }catch(e){ /* best-effort : ne bloque jamais la réservation */ }

    if(facturation.emetteur_email){
      try{
        await envoyerEmail({
          to: facturation.emetteur_email,
          replyTo: email,
          attachments: pieceJointe(ical?.ics),
          subject: confirme ? `Nouveau rendez-vous confirmé, ${nom}` : `Nouvelle demande de rendez-vous, ${nom}`,
          html: gabaritSimple({
            titre: confirme ? 'Nouveau rendez-vous confirmé automatiquement' : 'Nouvelle demande de réservation',
            paragraphes: [
              `<strong>${echapperHtml(nom)}</strong> ${confirme ? 'a réservé' : 'a demandé'} ${echapperHtml(libelleCombine)} (${formaterEuros(montantTTC)}) le ${echapperHtml(quand)}${nomIntervenant ? `, avec ${echapperHtml(nomIntervenant)}` : ''}.`,
              `Règlement prévu sur place, en espèces : ${formaterEuros(montantTTC)}.`,
              `Contact : ${echapperHtml(email)}${telephone ? ` — ${echapperHtml(telephone)}` : ''}.`,
              confirme ? `Il est déjà dans votre agenda : aucune action n'est requise.` : `Ouvrez votre agenda Mirrio pour la confirmer ou la refuser.`
            ]
          })
        });
      }catch(e){ /* best-effort */ }
    }
  }

  return json(res, 200, { ok: true, confirme, intervenant: nomIntervenant, ics_url: ical?.lien || null });
}
