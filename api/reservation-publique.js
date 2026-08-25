// Cadence — création d'un rendez-vous « en attente » depuis le widget public
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

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Cadence <onboarding@resend.dev>';

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

function gabaritSimple({ titre, paragraphes, accent }){
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
  const telephone = body?.telephone ? String(body.telephone).trim() : null;

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

  let reglages;
  try{
    reglages = await supabaseGet(
      `parametres_reservation?slug=eq.${slug}&activee=eq.true&select=owner_id,jours_ouvres,heure_debut,heure_fin,delai_min_heures,horizon_jours`
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
  const c = composantsParis(dateDebut);
  const jourSemaine = new Date(Date.UTC(c.annee, c.mois - 1, c.jour)).getUTCDay();
  if(!(reglage.jours_ouvres || []).includes(jourSemaine)){
    return json(res, 409, { error: 'Ce jour n’est pas ouvert à la réservation.' });
  }
  const [hDebutH, hDebutM] = String(reglage.heure_debut).split(':').map(Number);
  const [hFinH, hFinM] = String(reglage.heure_fin).split(':').map(Number);
  const minuteDuJour = c.heure * 60 + c.minute;
  if(minuteDuJour < hDebutH * 60 + hDebutM || minuteDuJour + dureeMinutesTotale > hFinH * 60 + hFinM){
    return json(res, 409, { error: 'Ce créneau est hors des horaires de réservation.' });
  }
  const maintenant = Date.now();
  if(dateDebut.getTime() < maintenant + (reglage.delai_min_heures || 0) * 3600000){
    return json(res, 409, { error: 'Ce créneau est trop proche — choisissez-en un plus tard.' });
  }
  if(dateDebut.getTime() > maintenant + (reglage.horizon_jours || 0) * 86400000){
    return json(res, 409, { error: 'Ce créneau est trop lointain.' });
  }

  const dateFin = new Date(dateDebut.getTime() + dureeMinutesTotale * 60000);

  // ---- re-vérification anti-course juste avant l'insert ----
  let occupes;
  try{
    occupes = await supabaseGet(
      `rendez_vous?owner_id=eq.${ownerId}` +
      `&date_debut=lt.${dateFin.toISOString()}&date_fin=gt.${dateDebut.toISOString()}` +
      `&select=statut,paiement_statut,expire_le`
    );
  }catch(e){
    return json(res, 503, { error: 'Vérification impossible, réessayez.' });
  }
  const maintenantMs = Date.now();
  // Un hold de paiement expiré (phase 3, voir schema-v8-paiements.sql) ne
  // bloque plus le créneau — même règle que api/reservation-disponibilites.js.
  const occupe = occupes.some(r => r.statut !== 'annule'
    && !(r.paiement_statut === 'en_attente' && r.expire_le && new Date(r.expire_le).getTime() < maintenantMs));
  if(occupe){
    return json(res, 409, { error: 'Ce créneau vient d’être pris, choisissez-en un autre.' });
  }

  // ---- phase 3 : paiement anticipé, si le praticien l'a activé ----
  // Rétrocompatible : sans Stripe configuré, le parcours reste exactement
  // celui d'avant (demande en attente, confirmation manuelle) — voir plus
  // bas. Avec Stripe actif, la réservation devient payante et
  // s'auto-confirme au paiement — voir api/paiement-webhook-stripe.js.
  let paiementConfig;
  try{
    paiementConfig = (await supabaseGet(
      `parametres_paiement?owner_id=eq.${ownerId}&select=stripe_actif,stripe_secret_key`
    ))[0];
  }catch(e){
    return json(res, 503, { error: 'Vérification impossible, réessayez.' });
  }
  const paiementRequis = !!(paiementConfig?.stripe_actif && paiementConfig?.stripe_secret_key);

  if(paiementRequis){
    const montantCentimes = Math.round(montantTTC * 100);
    if(!(montantCentimes > 0)){
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
      const rows = await supabasePostRepresentation('rendez_vous', {
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
        paiement_montant: montantTTC,
        expire_le: new Date(Date.now() + 15 * 60000).toISOString()
      });
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

    let nomPraticien = 'Cadence';
    try{
      const profils = await supabaseGet(`profiles?id=eq.${ownerId}&select=business_name,full_name`);
      nomPraticien = profils[0]?.business_name || profils[0]?.full_name || 'Cadence';
    }catch(e){ /* pas bloquant : "Cadence" par défaut sur la page Stripe */ }

    const origine = `https://${req.headers.host}`;
    let session;
    try{
      session = await creerSessionStripe(paiementConfig.stripe_secret_key, {
        mode: 'payment',
        payment_method_types: ['card'],
        // Une ligne Stripe par prestation choisie — un reçu détaillé plutôt
        // qu'un unique montant global.
        line_items: prestationsOrdonnees.map(p => {
          const taux = Number(p.tva_taux) || 0;
          const montant = Number(p.prix_unitaire) * (1 + taux / 100);
          return {
            quantity: 1,
            price_data: {
              currency: 'eur',
              unit_amount: Math.round(montant * 100),
              product_data: { name: `${p.libelle} — ${nomPraticien}` }
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

  // ---- comportement existant : demande en attente, confirmation manuelle ----
  let rdvGratuit;
  try{
    const rows = await supabasePostRepresentation('rendez_vous', {
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
    });
    rdvGratuit = rows[0];
  }catch(e){
    return json(res, 502, { error: 'La réservation a échoué. Réessayez.' });
  }

  try{
    await supabasePost('rendez_vous_prestations', prestationsOrdonnees.map((p, i) => ({
      rendez_vous_id: rdvGratuit.id, prestation_id: p.id, position: i
    })));
  }catch(e){ /* pas bloquant, voir la même note plus haut sur le chemin payant */ }

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
    const nomPraticien = profil.business_name || profil.full_name || 'Cadence';
    const quand = formaterDateHeure(dateDebut);

    try{
      await envoyerEmail({
        to: email,
        subject: `Votre demande de rendez-vous — ${nomPraticien}`,
        html: gabaritSimple({
          titre: 'Votre demande a bien été reçue',
          paragraphes: [
            `Vous avez demandé un rendez-vous pour <strong>${echapperHtml(libelleCombine)}</strong> le ${echapperHtml(quand)}, auprès de ${echapperHtml(nomPraticien)}.`,
            `Cette demande est <strong>en attente de confirmation</strong> — vous recevrez un message dès qu’elle sera validée.`
          ]
        })
      });
    }catch(e){ /* best-effort : ne bloque jamais la réservation */ }

    if(facturation.emetteur_email){
      try{
        await envoyerEmail({
          to: facturation.emetteur_email,
          replyTo: email,
          subject: `Nouvelle demande de rendez-vous — ${nom}`,
          html: gabaritSimple({
            titre: 'Nouvelle demande de réservation',
            paragraphes: [
              `<strong>${echapperHtml(nom)}</strong> a demandé un rendez-vous pour ${echapperHtml(libelleCombine)} (${formaterEuros(montantTTC)}) le ${echapperHtml(quand)}.`,
              `Contact : ${echapperHtml(email)}${telephone ? ` — ${echapperHtml(telephone)}` : ''}.`,
              `Ouvrez votre agenda Cadence pour la confirmer ou la refuser.`
            ]
          })
        });
      }catch(e){ /* best-effort */ }
    }
  }

  return json(res, 200, { ok: true });
}
