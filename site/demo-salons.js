// Mirrio — démonstration du multi-salons (salons.html?demo=1) : une fausse base en mémoire (sessionStorage), rien n'est envoyé au serveur.
// Un groupe fictif de trois salons (coiffure à Paris, barbier à Lyon, institut à Bordeaux), chacun avec sa fiche de paramétrage complète
// (présentation, équipe avec photos, prestations, réservation et paiement), les chiffres du mois, et la possibilité d'en ajouter d'autres
// (jusqu'à 10) pour voir ce que devient le tableau de bord du groupe. Tout ce qui est modifié est gardé le temps de la session.
const CLE = 'mirrio-demo-salons-v2';
const MAX_SALONS = 10;

export const PAGES_PUBLIQUES = { 'demo-barber': 'pro.html?p=demo-barber', 'demo-coiffure': 'pro.html?p=demo-coiffure', 'demo-institut': 'pro.html?p=demo-institut' };
export const JOURS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];

// Prestations de départ d'un salon ajouté, selon son activité (modifiables comme les autres).
const CATALOGUE_TYPE = {
  coiffure:   [['Coupe femme', 50, 45], ['Coupe homme', 30, 28], ['Coloration racines', 90, 58], ['Brushing', 30, 25]],
  barbier:    [['Coupe homme', 30, 28], ['Dégradé', 40, 32], ['Taille de barbe', 20, 18], ['Rasage traditionnel', 30, 30]],
  esthetique: [['Soin visage éclat', 60, 65], ['Épilation jambes', 30, 30], ['Manucure semi-permanent', 45, 35]],
  onglerie:   [['Pose semi-permanent', 45, 35], ['Pose gel', 90, 55], ['Dépose', 30, 15]],
  massage:    [['Massage relaxant 60 min', 60, 75], ['Massage dos 30 min', 30, 45]],
  patisserie: [['Entremets 6 parts', 0, 36], ['Tarte 8 parts', 0, 24]],
  autre:      [['Prestation 1', 30, 30], ['Prestation 2', 60, 55]]
};

function initial(){
  const m = (nom, role, bio) => ({ nom, role, bio, photo:null });
  const p = (libelle, duree, prix, categorie) => ({ libelle, duree, prix, categorie, actif:true });
  const base = { jours:[1, 2, 3, 4, 5], debut:'09:30', fin:'19:00', whatsapp:'06 12 34 56 78' };
  return { n:1, actif:'s-eloise', salons:[
    { id:'s-eloise', nom:'Maison Éloïse', metier:'coiffure', ville:'Paris', plan:'studio', principal:true, slug:'demo-coiffure', stats:{ nb_clients:412, rdv_mois:236, rdv_7j:58, ca_mois:9840 },
      fiche:{ accroche:'Coiffure mixte, colorations végétales', a_propos:"Un salon de quartier, ouvert en 2018 : on prend le temps d'écouter, on choisit des colorations végétales et on conseille une coupe qui vous ressemble et qui tient entre deux rendez-vous.",
        adresse:'12 rue de la République, Paris', horaires:{ ...base, jours:[1, 2, 3, 4, 5], debut:'09:30', fin:'19:00' },
        equipe:[m('Éloïse', 'Fondatrice, coloriste', '12 ans de métier, spécialiste du balayage et des colorations végétales.'), m('Karim', 'Coiffeur-barbier', 'Coupes courtes, dégradés et barbe.'), m('Léa', 'Coiffeuse', 'Coupes longues, chignons et mariages.'), m('Sofia', 'Soins et accueil', 'Soins du cuir chevelu et masques réparateurs.')],
        prestations:[p('Shampoing, coupe, brushing', 70, 55, 'Femme'), p('Coupe homme', 30, 28, 'Homme'), p('Coloration racines', 90, 58, 'Femme'), p('Balayage', 150, 120, 'Femme'), p('Brushing', 30, 25, 'Femme')],
        paiement:{ mode:'acompte', acompte:5, stripe:true }, creux:{ actif:true, pct:15, jours:'mardi à jeudi', plage:'9h30 à 12h' } } },
    { id:'s-barber', nom:'The Barber Club', metier:'barbier', ville:'Lyon 1er', plan:'studio', principal:false, slug:'demo-barber', stats:{ nb_clients:268, rdv_mois:184, rdv_7j:47, ca_mois:6120 },
      fiche:{ accroche:'Coupe, barbe et rasage à l\'ancienne. Sur rendez-vous, sans attente.', a_propos:'Trois fauteuils, une règle : le temps qu\'il faut pour une coupe nette, une barbe tracée au cordeau et un rasage à la serviette chaude.',
        adresse:'4 rue Sainte-Catherine, Lyon', horaires:{ ...base, jours:[1, 2, 3, 4, 5, 6], debut:'09:00', fin:'19:30', whatsapp:'06 98 76 54 32' },
        equipe:[m('Karim', 'Barbier, fondateur', 'Rasage traditionnel, dégradés nets.'), m('Léo', 'Barbier', 'Coupes classiques et taille de barbe.'), m('Yanis', 'Barbier junior', 'Coupes enfants et dégradés.')],
        prestations:[p('Coupe homme', 30, 28, 'Coupe'), p('Dégradé / skin fade', 40, 32, 'Coupe'), p('Taille de barbe et contours', 20, 18, 'Barbe'), p('Rasage traditionnel, serviette chaude', 30, 30, 'Barbe'), p('Coupe enfant', 25, 20, 'Coupe')],
        paiement:{ mode:'acompte', acompte:5, stripe:true }, creux:{ actif:false, pct:15, jours:'', plage:'' } } },
    { id:'s-lotus', nom:'Institut Lotus', metier:'esthetique', ville:'Bordeaux', plan:'studio', principal:false, slug:'demo-institut', stats:{ nb_clients:190, rdv_mois:97, rdv_7j:21, ca_mois:5260 },
      fiche:{ accroche:'Soins du visage, du corps et massages.', a_propos:'Un institut calme au cœur de Bordeaux : soins personnalisés, produits sélectionnés, cabines individuelles.',
        adresse:'18 cours de l\'Intendance, Bordeaux', horaires:{ ...base, jours:[2, 3, 4, 5, 6], debut:'10:00', fin:'19:00', whatsapp:'06 11 22 33 44' },
        equipe:[m('Inès', 'Esthéticienne, directrice', 'Soins visage et massages, 9 ans d\'expérience.'), m('Camille', 'Esthéticienne', 'Épilation, manucure et soins du corps.')],
        prestations:[p('Soin visage éclat', 60, 65, 'Visage'), p('Massage relaxant 60 min', 60, 75, 'Massage'), p('Épilation jambes complètes', 30, 30, 'Épilation'), p('Manucure semi-permanent', 45, 35, 'Mains')],
        paiement:{ mode:'carte', acompte:5, stripe:true }, creux:{ actif:false, pct:15, jours:'', plage:'' } } }
  ] };
}

