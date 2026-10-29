// Mirrio — démonstration du multi-salons (salons.html?demo=1) : une fausse base en mémoire (sessionStorage), rien n'est envoyé au serveur.
// Un groupe fictif de trois salons (barbier à Lyon, coiffure à Paris, institut à Bordeaux), des chiffres du mois, et la possibilité d'en ajouter
// d'autres (jusqu'à 10) pour voir ce que devient le tableau de bord du groupe.
const CLE = 'mirrio-demo-salons-v1';
const MAX_SALONS = 10;

export const PAGES_PUBLIQUES = { 'demo-barber': 'pro.html?p=demo-barber', 'demo-coiffure': 'pro.html?p=demo-coiffure', 'demo-institut': 'pro.html?p=demo-institut' };

function initial(){
  const s = (id, nom, metier, ville, slug, principal, stats) => ({ id, nom, metier, ville, plan:'studio', principal, slug, stats });
  return { n:1, actif:'s-eloise', salons:[
    s('s-eloise', 'Maison Éloïse', 'coiffure', 'Paris', 'demo-coiffure', true, { nb_clients:412, rdv_mois:236, rdv_7j:58, ca_mois:9840, nb_equipe:4 }),
    s('s-barber', 'The Barber Club', 'barbier', 'Lyon 1er', 'demo-barber', false, { nb_clients:268, rdv_mois:184, rdv_7j:47, ca_mois:6120, nb_equipe:3 }),
    s('s-lotus', 'Institut Lotus', 'esthetique', 'Bordeaux', 'demo-institut', false, { nb_clients:190, rdv_mois:97, rdv_7j:21, ca_mois:5260, nb_equipe:2 })
  ] };
}

let DB;
const charger = () => { try{ DB = JSON.parse(sessionStorage.getItem(CLE)); }catch(e){ DB = null; } if(!DB) DB = initial(); };
const sauver = () => { try{ sessionStorage.setItem(CLE, JSON.stringify(DB)); }catch(e){} };
export const reinitialiserDemoSalons = () => { try{ sessionStorage.removeItem(CLE); }catch(e){} };
export const salonParId = id => { charger(); return DB.salons.find(x => x.id === id) || null; };

export function creerFauxSupabase(){
  charger();
  const ok = data => Promise.resolve({ data, error:null });
  return {
    auth: { getSession:async () => ({ data:{ session:{ access_token:'demo', user:{ id:'u-demo' } } } }) },
    rpc: async (nom, a) => {
      if(nom === 'mes_salons') return ok(DB.salons.map(x => ({ id:x.id, nom:x.nom, metier:x.metier, ville:x.ville, plan:x.plan, principal:x.principal, actif:x.id === DB.actif })));
      if(nom === 'groupe_stats') return ok(DB.salons.map(x => ({ salon_id:x.id, nom:x.nom, ...x.stats })));
      if(nom === 'basculer_espace'){ DB.actif = (a && a.p_espace_id) || DB.salons.find(x => x.principal).id; sauver(); return ok(null); }
      return ok(null);
    }
  };
}

// Imite POST /api/salons : mêmes règles (nom de 2 à 80 caractères, 10 salons au plus).
export function reponseCreation(corps){
  charger();
  const nom = String(corps.nom || '').trim(), reponse = (statut, json) => ({ ok:statut < 400, status:statut, json:async () => json });
  if(nom.length < 2 || nom.length > 80) return reponse(400, { error:'Le nom du salon doit faire entre 2 et 80 caractères.' });
  if(DB.salons.length >= MAX_SALONS) return reponse(400, { error:`Limite de ${MAX_SALONS} salons atteinte. Contactez-nous pour aller au-delà.` });
  const id = 's-nouveau-' + (DB.n++);
  DB.salons.push({ id, nom, metier:corps.metier || 'coiffure', ville:String(corps.ville || '').trim() || null, plan:'studio', principal:false, slug:null, description:String(corps.description || '').trim().slice(0, 600) || null, stats:{ nb_clients:0, rdv_mois:0, rdv_7j:0, ca_mois:0, nb_equipe:0 } });
  sauver();
  return reponse(200, { id, nom });
}
