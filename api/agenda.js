// Cadence — flux iCalendar des rendez-vous d'un utilisateur.
//
//   GET /api/agenda?t=<jeton>
//
// Répond un calendrier au format iCalendar (RFC 5545) auquel Google Agenda,
// Apple Calendrier ou Outlook peuvent s'abonner. Le jeton est une URL-capacité :
// il n'y a pas de session, l'URL elle-même fait l'autorisation — c'est le seul
// mécanisme que comprennent les clients d'agenda, qui ne savent pas s'authentifier
// sur un abonnement. Le jeton est régénérable depuis l'écran Paramètres.
//
// Aucune dépendance npm : le projet n'a pas d'étape de build, on s'en tient au
// `fetch` du runtime.
//
// Variables d'environnement attendues sur Vercel :
//   SUPABASE_URL                 — https://xxxx.supabase.co
//   SUPABASE_SERVICE_ROLE_KEY    — clé service_role (secrète, jamais côté client)

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

// Fenêtre publiée : un mois en arrière (pour garder l'historique récent visible)
// et un an en avant (les récurrences sont matérialisées en base, pas calculées).
const JOURS_PASSE = 31;
const JOURS_FUTUR = 366;

function texte(res, statut, corps, entetes){
  res.statusCode = statut;
  for(const [k, v] of Object.entries(entetes || {})) res.setHeader(k, v);
  res.end(corps);
}

// Échappement iCalendar : la virgule, le point-virgule et l'antislash sont des
// séparateurs de syntaxe, les retours à la ligne s'encodent en \n littéral.
function esc(str){
  return String(str == null ? '' : str)
    .replace(/\\/g, '\\\\')
    .replace(/;/g, '\\;')
    .replace(/,/g, '\\,')
    .replace(/\r?\n/g, '\\n');
}

// RFC 5545 §3.1 : une ligne fait au plus 75 octets, les suivantes commencent
// par une espace. On plie sur les octets UTF-8, pas sur les caractères, sinon
// un accent en fin de ligne casse le pliage.
function plier(ligne){
  const octets = Buffer.from(ligne, 'utf8');
  if(octets.length <= 75) return ligne;
  const morceaux = [];
  let debut = 0;
  let limite = 75;
  while(debut < octets.length){
    let fin = Math.min(debut + limite, octets.length);
    // Ne pas couper au milieu d'une séquence UTF-8 multi-octets.
    while(fin > debut && fin < octets.length && (octets[fin] & 0xC0) === 0x80) fin--;
    morceaux.push(octets.slice(debut, fin).toString('utf8'));
    debut = fin;
    limite = 74; // les lignes de continuation perdent un octet pour l'espace
  }
  return morceaux.join('\r\n ');
}

function horodatage(d){
  const dt = (d instanceof Date) ? d : new Date(d);
  return dt.toISOString().replace(/[-:]/g, '').replace(/\.\d{3}/, '');
}

async function supabase(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json'
    }
  });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

