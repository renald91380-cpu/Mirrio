// Mirrio - rappels de rendez-vous par email et par SMS (module `_`, pas une route Vercel).
//
// Appelé par api/relances.js quand la tâche planifiée est `?tache=rappels` (voir vercel.json,
// une fois par jour). Prévient chaque client de ses rendez-vous de DEMAIN (jour calendaire de Paris),
// qu'ils aient été pris en ligne ou saisis à la main, à condition que la fiche porte un email ou un mobile.
// Le message dit toujours où en est le règlement : rien à prévoir, reste X € sur place, ou total à régler.
//
//   - Email : activé par défaut (`parametres_reservation.rappel_email`), via Resend.
//   - SMS   : désactivé par défaut (`rappel_sms`), chaque SMS coûte de l'argent. Fournisseur : Twilio
//             (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM ; expéditeur « Mirrio » par défaut).
//   - Jamais deux fois : `rappel_email_le` / `rappel_sms_le` sont posés après chaque envoi réussi.
//   - Exclus : rendez-vous annulés, demandes en attente, paiements en cours.
//   - `?dry=1` : liste ce qui serait envoyé sans rien envoyer ni marquer.
//
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, RESEND_API_KEY, RESEND_FROM, TWILIO_*.

import { parisVersUtc, composantsParis } from './_dispo.js';
import { lienEspace } from './_client.js';
import { normaliserTelephone, heureFr, etatReglement, phraseReglement, texteRappel, marquerRendezVous as marquer, envoyerSms, smsConfigure } from './_sms.js';
export { normaliserTelephone };

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const RESEND_API_KEY = process.env.RESEND_API_KEY;
const RESEND_FROM = process.env.RESEND_FROM || 'Mirrio <onboarding@resend.dev>';
const MAX_SMS_PAR_SALON = 100;       // garde-fou de coût par exécution

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const enc = encodeURIComponent;

// ------------------------------------------------------------------ fonctions pures (testées hors ligne)
// [début, fin[ du lendemain (jour calendaire Europe/Paris) en UTC.
export function fenetreDemain(maintenant = new Date()){
  const c = composantsParis(maintenant);
  const demain = new Date(Date.UTC(c.annee, c.mois - 1, c.jour + 1)), apres = new Date(Date.UTC(c.annee, c.mois - 1, c.jour + 2));
  const bord = d => parisVersUtc(d.getUTCFullYear(), d.getUTCMonth() + 1, d.getUTCDate(), 0, 0);
  return { debut: bord(demain), fin: bord(apres) };
}

const jourFr = iso => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'long', day: 'numeric', month: 'long' }).format(new Date(iso));

// ------------------------------------------------------------------------------- accès base
const entetes = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' };
async function get(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { headers: entetes });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
async function envoyerEmail({ to, replyTo, sujet, html }){
  const r = await fetch('https://api.resend.com/emails', {
    method: 'POST', headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ from: RESEND_FROM, to: [to], reply_to: replyTo || undefined, subject: sujet, html })
  });
  if(!r.ok) throw new Error('Resend ' + r.status);
}
function htmlEmail({ salon, debut, fin, titre, avec, adresse, reglement, lien, ics }){
  const bouton = (href, txt, fort) => `<a href="${esc(href)}" style="display:inline-block;margin:4px 6px 4px 0;padding:13px 22px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;${fort ? 'background:#E2A63D;color:#101216;' : 'background:#F5F5F3;color:#101216;border:1px solid #D9D9D4;'}">${txt}</a>`;
  return `<div style="background:#F5F5F3;padding:28px 12px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Arial,sans-serif;color:#101216">
  <div style="max-width:520px;margin:auto;background:#fff;border-radius:22px;padding:30px 28px">
    <div style="font-weight:800;font-size:20px;letter-spacing:-.04em;margin-bottom:18px">Mirrio<span style="color:#E2A63D">.</span></div>
    <h1 style="font-size:24px;line-height:1.2;margin:0 0 6px">À demain chez ${esc(salon)}</h1>
    <p style="margin:0 0 20px;color:#5B606B">Un petit rappel de votre rendez-vous.</p>
    <div style="border:1px solid #E6E6E1;border-radius:16px;padding:18px 20px;margin-bottom:18px">
      <div style="font-size:18px;font-weight:800;text-transform:capitalize">${esc(jourFr(debut))}</div>
      <div style="font-size:17px;margin:2px 0 10px">${esc(heureFr(debut))} - ${esc(heureFr(fin))}</div>
      ${titre ? `<div>${esc(titre)}</div>` : ''}${avec ? `<div style="color:#5B606B">Avec ${esc(avec)}</div>` : ''}${adresse ? `<div style="color:#5B606B">${esc(adresse)}</div>` : ''}
    </div>
    ${reglement ? `<p style="background:${reglement.type === 'paye' ? '#E3F2EA' : '#FBEFD2'};border-radius:12px;padding:12px 14px;margin:0 0 18px;font-size:14.5px">${reglement.type === 'reste' ? `Reste à régler sur place : <b>${esc(reglement.montant)} €</b> (acompte déjà déduit).` : reglement.type === 'paye' ? 'Tout est réglé : <b>rien à prévoir sur place</b>.' : `À régler sur place : <b>${esc(reglement.total)} €</b>.`}</p>` : ''}
    <div>${bouton(lien, 'Voir ou annuler mon rendez-vous', true)}${ics ? bouton(ics, 'Ajouter à mon agenda', false) : ''}</div>
    <p style="font-size:12.5px;color:#8A8F9A;margin:22px 0 0">Un empêchement ? Vous pouvez annuler jusqu'à 24 h avant. Un acompte déjà réglé n'est pas remboursé.</p>
  </div></div>`;
}

