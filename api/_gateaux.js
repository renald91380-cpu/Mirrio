// Mirrio — commande de gâteaux (pâtisseries, boulangeries), côté public.
//
//   GET  /api/gateaux?p=<slug>   → pâtisserie, catalogue, règles, dates complètes
//   POST /api/gateaux            → une demande de commande
//
// Module servi par api/reservation-disponibilites.js (?action=gateaux) pour rester
// sous la limite de 12 fonctions du plan Vercel Hobby (voir CLAUDE.md).
// Le `slug` est celui de la réservation en ligne (identifiant public, voir §3.10).
// Le serveur recalcule tout : prix estimé, délai minimum, jours fermés, capacité du
// jour. Une commande n'est qu'une DEMANDE (`statut = 'nouvelle'`) : c'est le pâtissier
// qui confirme et fixe le prix final. Aucun paiement en ligne dans cette version.
//
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY ; RESEND_API_KEY, RESEND_FROM (emails, facultatifs)

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Mirrio <onboarding@resend.dev>';

const OCCASIONS = {
  mariage: 'Mariage', anniversaire: 'Anniversaire', retraite: 'Départ en retraite', communion: 'Communion',
  bapteme: 'Baptême', naissance: 'Naissance', fiancailles: 'Fiançailles', entreprise: 'Événement d’entreprise', autre: 'Autre occasion'
};

function json(res, statut, corps){
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

const entetes = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` };
async function get(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { headers: { ...entetes, Accept: 'application/json' } });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
async function inserer(table, ligne){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}`, {
    method: 'POST', headers: { ...entetes, 'Content-Type': 'application/json', Prefer: 'return=representation' }, body: JSON.stringify(ligne)
  });
  if(!r.ok) throw new Error(`Supabase ${r.status} ${(await r.text()).slice(0, 200)}`);
  return (await r.json())[0];
}

const echapper = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
const euros = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n);
const propre = (v, max) => String(v == null ? '' : v).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim().slice(0, max);

// Date du jour à Paris (AAAA-MM-JJ), sans librairie.
function aujourdhuiParis(){
  return new Intl.DateTimeFormat('en-CA', { timeZone: 'Europe/Paris', year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
}
function ajouterJours(iso, n){
  const d = new Date(iso + 'T12:00:00Z'); d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}
const jourSemaine = iso => new Date(iso + 'T12:00:00Z').getUTCDay();
const dateLongue = iso => new Intl.DateTimeFormat('fr-FR', { timeZone: 'UTC', weekday: 'long', day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso + 'T12:00:00Z'));

async function pâtisserie(slug){
  const [reglage] = await get(`parametres_reservation?slug=eq.${slug}&select=owner_id`);
  if(!reglage) return null;
  const id = reglage.owner_id;
  const [[cfg], [profil], [fact]] = await Promise.all([
    get(`parametres_gateaux?owner_id=eq.${id}&select=*`),
    get(`profiles?id=eq.${id}&select=business_name,full_name,logo_url,metier`),
    get(`parametres_facturation?owner_id=eq.${id}&select=emetteur_ville,emetteur_email`).catch(() => [{}])
  ]);
  if(!cfg || !cfg.activee) return null;
  return { id, cfg, profil: profil || {}, fact: fact || {} };
}

// Dates où la capacité du jour est atteinte (commandes non annulées).
async function datesCompletes(id, cfg, debut, fin){
  const lignes = await get(`gateaux_commandes?owner_id=eq.${id}&statut=neq.annulee&date_retrait=gte.${debut}&date_retrait=lte.${fin}&select=date_retrait`);
  const n = {}; lignes.forEach(l => { n[l.date_retrait] = (n[l.date_retrait] || 0) + 1; });
  return { n, completes: Object.keys(n).filter(d => n[d] >= cfg.commandes_max_par_jour) };
}

async function envoyer({ to, replyTo, subject, html }){
  if(!RESEND_API_KEY) return;
  await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], reply_to: replyTo || undefined, subject, html })
  });
}

