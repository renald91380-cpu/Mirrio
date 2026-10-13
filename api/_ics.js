// Cadence — génération d'un fichier .ics pour UN rendez-vous (module partagé,
// pas une route : le préfixe `_` empêche Vercel de l'exposer).
//
// Sert à api/rendez-vous-ics.js (téléchargement par le client) et aux emails
// de réservation (pièce jointe pour le client ET le praticien).
//
// UID = `<id>@cadence`, identique à celui du flux d'abonnement api/agenda.js :
// un praticien abonné au flux ET ayant ouvert l'invitation ne voit pas
// le rendez-vous en double.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

const esc = s => String(s == null ? '' : s)
  .replace(/\\/g, '\\\\').replace(/;/g, '\\;').replace(/,/g, '\\,').replace(/\r?\n/g, '\\n');

// RFC 5545 : lignes ≤ 75 octets, pliées sur les octets UTF-8.
function plier(ligne){
  const o = Buffer.from(ligne, 'utf8');
  if(o.length <= 75) return ligne;
  const morceaux = []; let debut = 0, limite = 75;
  while(debut < o.length){
    let fin = Math.min(debut + limite, o.length);
    while(fin > debut && fin < o.length && (o[fin] & 0xC0) === 0x80) fin--;
    morceaux.push(o.slice(debut, fin).toString('utf8'));
    debut = fin; limite = 74;
  }
  return morceaux.join('\r\n ');
}

const horodatage = d => new Date(d).toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');

export function construireIcs({ rdv, praticien, lieu, lien }){
  const lignes = [
    'BEGIN:VCALENDAR', 'VERSION:2.0', 'PRODID:-//Cadence//Rendez-vous//FR',
    'CALSCALE:GREGORIAN', 'METHOD:PUBLISH',
    'BEGIN:VEVENT',
    `UID:${rdv.id}@cadence`,
    `DTSTAMP:${horodatage(new Date())}`,
    `DTSTART:${horodatage(rdv.date_debut)}`,
    `DTEND:${horodatage(rdv.date_fin)}`,
    `SUMMARY:${esc(`${rdv.titre_public || rdv.titre} — ${praticien}`)}`,
    lieu ? `LOCATION:${esc(lieu)}` : null,
    `DESCRIPTION:${esc(['Rendez-vous avec ' + praticien, lien ? 'Détails : ' + lien : null].filter(Boolean).join('\n'))}`,
    // Une demande « en attente » est provisoire tant que le praticien ne l'a pas validée.
    `STATUS:${rdv.statut === 'annule' ? 'CANCELLED' : rdv.statut === 'en_attente' ? 'TENTATIVE' : 'CONFIRMED'}`,
    'TRANSP:OPAQUE',
    'BEGIN:VALARM', 'ACTION:DISPLAY', `DESCRIPTION:${esc('Rendez-vous dans 1 heure')}`, 'TRIGGER:-PT1H', 'END:VALARM',
    'END:VEVENT', 'END:VCALENDAR'
  ];
  return lignes.filter(Boolean).map(plier).join('\r\n') + '\r\n';
}

async function get(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

async function chargerEtConstruire(filtre, origine){
  const [rdv] = await get(`rendez_vous?${filtre}&select=id,owner_id,titre,date_debut,date_fin,statut,avis_token`);
  if(!rdv) return null;
  const [[profil], [reglages]] = await Promise.all([
    get(`profiles?id=eq.${rdv.owner_id}&select=business_name,full_name`),
    get(`parametres_reservation?owner_id=eq.${rdv.owner_id}&select=adresse_annuaire`)
  ]);
  const praticien = profil?.business_name || profil?.full_name || 'Votre praticien';
  const lien = origine && rdv.avis_token ? `${origine}/api/rendez-vous-ics?t=${rdv.avis_token}` : null;
  return {
    token: rdv.avis_token, lien, praticien,
    ics: construireIcs({ rdv, praticien, lieu: reglages?.adresse_annuaire, lien })
  };
}

// Pour une route publique : par jeton-capacité.
export function icsParJeton(jeton, origine){
  if(!/^[a-f0-9]{64}$/.test(jeton || '')) return Promise.resolve(null);
  return chargerEtConstruire(`avis_token=eq.${jeton}`, origine);
}

// Pour les emails : par id interne. Best-effort, renvoie null en cas d'échec
// (un .ics manquant ne doit jamais bloquer une réservation).
export async function icsParId(rdvId, origine){
  try{ return await chargerEtConstruire(`id=eq.${rdvId}`, origine); }catch(e){ return null; }
}

// Pièce jointe au format attendu par Resend.
export const pieceJointe = ics => ics
  ? [{ filename: 'rendez-vous.ics', content: Buffer.from(ics, 'utf8').toString('base64'), content_type: 'text/calendar; charset=utf-8; method=PUBLISH' }]
  : undefined;
