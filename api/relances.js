// Mirrio — relances automatiques par email des factures en retard de paiement.
//
//   GET /api/relances     (appelé quotidiennement par Vercel Cron, voir vercel.json)
//
// Zéro dépendance npm, comme api/agenda.js : le projet n'a pas d'étape de build,
// on s'en tient au `fetch` du runtime. Les totaux sont recalculés ici plutôt
// qu'importés de site/document-render.js — dupliquer une fonction pure de 15
// lignes coûte moins cher que de faire dépendre une fonction serverless d'un
// module pensé pour le navigateur.
//
// Variables d'environnement attendues sur Vercel :
//   SUPABASE_URL                 — https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    — clé service_role (secrète, jamais côté client)
//   CRON_SECRET                  — jeton que Vercel Cron envoie en Authorization: Bearer
//   RESEND_API_KEY               — clé API Resend ; en son absence, la tâche se
//                                   contente de ne rien envoyer (pas une erreur —
//                                   voir la note plus bas)
//   RESEND_FROM                  — ex. "Mirrio <relances@votre-domaine.fr>" ;
//                                   à défaut, un envoi de test Resend

import rappels from './_rappels.js';

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const CRON_SECRET = process.env.CRON_SECRET;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Mirrio <onboarding@resend.dev>';

// Au-delà, on arrête de relancer : ça devient un désaccord commercial à traiter
// à la main, pas quelque chose qu'un cron doit continuer de marteler.
const MAX_RELANCES = 3;

const INK = '#1C2333', PARCH = '#F5F1E7', PARCHDIM = '#EAE4D4', AMBER = '#E2A63D', BRICK = '#B5533F';
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
      'Content-Type': 'application/json', Prefer: 'return=minimal'
    },
    body: JSON.stringify(corps)
  });
  if(!r.ok) throw new Error(`Supabase PATCH ${r.status} sur ${chemin}`);
}

// Même calcul que calculerTotaux() dans site/document-render.js — voir le
// commentaire d'en-tête sur pourquoi ce n'est pas un import partagé.
function totalTTC(lignes, assujettiTva){
  let totalHT = 0, totalTVA = 0;
  (lignes || []).forEach(l => {
    const ht = (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0);
    totalHT += ht;
    if(assujettiTva){
      const taux = Number(l.tva_taux) || 0;
      totalTVA += ht * taux / 100;
    }
  });
  return totalHT + totalTVA;
}

function formaterEuros(n){
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
}
function formaterDate(iso){
  if(!iso) return '';
  return new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' }).format(new Date(iso + 'T12:00:00'));
}
function echapperHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

