// Mirrio - calcul de disponibilité, partagé par api/reservation-disponibilites.js
// (créneaux proposés) et api/reservation-publique.js (revérification juste avant
// d'écrire). Module `_` : pas une route Vercel (limite de 12 fonctions).
//
// Modèle : un « intervenant » est une ligne réservable de `vitrine_equipe`.
//   - Un intervenant SANS affectation assure toutes les prestations ; avec des affectations,
//     seulement celles-là (réglage « Prestations assurées » de la fiche de la personne).
//   - Un intervenant est ÉLIGIBLE pour une sélection s'il assure TOUTES les prestations
//     choisies (une personne fait l'ensemble, à la suite).
//   - Sans aucun intervenant réservable (salon seul), le salon est une unique ressource.
//   - Un créneau est libre si AU MOINS une ressource éligible est ouverte et sans
//     chevauchement. Un rendez-vous non attribué bloque tout le monde (prudence).
// Tolérant à l'absence de schema-v20 : toute table/colonne manquante = salon seul.

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;

export async function get(chemin){
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}`, Accept: 'application/json' }
  });
  if(!r.ok) throw new Error(`Supabase ${r.status}`);
  return r.json();
}

// ------------------------------------------------------------ fuseau horaire
// Heure murale Europe/Paris -> instant UTC réel, en tenant compte de CET/CEST.
function decalageMinutes(date){
  const parts = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone:'Europe/Paris', hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit', second:'2-digit' })
      .formatToParts(date).map(p => [p.type, p.value])
  );
  return Math.round((Date.UTC(+parts.year, +parts.month - 1, +parts.day, +parts.hour, +parts.minute, +parts.second) - date.getTime()) / 60000);
}
export function parisVersUtc(annee, mois, jour, heure, minute){
  const approx = new Date(Date.UTC(annee, mois - 1, jour, heure, minute));
  return new Date(approx.getTime() - decalageMinutes(approx) * 60000);
}
export function composantsParis(date){
  const p = Object.fromEntries(
    new Intl.DateTimeFormat('en-US', { timeZone:'Europe/Paris', hourCycle:'h23', year:'numeric', month:'2-digit', day:'2-digit', hour:'2-digit', minute:'2-digit' })
      .formatToParts(date).map(x => [x.type, x.value])
  );
  return { annee:+p.year, mois:+p.month, jour:+p.day, heure:+p.hour, minute:+p.minute };
}

const minutes = t => { const [h, m] = String(t).split(':').map(Number); return h * 60 + (m || 0); };

// ------------------------------------------------------------------ contexte
// Charge ce qu'il faut pour calculer : prestations choisies, intervenants
// réservables et affectations. `reglage` = ligne parametres_reservation.
export async function contexte(ownerId, reglage, prestationIds){
  let prestations = await get(`prestations?id=in.(${prestationIds.join(',')})&owner_id=eq.${ownerId}&actif=eq.true&select=id,duree_minutes`);
  let intervenants = [], affectations = [];
  try{
    intervenants = await get(`vitrine_equipe?owner_id=eq.${ownerId}&reservable=eq.true&select=id,nom,role,photo_url,jours_ouvres,heure_debut,heure_fin,position&order=position`);
    if(intervenants.length) affectations = await get(`prestation_intervenants?owner_id=eq.${ownerId}&select=prestation_id,intervenant_id`);
  }catch(e){ intervenants = []; affectations = []; }

  const parIntervenant = new Map();
  affectations.forEach(a => { (parIntervenant.get(a.intervenant_id) || parIntervenant.set(a.intervenant_id, new Set()).get(a.intervenant_id)).add(a.prestation_id); });
  const assure = (i, prestId) => !parIntervenant.has(i.id) || parIntervenant.get(i.id).has(prestId);
  const eligibles = intervenants.filter(i => prestationIds.every(id => assure(i, id)));

  return {
    reglage, ownerId, prestations, prestationIds,
    duree: prestations.reduce((s, p) => s + (Number(p.duree_minutes) || 0), 0),
    intervenants, eligibles,
    solo: intervenants.length === 0
  };
}

// Rendez-vous occupant des créneaux dans [debutIso, finIso[ : non annulés, hors holds de paiement expirés.
export async function occupes(ownerId, debutIso, finIso){
  let lignes;
  try{
    lignes = await get(`rendez_vous?owner_id=eq.${ownerId}&date_debut=lt.${finIso}&date_fin=gt.${debutIso}&select=date_debut,date_fin,statut,paiement_statut,expire_le,intervenant_id`);
  }catch(e){
    lignes = await get(`rendez_vous?owner_id=eq.${ownerId}&date_debut=lt.${finIso}&date_fin=gt.${debutIso}&select=date_debut,date_fin,statut,paiement_statut,expire_le`);
  }
  const now = Date.now();
  return lignes
    .filter(r => r.statut !== 'annule')
    .filter(r => !(r.paiement_statut === 'en_attente' && r.expire_le && new Date(r.expire_le).getTime() < now))
    .map(r => ({ debut:new Date(r.date_debut).getTime(), fin:new Date(r.date_fin).getTime(), intervenant:r.intervenant_id || null }));
}

// Fenêtre de plage horaire d'une ressource pour un jour donné (null = fermé).
function plage(ctx, ressource, jourSemaine){
  const r = ctx.reglage;
  const jours = (ressource && ressource.jours_ouvres) || r.jours_ouvres || [];
  if(!jours.includes(jourSemaine)) return null;
  const d = minutes((ressource && ressource.heure_debut) || r.heure_debut);
  const f = minutes((ressource && ressource.heure_fin) || r.heure_fin);
  return f > d ? { debut:d, fin:f } : null;
}

// Ressources à considérer pour une demande : l'intervenant choisi (s'il est
// éligible), tous les éligibles ('any'/vide), ou le salon seul.
export function ressources(ctx, intervenantId){
  if(ctx.solo) return [null];
  if(intervenantId && intervenantId !== 'any') return ctx.eligibles.filter(i => i.id === intervenantId);
  return ctx.eligibles;
}

const libre = (busy, ressource, debutMs, finMs) =>
  !busy.some(b => debutMs < b.fin && finMs > b.debut && (!ressource || b.intervenant === null || b.intervenant === ressource.id));

// Créneaux d'un jour : [{ iso, intervenants:[ids libres] }]
export function creneauxDuJour(ctx, busy, { annee, mois, jour }, intervenantId){
  const res = ressources(ctx, intervenantId);
  if(!res.length) return [];
  const jourSemaine = new Date(Date.UTC(annee, mois - 1, jour)).getUTCDay();
  const maintenant = Date.now();
  const auPlusTot = maintenant + (ctx.reglage.delai_min_heures || 0) * 3600000;
  const auPlusTard = maintenant + (ctx.reglage.horizon_jours || 0) * 86400000;
  const pas = ctx.reglage.intervalle_minutes || 30;
  const dureeMs = ctx.duree * 60000;
  const par = new Map();   // minute du jour -> ids libres
  res.forEach(rs => {
    const p = plage(ctx, rs, jourSemaine);
    if(!p) return;
    for(let t = p.debut; t + ctx.duree <= p.fin; t += pas){
      const debut = parisVersUtc(annee, mois, jour, Math.floor(t / 60), t % 60).getTime();
      if(debut < auPlusTot || debut > auPlusTard) continue;
      if(!libre(busy, rs, debut, debut + dureeMs)) continue;
      (par.get(t) || par.set(t, []).get(t)).push(rs ? rs.id : null);
    }
  });
  return [...par.entries()].sort((a, b) => a[0] - b[0]).map(([t, ids]) => ({
    iso: parisVersUtc(annee, mois, jour, Math.floor(t / 60), t % 60).toISOString(), intervenants: ids
  }));
}

// Ressource libre pour un créneau précis (revérification à l'écriture). Parmi
// plusieurs libres, prend celle qui a le moins de rendez-vous ce jour-là.
// Renvoie { ok, intervenantId } ; intervenantId = null pour le salon seul.
export function choisirRessource(ctx, busy, debutDate, intervenantId){
  const c = composantsParis(debutDate);
  const debutMs = debutDate.getTime(), finMs = debutMs + ctx.duree * 60000;
  const jourSemaine = new Date(Date.UTC(c.annee, c.mois - 1, c.jour)).getUTCDay();
  const minuteDuJour = c.heure * 60 + c.minute;
  const candidats = ressources(ctx, intervenantId).filter(rs => {
    const p = plage(ctx, rs, jourSemaine);
    return p && minuteDuJour >= p.debut && minuteDuJour + ctx.duree <= p.fin && libre(busy, rs, debutMs, finMs);
  });
  if(!candidats.length) return { ok:false, intervenantId:null };
  const charge = rs => busy.filter(b => rs && b.intervenant === rs.id).length;
  candidats.sort((a, b) => charge(a) - charge(b));
  return { ok:true, intervenantId: candidats[0] ? candidats[0].id : null };
}

// ---------------------------------------------------------------- heures creuses
// Remise proposée sur certains créneaux (jours + plage horaire choisis par le salon). Le serveur est seul juge du prix.
// Absent ou désactivé (ou migration v24 pas passée) : aucune remise.
export async function chargerCreux(ownerId){
  try{
    const l = await get(`parametres_reservation?owner_id=eq.${ownerId}&select=creux_actif,creux_pourcentage,creux_jours,creux_heure_debut,creux_heure_fin`);
    const c = l[0];
    if(!c || !c.creux_actif) return null;
    return { pourcentage: Number(c.creux_pourcentage) || 0, jours: c.creux_jours || [], debut: c.creux_heure_debut, fin: c.creux_heure_fin };
  }catch(e){ return null; }
}

// Tarifs enfant et étudiant (schema-v34), facultatifs et au choix du salon : null = non proposé.
export async function chargerTarifs(ownerId){
  try{
    const l = await get(`parametres_reservation?owner_id=eq.${ownerId}&select=tarif_enfant_actif,tarif_enfant_pourcentage,tarif_enfant_age_max,tarif_etudiant_actif,tarif_etudiant_pourcentage`);
    const c = l[0];
    if(!c) return { enfant: null, etudiant: null };
    return {
      enfant: c.tarif_enfant_actif ? { pourcentage: Number(c.tarif_enfant_pourcentage) || 0, age_max: Number(c.tarif_enfant_age_max) || 12 } : null,
      etudiant: c.tarif_etudiant_actif ? { pourcentage: Number(c.tarif_etudiant_pourcentage) || 0 } : null
    };
  }catch(e){ return { enfant: null, etudiant: null }; }   // migration v34 pas encore passée : aucun tarif spécial
}
// Réduction du tarif demandé ('enfant' | 'etudiant'), 0 si le salon ne le propose pas.
export function pctTarif(tarifs, tarif){
  const t = tarifs && tarif && tarifs[tarif];
  return t && t.pourcentage > 0 ? t.pourcentage : 0;
}

// Pourcentage de remise applicable à un rendez-vous commençant à `debutDate` (0 = aucune).
export function remiseCreux(creux, debutDate){
  if(!creux || !(creux.pourcentage > 0)) return 0;
  const c = composantsParis(debutDate);
  const jourSemaine = new Date(Date.UTC(c.annee, c.mois - 1, c.jour)).getUTCDay();
  if(!creux.jours.includes(jourSemaine)) return 0;
  const m = c.heure * 60 + c.minute;
  return m >= minutes(creux.debut) && m < minutes(creux.fin) ? creux.pourcentage : 0;
}

// Prix TTC après remise, arrondi au centime (même formule côté page : Math.round(prix * (100 - pct)) / 100).
export const prixRemise = (prix, pct) => pct > 0 ? Math.round(prix * (100 - pct)) / 100 : prix;

// Répartit un total remisé (en centimes) sur des lignes proportionnellement à leur prix brut, sans perdre un centime.
export function repartirCentimes(bruts, totalCentimes){
  const somme = bruts.reduce((s, b) => s + b, 0) || 1;
  const lignes = bruts.map(b => Math.floor(b * totalCentimes / somme));
  let reste = totalCentimes - lignes.reduce((s, l) => s + l, 0);
  for(let i = 0; reste > 0; i = (i + 1) % lignes.length, reste--) lignes[i]++;
  return lignes;
}

