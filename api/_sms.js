// Mirrio - SMS aux clients (module `_`, pas une route Vercel).
//
// Deux SMS seulement, jamais d'autre :
//   1. Confirmation : dès qu'un rendez-vous est confirmé (réservation gratuite, acompte ou paiement carte/PayPal).
//   2. Rappel la veille (voir api/_rappels.js).
// Les deux disent où en est le règlement : rien à prévoir, reste X € sur place, ou total à régler sur place.
//
// Réservé aux salons qui l'activent (`parametres_reservation.rappel_sms`, faux par défaut : chaque SMS est
// facturé par le fournisseur). Fournisseur : Twilio (TWILIO_ACCOUNT_SID, TWILIO_AUTH_TOKEN, TWILIO_FROM).
// Sans clés Twilio, rien n'est envoyé et rien ne casse. Jamais bloquant pour une réservation.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TWILIO_SID = process.env.TWILIO_ACCOUNT_SID, TWILIO_TOKEN = process.env.TWILIO_AUTH_TOKEN, TWILIO_FROM = process.env.TWILIO_FROM || 'Mirrio';
const enc = encodeURIComponent;
const entetes = { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' };

export const smsConfigure = () => !!(TWILIO_SID && TWILIO_TOKEN);

// Numéro vers E.164. null si invalide. En France seuls les mobiles (06, 07) reçoivent un SMS.
export function normaliserTelephone(brut){
  let t = String(brut || '').replace(/[\s.\-()]/g, '');
  if(/^00\d+$/.test(t)) t = '+' + t.slice(2);
  if(/^0[1-9]\d{8}$/.test(t)) t = '+33' + t.slice(1);
  if(!/^\+\d{8,15}$/.test(t)) return null;
  if(t.startsWith('+33') && !/^\+33[67]\d{8}$/.test(t)) return null;
  return t;
}

export function heureFr(iso){
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return p.minute === '00' ? `${Number(p.hour)}h` : `${Number(p.hour)}h${p.minute}`;
}
const jourCourt = iso => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' }).format(new Date(iso));
const eur = n => `${Math.round(Number(n) * 100) / 100}`.replace('.', ',') + ' €';

// Où en est le règlement d'un rendez-vous : { type:'paye' } | { type:'reste', montant } | { type:'du', total } | null.
export function etatReglement(r){
  const reste = r.paiement_mode === 'sur_place' && !r.reste_encaisse_le ? Number(r.reste_sur_place) || 0 : 0;
  if(reste > 0) return { type: 'reste', montant: reste };
  if(r.paiement_statut === 'paye' || r.reste_encaisse_le) return { type: 'paye' };
  if(r.total_ttc != null && Number(r.total_ttc) > 0) return { type: 'du', total: Number(r.total_ttc) };
  return null;
}
export function phraseReglement(e, { confirmation = false } = {}){
  if(!e) return '';
  if(e.type === 'paye') return confirmation ? 'Payé, rien à régler sur place.' : 'Rien à régler sur place.';
  if(e.type === 'reste') return confirmation ? `Acompte reçu, reste ${eur(e.montant)} sur place.` : `Reste ${eur(e.montant)} sur place.`;
  return `À régler sur place : ${eur(e.total)}.`;
}

export function texteConfirmation({ salon, debut, avec, reglement, origine }){
  return `${salon} : RDV confirmé ${jourCourt(debut)} à ${heureFr(debut)}${avec ? ' avec ' + avec : ''}. ${phraseReglement(reglement, { confirmation: true })} Gérer : ${origine}/mon-espace.html`.replace(/\s+/g, ' ');
}
export function texteRappel({ salon, debut, titre, reglement, origine }){
  const t = String(titre || '').slice(0, 40);
  return `Rappel : RDV demain à ${heureFr(debut)} chez ${salon}${t ? ' (' + t + ')' : ''}. ${phraseReglement(reglement)} Gérer : ${origine}/mon-espace.html`.replace(/\s+/g, ' ');
}

async function get(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, { headers: entetes });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}
export async function marquerRendezVous(id, champ){
  await fetch(`${SUPABASE_URL}/rest/v1/rendez_vous?id=eq.${enc(id)}`, {
    method: 'PATCH', headers: { ...entetes, 'Content-Type': 'application/json', Prefer: 'return=minimal' }, body: JSON.stringify({ [champ]: new Date().toISOString() })
  });
}
export async function envoyerSms(to, corps){
  const r = await fetch(`https://api.twilio.com/2010-04-01/Accounts/${TWILIO_SID}/Messages.json`, {
    method: 'POST',
    headers: { Authorization: 'Basic ' + Buffer.from(`${TWILIO_SID}:${TWILIO_TOKEN}`).toString('base64'), 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ To: to, From: TWILIO_FROM, Body: corps }).toString()
  });
  if(!r.ok) throw new Error('Twilio ' + r.status);
}

// SMS de confirmation d'un rendez-vous. Appelé juste après la confirmation, charge lui-même l'état à jour du rendez-vous.
// Renvoie true s'il est parti. Ne lève jamais d'erreur.
export async function smsConfirmation({ rdvId, ownerId, telephone, origine }){
  try{
    const to = normaliserTelephone(telephone);
    if(!to || !smsConfigure()) return false;
    const reg = (await get(`parametres_reservation?owner_id=eq.${ownerId}&select=rappel_sms`))[0];
    if(!reg || reg.rappel_sms !== true) return false;
    const rdv = (await get(`rendez_vous?id=eq.${rdvId}&select=date_debut,statut,intervenant_id,paiement_statut,paiement_mode,reste_sur_place,reste_encaisse_le,total_ttc,sms_confirmation_le`))[0];
    if(!rdv || rdv.sms_confirmation_le || rdv.statut === 'annule' || rdv.statut === 'en_attente') return false;   // déjà envoyé (webhook rejoué) ou pas confirmé
    const [profil, equipe] = await Promise.all([
      get(`profiles?id=eq.${ownerId}&select=business_name`).catch(() => []),
      rdv.intervenant_id ? get(`vitrine_equipe?id=eq.${rdv.intervenant_id}&select=nom`).catch(() => []) : []
    ]);
    const texte = texteConfirmation({ salon: (profil[0] || {}).business_name || 'Votre salon', debut: rdv.date_debut, avec: (equipe[0] || {}).nom || null, reglement: etatReglement(rdv), origine });
    await envoyerSms(to, texte);
    await marquerRendezVous(rdvId, 'sms_confirmation_le');
    return true;
  }catch(e){ return false; }
}