function gabaritEmail({ nomClient, nomEmetteur, numero, montant, echeance, joursRetard }){
  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0">
<meta name="color-scheme" content="light"><title>Rappel de facture</title></head>
<body style="margin:0; padding:0; background:${PARCHDIM}; font-family:${SANS};">
<div style="display:none; max-height:0; overflow:hidden;">Facture ${echapperHtml(numero)} — ${formaterEuros(montant)} en attente de règlement.</div>
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:${PARCHDIM};">
<tr><td align="center" style="padding:32px 16px;">
<table role="presentation" width="600" cellpadding="0" cellspacing="0" style="max-width:600px; width:100%; background:${PARCH}; border-radius:10px; overflow:hidden;">
<tr><td style="background:${INK}; padding:22px 32px; font-family:${SERIF}; font-weight:700; font-size:19px; color:${PARCH};">${echapperHtml(nomEmetteur)}</td></tr>
<tr><td style="padding:36px 32px 8px;">
<h1 style="margin:0 0 18px; font-family:${SERIF}; font-size:22px; color:${INK};">Un petit rappel</h1>
<p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:${INK};">Bonjour${nomClient ? ' ' + echapperHtml(nomClient) : ''},</p>
<p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:${INK};">Nous n'avons pas encore reçu le règlement de la facture <strong>${echapperHtml(numero)}</strong>, échue le ${formaterDate(echeance)}${joursRetard > 0 ? ` (il y a ${joursRetard} jour${joursRetard > 1 ? 's' : ''})` : ''}.</p>
<table role="presentation" cellpadding="0" cellspacing="0" style="margin:22px 0; width:100%; background:#fff; border:1px solid rgba(28,35,51,0.12); border-radius:8px;">
<tr><td style="padding:16px 20px;">
<div style="font-size:11px; text-transform:uppercase; letter-spacing:.05em; color:rgba(28,35,51,0.5); margin-bottom:4px;">Montant dû</div>
<div style="font-family:${SERIF}; font-size:26px; font-weight:700; color:${BRICK};">${formaterEuros(montant)}</div>
</td></tr>
</table>
<p style="margin:0 0 16px; font-size:15px; line-height:1.6; color:${INK};">Si le règlement est déjà parti de votre côté, ce message aura simplement croisé son passage — inutile d'y répondre. Sinon, vous pouvez répondre directement à cet email pour toute question.</p>
<p style="margin:24px 0 0; font-size:15px; line-height:1.6; color:${INK};">Merci,<br>${echapperHtml(nomEmetteur)}</p>
</td></tr>
<tr><td style="padding:22px 32px 30px; font-size:12px; color:rgba(28,35,51,0.42); line-height:1.6;">Envoyé automatiquement via <a href="https://cadence-site-cadence-65cc.vercel.app" style="color:rgba(28,35,51,0.42);">Mirrio</a> pour le compte de ${echapperHtml(nomEmetteur)}.</td></tr>
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
  if(req.method !== 'GET' && req.method !== 'POST'){
    return json(res, 405, { error: 'Method Not Allowed' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return json(res, 500, { error: 'Configuration serveur incomplète (Supabase).' });
  }

  // Vercel Cron signe ses appels avec ce jeton dès que CRON_SECRET est défini
  // dans les variables d'environnement du projet. Sans CRON_SECRET configuré,
  // on n'exige rien — pratique en local, mais CRON_SECRET doit être posé en
  // production pour empêcher n'importe qui de déclencher l'envoi à volonté.
  if(CRON_SECRET && req.headers.authorization !== `Bearer ${CRON_SECRET}`){
    return json(res, 401, { error: 'Non autorisé.' });
  }

  // Même tâche planifiée, autre travail : rappels de rendez-vous de demain (voir api/_rappels.js).
  // Regroupé ici pour ne pas dépasser la limite de 12 fonctions Vercel.
  if(new URL(req.url, 'http://x').searchParams.get('tache') === 'rappels') return rappels(req, res);

  // Les relances sont un avantage Studio (voir la page tarifs) et une
  // fonctionnalité que l'utilisateur active lui-même (parametres_facturation.
  // relances_activees) — les deux sont vérifiés plus bas, par facture, jamais
  // supposés ici.

  // Sans clé Resend, la tâche n'est pas en échec : elle n'a simplement rien à
  // envoyer. C'est ce qui permet au reste du produit (le réglage, le compteur
  // de relances, le cron lui-même) d'exister et d'être testé avant que
  // l'utilisateur n'ait branché son propre expéditeur.
  if(!RESEND_API_KEY){
    return json(res, 200, { envoyees: 0, ignore: "RESEND_API_KEY absent — aucun envoi." });
  }

  const aujourdhui = new Date().toISOString().slice(0, 10);

  let factures;
  try{
    factures = await supabaseGet(
      `documents?type=eq.facture&statut=in.(envoye,en_retard)&date_echeance=lt.${aujourdhui}` +
      `&nombre_relances=lt.${MAX_RELANCES}` +
      `&select=id,numero,owner_id,client_id,date_echeance,derniere_relance_at,nombre_relances,document_lignes(quantite,prix_unitaire,tva_taux)` +
      `&order=date_echeance.asc&limit=500`
    );
  }catch(e){
    return json(res, 502, { error: 'Lecture des factures impossible.', detail: String(e.message || e) });
  }

  if(!factures.length){
    return json(res, 200, { envoyees: 0, candidates: 0 });
  }

  const ownerIds = [...new Set(factures.map(f => f.owner_id))];
  const clientIds = [...new Set(factures.map(f => f.client_id).filter(Boolean))];

  let reglages = [], clients = [];
  try{
    [reglages, clients] = await Promise.all([
      supabaseGet(`parametres_facturation?owner_id=in.(${ownerIds.join(',')})&select=owner_id,relances_activees,relance_delai_jours,assujetti_tva,emetteur_nom,emetteur_email`),
      clientIds.length
        ? supabaseGet(`clients?id=in.(${clientIds.join(',')})&select=id,full_name,email`)
        : Promise.resolve([])
    ]);
  }catch(e){
    return json(res, 502, { error: 'Lecture des réglages impossible.', detail: String(e.message || e) });
  }

  const reglagesParProprio = Object.fromEntries(reglages.map(r => [r.owner_id, r]));
  const clientsParId = Object.fromEntries(clients.map(c => [c.id, c]));

  let envoyees = 0, ignorees = 0, echecs = 0;

  for(const f of factures){
    const params = reglagesParProprio[f.owner_id];
    const client = f.client_id ? clientsParId[f.client_id] : null;

    if(!params || !params.relances_activees || !params.emetteur_email || !client || !client.email){
      ignorees++;
      continue;
    }

    const delaiJours = params.relance_delai_jours || 7;
    if(f.derniere_relance_at){
      const prochaine = new Date(f.derniere_relance_at);
      prochaine.setDate(prochaine.getDate() + delaiJours);
      if(prochaine > new Date()){ ignorees++; continue; }
    }

    const montant = totalTTC(f.document_lignes, params.assujetti_tva);
    const joursRetard = Math.max(0, Math.round((new Date() - new Date(f.date_echeance + 'T00:00:00')) / 86400000));
    const nomEmetteur = params.emetteur_nom || 'Mirrio';

    try{
      await envoyerEmail({
        to: client.email,
        replyTo: params.emetteur_email,
        subject: `Rappel — facture ${f.numero || ''} en attente de règlement`,
        html: gabaritEmail({
          nomClient: client.full_name, nomEmetteur, numero: f.numero,
          montant, echeance: f.date_echeance, joursRetard
        })
      });

      await supabasePatch(`documents?id=eq.${f.id}`, {
        derniere_relance_at: new Date().toISOString(),
        nombre_relances: (f.nombre_relances || 0) + 1
      });
      envoyees++;
    }catch(e){
      // Une facture qui échoue à l'envoi ne doit pas bloquer les suivantes —
      // le prochain passage du cron la retentera naturellement.
      echecs++;
    }
  }

  return json(res, 200, { candidates: factures.length, envoyees, ignorees, echecs });
}