let DB;
const charger = () => { try{ DB = JSON.parse(sessionStorage.getItem(CLE)); }catch(e){ DB = null; } if(!DB) DB = initial(); };
const sauver = () => { try{ sessionStorage.setItem(CLE, JSON.stringify(DB)); }catch(e){} };
export const reinitialiserDemoSalons = () => { try{ sessionStorage.removeItem(CLE); }catch(e){} };
export const salonParId = id => { charger(); return DB.salons.find(x => x.id === id) || null; };
// Modifie la fiche d'un salon (le mutateur reçoit la fiche) puis enregistre.
export function modifierFiche(id, mutateur){ charger(); const s = DB.salons.find(x => x.id === id); if(!s) return null; mutateur(s.fiche, s); sauver(); return s; }

export function creerFauxSupabase(){
  charger();
  const ok = data => Promise.resolve({ data, error:null });
  return {
    auth: { getSession:async () => ({ data:{ session:{ access_token:'demo', user:{ id:'u-demo' } } } }) },
    rpc: async (nom, a) => {
      charger();
      if(nom === 'mes_salons') return ok(DB.salons.map(x => ({ id:x.id, nom:x.nom, metier:x.metier, ville:x.ville, plan:x.plan, principal:x.principal, actif:x.id === DB.actif })));
      // L'équipe affichée dans le total est celle de la fiche du salon : une modification de l'équipe se retrouve dans les chiffres du groupe.
      if(nom === 'groupe_stats') return ok(DB.salons.map(x => ({ salon_id:x.id, nom:x.nom, ...x.stats, nb_equipe:x.fiche.equipe.length })));
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
  const id = 's-nouveau-' + (DB.n++), metier = corps.metier || 'coiffure';
  DB.salons.push({ id, nom, metier, ville:String(corps.ville || '').trim() || null, plan:'studio', principal:false, slug:null,
    stats:{ nb_clients:0, rdv_mois:0, rdv_7j:0, ca_mois:0 },
    fiche:{ accroche:'', a_propos:String(corps.description || '').trim().slice(0, 600), adresse:'', horaires:{ jours:[1, 2, 3, 4, 5], debut:'09:30', fin:'19:00', whatsapp:'' }, equipe:[],
      prestations:(CATALOGUE_TYPE[metier] || CATALOGUE_TYPE.autre).map(([libelle, duree, prix]) => ({ libelle, duree, prix, categorie:'', actif:true })),
      paiement:{ mode:'acompte', acompte:5, stripe:false }, creux:{ actif:false, pct:15, jours:'', plage:'' } } });
  sauver();
  return reponse(200, { id, nom });
}