export default async function handler(req, res){
  if(req.method !== 'GET' && req.method !== 'HEAD'){
    return texte(res, 405, 'Method Not Allowed', { Allow:'GET, HEAD' });
  }
  if(!SUPABASE_URL || !SERVICE_KEY){
    return texte(res, 500, 'Flux indisponible : configuration serveur incomplète.',
      { 'Content-Type':'text/plain; charset=utf-8' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const jeton = url.searchParams.get('t') || '';

  // Format vérifié avant toute requête : 64 caractères hexadécimaux.
  if(!/^[0-9a-f]{64}$/.test(jeton)){
    return texte(res, 404, 'Flux introuvable.', { 'Content-Type':'text/plain; charset=utf-8' });
  }

  let proprietaire, nomAffiche = 'Cadence';
  try{
    const flux = await supabase(`calendar_feeds?token=eq.${jeton}&select=owner_id&limit=1`);
    if(!flux.length){
      return texte(res, 404, 'Flux introuvable.', { 'Content-Type':'text/plain; charset=utf-8' });
    }
    proprietaire = flux[0].owner_id;

    const profils = await supabase(
      `profiles?id=eq.${proprietaire}&select=business_name,full_name&limit=1`);
    if(profils.length){
      nomAffiche = profils[0].business_name || profils[0].full_name || 'Cadence';
    }
  }catch(e){
    return texte(res, 503, 'Flux temporairement indisponible.',
      { 'Content-Type':'text/plain; charset=utf-8' });
  }

  const maintenant = new Date();
  const depuis = new Date(maintenant.getTime() - JOURS_PASSE * 86400000).toISOString();
  const jusqua = new Date(maintenant.getTime() + JOURS_FUTUR * 86400000).toISOString();

  let rdvs = [], clients = {};
  try{
    rdvs = await supabase(
      `rendez_vous?owner_id=eq.${proprietaire}` +
      `&date_debut=gte.${depuis}&date_debut=lte.${jusqua}` +
      `&select=id,titre,date_debut,date_fin,statut,notes,client_id,updated_at` +
      `&order=date_debut.asc&limit=2000`);

    const ids = [...new Set(rdvs.map(r => r.client_id).filter(Boolean))];
    if(ids.length){
      const liste = await supabase(
        `clients?id=in.(${ids.join(',')})&select=id,full_name`);
      liste.forEach(c => { clients[c.id] = c.full_name; });
    }
  }catch(e){
    return texte(res, 503, 'Flux temporairement indisponible.',
      { 'Content-Type':'text/plain; charset=utf-8' });
  }

  const lignes = [
    'BEGIN:VCALENDAR',
    'VERSION:2.0',
    'PRODID:-//Cadence//Agenda//FR',
    'CALSCALE:GREGORIAN',
    'METHOD:PUBLISH',
    `X-WR-CALNAME:${esc(nomAffiche)}`,
    'X-WR-TIMEZONE:Europe/Paris',
    // Indication de rafraîchissement : respectée par Outlook, ignorée par Google,
    // qui applique sa propre cadence (souvent plusieurs heures).
    'REFRESH-INTERVAL;VALUE=DURATION:PT1H',
    'X-PUBLISHED-TTL:PT1H'
  ];

  for(const rdv of rdvs){
    const client = rdv.client_id ? clients[rdv.client_id] : null;
    const titre = client ? `${rdv.titre} — ${client}` : rdv.titre;
    const description = [
      client ? `Client : ${client}` : null,
      rdv.notes || null
    ].filter(Boolean).join('\n');

    lignes.push(
      'BEGIN:VEVENT',
      `UID:${rdv.id}@cadence`,
      `DTSTAMP:${horodatage(rdv.updated_at || maintenant)}`,
      `DTSTART:${horodatage(rdv.date_debut)}`,
      `DTEND:${horodatage(rdv.date_fin)}`,
      `SUMMARY:${esc(titre)}`,
      description ? `DESCRIPTION:${esc(description)}` : null,
      // Un rendez-vous annulé n'est pas retiré du flux : il passe en CANCELLED
      // pour que l'agenda abonné le retire de son côté plutôt que de le garder.
      `STATUS:${rdv.statut === 'annule' ? 'CANCELLED' : 'CONFIRMED'}`,
      'TRANSP:OPAQUE',
      'END:VEVENT'
    );
  }

  lignes.push('END:VCALENDAR');

  const ics = lignes.filter(Boolean).map(plier).join('\r\n') + '\r\n';

  // Trace de dernier accès, utile pour dire à l'utilisateur si son agenda
  // interroge vraiment le flux. Silencieuse : elle ne doit jamais faire échouer
  // la réponse.
  fetch(`${SUPABASE_URL}/rest/v1/calendar_feeds?token=eq.${jeton}`, {
    method: 'PATCH',
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal'
    },
    body: JSON.stringify({ last_access_at: new Date().toISOString() })
  }).catch(() => {});

  return texte(res, 200, ics, {
    'Content-Type': 'text/calendar; charset=utf-8',
    'Content-Disposition': 'inline; filename="cadence.ics"',
    'Cache-Control': 'public, max-age=900',
    'X-Robots-Tag': 'noindex, nofollow'
  });
}
