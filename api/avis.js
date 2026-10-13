// Cadence — dépôt d'un avis client, lié à un rendez-vous réel.
//
//   GET  /api/avis?t=<avis_token>   → { praticien, titre, date, deja_note }
//   POST /api/avis  { t, note, commentaire?, auteur? }
//
// Le jeton (`rendez_vous.avis_token`) est une URL-capacité : celui qui l'a
// peut déposer UN avis pour CE rendez-vous, une fois, une fois le rendez-vous
// terminé. Rendez-vous annulé ou encore « en attente » : refusé.
//
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

function json(res, statut, corps){
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

async function rest(chemin, options = {}){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...options,
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json',
               'Content-Type': 'application/json', ...(options.headers || {}) }
  });
  if(!r.ok) throw Object.assign(new Error(`Supabase ${r.status}`), { statut: r.status });
  return r.status === 204 ? null : r.json();
}

async function chargerRendezVous(jeton){
  if(!/^[a-f0-9]{64}$/.test(jeton || '')) return null;
  const [rv] = await rest(`rendez_vous?avis_token=eq.${jeton}&select=id,owner_id,titre,date_fin,statut`);
  return rv || null;
}

export default async function handler(req, res){
  if(!SUPABASE_URL || !SERVICE_KEY) return json(res, 500, { error: 'Serveur non configuré.' });
  try{
    if(req.method === 'GET'){
      const jeton = new URL(req.url, 'http://x').searchParams.get('t');
      const rv = await chargerRendezVous(jeton);
      if(!rv) return json(res, 404, { error: 'Lien invalide.' });
      const [profil] = await rest(`profiles?id=eq.${rv.owner_id}&select=business_name,full_name`);
      const existant = await rest(`avis?rendez_vous_id=eq.${rv.id}&select=id`);
      return json(res, 200, {
        praticien: profil?.business_name || profil?.full_name || 'Votre praticien',
        titre: rv.titre, date: rv.date_fin,
        deja_note: existant.length > 0,
        pas_encore: new Date(rv.date_fin) > new Date() || ['annule', 'en_attente'].includes(rv.statut)
      });
    }

    if(req.method === 'POST'){
      let corps = req.body;
      if(typeof corps === 'string') corps = JSON.parse(corps || '{}');
      const rv = await chargerRendezVous(corps?.t);
      if(!rv) return json(res, 404, { error: 'Lien invalide.' });
      if(new Date(rv.date_fin) > new Date() || ['annule', 'en_attente'].includes(rv.statut))
        return json(res, 409, { error: 'Vous pourrez donner votre avis une fois le rendez-vous passé.' });
      const note = Number(corps.note);
      if(!Number.isInteger(note) || note < 1 || note > 5) return json(res, 400, { error: 'Note invalide.' });
      const commentaire = String(corps.commentaire || '').trim().slice(0, 800) || null;
      const auteur = String(corps.auteur || '').trim().slice(0, 60) || null;
      try{
        await rest('avis', { method: 'POST', headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ owner_id: rv.owner_id, rendez_vous_id: rv.id, note, commentaire, auteur }) });
      }catch(e){
        if(e.statut === 409) return json(res, 409, { error: 'Vous avez déjà donné votre avis. Merci !' });
        throw e;
      }
      return json(res, 200, { ok: true });
    }

    return json(res, 405, { error: 'Méthode non autorisée.' });
  }catch(e){
    return json(res, 500, { error: 'Erreur serveur.' });
  }
}