// ------------------------------------------------------------------------------------ tâche
export default async function rappels(req, res){
  const json = (statut, corps) => { res.statusCode = statut; res.setHeader('Content-Type', 'application/json; charset=utf-8'); res.end(JSON.stringify(corps)); };
  const url = new URL(req.url, `https://${req.headers.host}`);
  const dry = url.searchParams.get('dry') === '1';
  const origine = `https://${req.headers.host}`;
  const { debut, fin } = fenetreDemain();

  try{
    const champs = 'id,owner_id,client_id,titre,date_debut,date_fin,statut,paiement_statut,intervenant_id,prospect_nom,prospect_email,prospect_telephone,rappel_email_le,rappel_sms_le,reste_sur_place,paiement_mode,reste_encaisse_le,total_ttc,avis_token';
    const rdvs = (await get(`rendez_vous?date_debut=gte.${enc(debut.toISOString())}&date_debut=lt.${enc(fin.toISOString())}&select=${champs}`))
      .filter(r => r.statut !== 'annule' && r.statut !== 'en_attente' && r.paiement_statut !== 'en_attente');
    if(!rdvs.length) return json(200, { ok: true, rendez_vous: 0, emails: 0, sms: 0 });

    const owners = [...new Set(rdvs.map(r => r.owner_id))], clientIds = [...new Set(rdvs.map(r => r.client_id).filter(Boolean))], intervs = [...new Set(rdvs.map(r => r.intervenant_id).filter(Boolean))];
    const [reglages, profils, clients, equipe, facts] = await Promise.all([
      get(`parametres_reservation?owner_id=in.(${owners.join(',')})&select=owner_id,rappel_email,rappel_sms,adresse_annuaire`),
      get(`profiles?id=in.(${owners.join(',')})&select=id,business_name`),
      clientIds.length ? get(`clients?id=in.(${clientIds.join(',')})&select=id,full_name,email,phone`) : [],
      intervs.length ? get(`vitrine_equipe?id=in.(${intervs.join(',')})&select=id,nom`).catch(() => []) : [],
      get(`parametres_facturation?owner_id=in.(${owners.join(',')})&select=owner_id,emetteur_email`).catch(() => [])
    ]);

    const bilan = { ok: true, dry, rendez_vous: rdvs.length, emails: 0, sms: 0, ignores_sms_sans_fournisseur: 0, erreurs: 0, apercu: [] };
    const smsParSalon = {};
    for(const r of rdvs){
      const reg = reglages.find(x => x.owner_id === r.owner_id) || {};
      const salon = (profils.find(x => x.id === r.owner_id) || {}).business_name || 'votre salon';
      const cl = r.client_id ? clients.find(x => x.id === r.client_id) : null;
      const email = (cl && cl.email) || r.prospect_email || null, tel = normaliserTelephone((cl && cl.phone) || r.prospect_telephone);
      const reglement = etatReglement(r);
      const avec = (equipe.find(x => x.id === r.intervenant_id) || {}).nom || null;
      const ligne = { id: r.id, salon, debut: r.date_debut, email: !!email, sms: !!tel };

      if(reg.rappel_email !== false && email && !r.rappel_email_le && (RESEND_API_KEY || dry)){
        ligne.envoi_email = true;
        if(!dry){
          try{
            await envoyerEmail({
              to: email, replyTo: (facts.find(x => x.owner_id === r.owner_id) || {}).emetteur_email,
              sujet: `Rappel : rendez-vous demain à ${heureFr(r.date_debut)} chez ${salon}`,
              html: htmlEmail({ salon, debut: r.date_debut, fin: r.date_fin, titre: r.titre, avec, adresse: reg.adresse_annuaire, reglement, lien: lienEspace(email, origine), ics: r.avis_token ? `${origine}/api/rendez-vous-ics?t=${r.avis_token}` : null })
            });
            await marquer(r.id, 'rappel_email_le'); bilan.emails++;
          }catch(e){ bilan.erreurs++; }
        }
      }
      if(reg.rappel_sms === true && tel && !r.rappel_sms_le){
        if(!smsConfigure()){ bilan.ignores_sms_sans_fournisseur++; }
        else if((smsParSalon[r.owner_id] = (smsParSalon[r.owner_id] || 0) + 1) <= MAX_SMS_PAR_SALON){
          ligne.envoi_sms = true;
          if(!dry){
            try{ await envoyerSms(tel, texteRappel({ salon, debut: r.date_debut, titre: r.titre, reglement, origine })); await marquer(r.id, 'rappel_sms_le'); bilan.sms++; }
            catch(e){ bilan.erreurs++; }
          }
        }
      }
      if(dry) bilan.apercu.push(ligne);
    }
    if(!dry) delete bilan.apercu;
    return json(200, bilan);
  }catch(e){
    return json(500, { error: 'Erreur pendant les rappels.' });
  }
}