const gabarit = (titre, lignes) => `<!doctype html><html lang="fr"><head><meta charset="utf-8"><meta name="color-scheme" content="light"></head>
<body style="margin:0;background:#EEEDEA;font-family:Arial,Helvetica,sans-serif;color:#101216;"><table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr><td align="center" style="padding:28px 14px;">
<table role="presentation" width="560" cellpadding="0" cellspacing="0" style="max-width:560px;width:100%;background:#F5F5F3;border-radius:14px;overflow:hidden;">
<tr><td style="background:#101216;color:#F5F5F3;padding:18px 26px;font-size:15px;letter-spacing:.18em;text-transform:uppercase;">Mirrio<span style="color:#E2A63D">.</span></td></tr>
<tr><td style="padding:26px;"><h1 style="margin:0 0 14px;font-size:22px;">${echapper(titre)}</h1>${lignes.map(l => `<p style="margin:0 0 12px;font-size:15px;line-height:1.55;">${l}</p>`).join('')}</td></tr>
</table></td></tr></table></body></html>`;

export default async function handler(req, res){
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Serveur non configuré.' });
  try{
    if(req.method === 'GET'){
      const slug = (new URL(req.url, 'http://x').searchParams.get('p') || '').toLowerCase();
      if(!/^[a-z0-9-]{3,40}$/.test(slug)) return json(res, 404, { error: 'Page introuvable.' });
      const p = await pâtisserie(slug);
      if(!p) return json(res, 404, { error: 'Les commandes en ligne ne sont pas ouvertes ici.' });
      const aujourdhui = aujourdhuiParis();
      const fin = ajouterJours(aujourdhui, p.cfg.horizon_jours);
      const [produits, { completes }] = await Promise.all([
        get(`gateaux_produits?owner_id=eq.${p.id}&actif=eq.true&select=id,nom,description,categorie,photo_url,prix_part,parts_min,parts_max&order=position`),
        datesCompletes(p.id, p.cfg, aujourdhui, fin)
      ]);
      if(!produits.length) return json(res, 404, { error: 'Les commandes en ligne ne sont pas ouvertes ici.' });
      const c = p.cfg;
      return json(res, 200, {
        slug, nom: p.profil.business_name || p.profil.full_name || 'Pâtisserie', logo_url: p.profil.logo_url || null,
        ville: p.fact.emetteur_ville || null,
        occasions: OCCASIONS, produits,
        regles: {
          date_min: ajouterJours(aujourdhui, c.delai_min_jours), date_max: fin, delai_min_jours: c.delai_min_jours,
          jours_fermes: c.jours_fermes, dates_completes: completes,
          heure_debut: String(c.heure_retrait_debut).slice(0, 5), heure_fin: String(c.heure_retrait_fin).slice(0, 5),
          acompte_pourcentage: c.acompte_pourcentage, adresse: c.adresse_retrait, message: c.message_accueil
        }
      });
    }

    if(req.method !== 'POST') return json(res, 405, { error: 'Méthode non autorisée.' });
    let b = req.body;
    if(typeof b === 'string'){ try{ b = JSON.parse(b); }catch(e){ b = null; } }
    if(!b || typeof b !== 'object') return json(res, 400, { error: 'Requête invalide.' });
    if(b.site) return json(res, 200, { ok: true });                       // piège à robots : champ caché rempli

    const slug = String(b.p || '').toLowerCase();
    if(!/^[a-z0-9-]{3,40}$/.test(slug)) return json(res, 404, { error: 'Page introuvable.' });
    const p = await pâtisserie(slug);
    if(!p) return json(res, 404, { error: 'Les commandes en ligne ne sont pas ouvertes ici.' });
    const c = p.cfg;

    const [produit] = /^[0-9a-f-]{36}$/i.test(b.produit_id || '')
      ? await get(`gateaux_produits?id=eq.${b.produit_id}&owner_id=eq.${p.id}&actif=eq.true&select=*`) : [];
    if(!produit) return json(res, 400, { error: 'Choisissez un gâteau du catalogue.' });
    if(!OCCASIONS[b.occasion]) return json(res, 400, { error: 'Choisissez une occasion.' });

    const parts = Math.floor(Number(b.parts));
    if(!(parts >= produit.parts_min && parts <= produit.parts_max))
      return json(res, 400, { error: `Ce gâteau se commande de ${produit.parts_min} à ${produit.parts_max} parts.` });

    const date = String(b.date_retrait || '');
    if(!/^\d{4}-\d{2}-\d{2}$/.test(date)) return json(res, 400, { error: 'Choisissez une date de retrait.' });
    const aujourdhui = aujourdhuiParis();
    if(date < ajouterJours(aujourdhui, c.delai_min_jours)) return json(res, 400, { error: `Les commandes se prennent au moins ${c.delai_min_jours} jour(s) à l’avance.` });
    if(date > ajouterJours(aujourdhui, c.horizon_jours)) return json(res, 400, { error: 'Cette date est trop lointaine.' });
    if((c.jours_fermes || []).includes(jourSemaine(date))) return json(res, 400, { error: 'La pâtisserie est fermée ce jour-là.' });
    const { n } = await datesCompletes(p.id, c, date, date);
    if((n[date] || 0) >= c.commandes_max_par_jour) return json(res, 409, { error: 'Ce jour est complet, choisissez une autre date.' });

    let heure = String(b.heure_retrait || '');
    if(heure && !/^\d{2}:\d{2}$/.test(heure)) heure = '';
    if(heure && (heure < String(c.heure_retrait_debut).slice(0, 5) || heure > String(c.heure_retrait_fin).slice(0, 5))) heure = '';

    const nom = propre(b.nom, 80), email = propre(b.email, 120).toLowerCase();
    if(nom.length < 2) return json(res, 400, { error: 'Indiquez votre nom.' });
    if(!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) return json(res, 400, { error: 'Indiquez une adresse email valide.' });

    const prixEstime = Math.round(parts * Number(produit.prix_part) * 100) / 100;
    const commande = await inserer('gateaux_commandes', {
      owner_id: p.id, produit_id: produit.id, produit_nom: produit.nom, occasion: b.occasion, parts,
      personnalisation: propre(b.personnalisation, 600) || null, message_gateau: propre(b.message_gateau, 80) || null,
      allergies: propre(b.allergies, 300) || null, date_retrait: date, heure_retrait: heure || null,
      client_nom: nom, client_email: email, client_telephone: propre(b.telephone, 30) || null,
      prix_estime: prixEstime, acompte_pourcentage: c.acompte_pourcentage
    });

    const nomBoutique = p.profil.business_name || p.profil.full_name || 'la pâtisserie';
    const quand = dateLongue(date) + (heure ? ` à ${heure.replace(':', 'h')}` : '');
    try{
      await envoyer({
        to: email, replyTo: p.fact.emetteur_email, subject: `Votre demande de gâteau, ${nomBoutique} (réf. ${commande.reference})`,
        html: gabarit('Votre demande est bien reçue', [
          `${echapper(nomBoutique)} a reçu votre demande pour <strong>${echapper(produit.nom)}</strong> (${parts} parts, ${echapper(OCCASIONS[b.occasion].toLowerCase())}).`,
          `Retrait souhaité : <strong>${echapper(quand)}</strong>${c.adresse_retrait ? `, ${echapper(c.adresse_retrait)}` : ''}.`,
          `Prix estimé : <strong>${euros(prixEstime)}</strong>. Ce n’est pas encore une commande ferme : la pâtisserie vous confirme la faisabilité et le prix final${c.acompte_pourcentage ? `, avec un acompte de ${c.acompte_pourcentage} %` : ''}.`,
          `Référence : <strong>${echapper(commande.reference)}</strong>. Vous pouvez répondre à cet email pour toute précision.`
        ])
      });
      if(p.fact.emetteur_email) await envoyer({
        to: p.fact.emetteur_email, replyTo: email, subject: `Nouvelle demande de gâteau : ${produit.nom}, ${quand}`,
        html: gabarit('Nouvelle demande de gâteau', [
          `<strong>${echapper(nom)}</strong> (${echapper(email)}${b.telephone ? `, ${echapper(propre(b.telephone, 30))}` : ''}) demande <strong>${echapper(produit.nom)}</strong>, ${parts} parts, ${echapper(OCCASIONS[b.occasion].toLowerCase())}.`,
          `Retrait : <strong>${echapper(quand)}</strong>. Estimation : ${euros(prixEstime)}.`,
          ...(commande.message_gateau ? [`Message sur le gâteau : « ${echapper(commande.message_gateau)} »`] : []),
          ...(commande.allergies ? [`<strong>Allergies :</strong> ${echapper(commande.allergies)}`] : []),
          ...(commande.personnalisation ? [`Précisions : ${echapper(commande.personnalisation)}`] : []),
          `Confirmez ou ajustez le prix dans l’onglet « Commandes » de Mirrio.`
        ])
      });
    }catch(e){ /* best-effort : la commande est enregistrée quoi qu'il arrive */ }

    return json(res, 200, { ok: true, reference: commande.reference, prix_estime: prixEstime, quand });
  }catch(e){
    return json(res, 500, { error: 'Erreur serveur.' });
  }
}
