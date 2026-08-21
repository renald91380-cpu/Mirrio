// Cadence — poussée des rendez-vous vers Google Calendar.
//
// Le jeton d'accès Google arrive avec la session Supabase (`provider_token`)
// quand l'utilisateur s'est connecté via Google en accordant l'autorisation
// `calendar.events`. Il est de courte durée : dès qu'il expire, la poussée
// s'arrête proprement et l'abonnement iCalendar (voir `api/agenda.js`) reste
// le canal de secours, lui toujours disponible.
//
// Rien n'est bloquant ici : un échec de synchronisation ne doit jamais empêcher
// d'enregistrer un rendez-vous dans Cadence. La base de Cadence fait foi ;
// Google n'en est qu'un reflet.

const API = 'https://www.googleapis.com/calendar/v3';

export const RAISONS = {
  NON_RELIE: 'non_relie',
  JETON_EXPIRE: 'jeton_expire',
  ERREUR: 'erreur'
};

async function connexionActive(supabase){
  const { data } = await supabase
    .from('calendar_connections')
    .select('calendar_id, actif')
    .maybeSingle();
  return (data && data.actif) ? data : null;
}

async function jetonGoogle(supabase){
  const { data } = await supabase.auth.getSession();
  return data?.session?.provider_token || null;
}

function versEvenement(rdv, nomClient){
  const titre = nomClient ? `${rdv.titre} — ${nomClient}` : rdv.titre;
  const description = [
    nomClient ? `Client : ${nomClient}` : null,
    rdv.notes || null,
    'Créé depuis Cadence.'
  ].filter(Boolean).join('\n');

  return {
    summary: titre,
    description,
    start: { dateTime: new Date(rdv.date_debut).toISOString(), timeZone: 'Europe/Paris' },
    end:   { dateTime: new Date(rdv.date_fin).toISOString(),   timeZone: 'Europe/Paris' },
    status: rdv.statut === 'annule' ? 'cancelled' : 'confirmed',
    source: { title: 'Cadence', url: window.location.origin + '/agenda.html' }
  };
}

async function appel(jeton, chemin, methode, corps){
  const r = await fetch(`${API}${chemin}`, {
    method: methode,
    headers: {
      Authorization: `Bearer ${jeton}`,
      'Content-Type': 'application/json'
    },
    body: corps ? JSON.stringify(corps) : undefined
  });
  if(r.status === 401 || r.status === 403){
    const e = new Error('jeton'); e.raison = RAISONS.JETON_EXPIRE; throw e;
  }
  if(!r.ok && r.status !== 404){
    const e = new Error('google'); e.raison = RAISONS.ERREUR; throw e;
  }
  return r.status === 404 ? null : r.json();
}

// Crée ou met à jour l'évènement Google correspondant à un rendez-vous.
// Renvoie { ok, raison? } — jamais d'exception vers l'appelant.
export async function pousserRendezVous(supabase, rdv, nomClient){
  try{
    const conn = await connexionActive(supabase);
    if(!conn) return { ok:false, raison: RAISONS.NON_RELIE };

    const jeton = await jetonGoogle(supabase);
    if(!jeton) return { ok:false, raison: RAISONS.JETON_EXPIRE };

    const calendrier = encodeURIComponent(conn.calendar_id || 'primary');
    const evenement = versEvenement(rdv, nomClient);

    let resultat = null;
    if(rdv.google_event_id){
      resultat = await appel(jeton,
        `/calendars/${calendrier}/events/${encodeURIComponent(rdv.google_event_id)}`,
        'PATCH', evenement);
    }
    // Pas d'identifiant connu, ou évènement supprimé côté Google : on en crée un.
    if(!resultat){
      resultat = await appel(jeton, `/calendars/${calendrier}/events`, 'POST', evenement);
    }

    if(resultat && resultat.id){
      await supabase.from('rendez_vous')
        .update({ google_event_id: resultat.id, synced_at: new Date().toISOString() })
        .eq('id', rdv.id);
      await supabase.from('calendar_connections')
        .update({ last_sync_at: new Date().toISOString(), last_error: null })
        .eq('owner_id', rdv.owner_id);
    }
    return { ok:true };
  }catch(err){
    return { ok:false, raison: err.raison || RAISONS.ERREUR };
  }
}

export async function supprimerRendezVous(supabase, rdv){
  try{
    if(!rdv.google_event_id) return { ok:true };
    const conn = await connexionActive(supabase);
    if(!conn) return { ok:false, raison: RAISONS.NON_RELIE };
    const jeton = await jetonGoogle(supabase);
    if(!jeton) return { ok:false, raison: RAISONS.JETON_EXPIRE };

    const calendrier = encodeURIComponent(conn.calendar_id || 'primary');
    await appel(jeton,
      `/calendars/${calendrier}/events/${encodeURIComponent(rdv.google_event_id)}`,
      'DELETE');
    return { ok:true };
  }catch(err){
    return { ok:false, raison: err.raison || RAISONS.ERREUR };
  }
}

// Poussée groupée, pour les occurrences d'un rendez-vous récurrent.
// Séquentielle à dessein : Google limite le débit, et une rafale de requêtes
// parallèles se fait rejeter plus vite qu'elle n'accélère quoi que ce soit.
export async function pousserPlusieurs(supabase, rdvs, nomParClient){
  let ok = 0, echecs = 0, raison = null;
  for(const rdv of rdvs){
    const r = await pousserRendezVous(supabase, rdv, rdv.client_id ? nomParClient[rdv.client_id] : null);
    if(r.ok) ok++;
    else { echecs++; raison = raison || r.raison; }
    if(raison === RAISONS.NON_RELIE || raison === RAISONS.JETON_EXPIRE) break;
  }
  return { ok, echecs, raison };
}

// Message affichable, pour que chaque écran n'invente pas sa propre formulation.
export function messagePour(raison){
  switch(raison){
    case RAISONS.NON_RELIE:
      return null; // silencieux : l'utilisateur n'a rien demandé
    case RAISONS.JETON_EXPIRE:
      return 'Rendez-vous enregistré. La connexion Google a expiré — reliez-la à nouveau dans Paramètres pour reprendre la synchronisation.';
    default:
      return 'Rendez-vous enregistré. La synchronisation Google a échoué, il reste visible dans votre flux iCalendar.';
  }
}
