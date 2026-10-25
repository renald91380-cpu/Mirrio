// Mirrio — démonstration de l'univers Mariage (mon-mariage.html?demo=1, mariage-pro.html?demo=1, rsvp.html?demo=1).
//
// Une fausse base en mémoire (sessionStorage) partagée par les trois écrans : un prestataire qui répond depuis mariage-pro.html fait apparaître sa
// réponse chez les mariés, et la réponse d'un invité sur rsvp.html met à jour la liste des invités. Rien n'est envoyé au serveur.
// Mariage fictif : Sophie et Karim, dans environ sept mois, budget 24 000 €, 80 invités estimés.
const CLE = 'mirrio-demo-mariage-v1';
const jour = 86400000;
const isoJ = ms => new Date(ms).toISOString().slice(0, 10);

export const PROS_DEMO = [
  { slug:'demo-coiffure', nom:'Maison Éloïse', metier:'coiffure', ville:'Lyon', note_moyenne:'4.8', nb_avis:42, fiche:'pro.html?p=demo-coiffure' },
  { slug:'demo-institut', nom:'Institut Lotus', metier:'esthetique', ville:'Lyon', note_moyenne:'4.9', nb_avis:27, fiche:'pro.html?p=demo-institut' },
  { slug:'demo-barber', nom:'The Barber Club', metier:'barbier', ville:'Lyon', note_moyenne:'4.7', nb_avis:58, fiche:'pro.html?p=demo-barber' },
  { slug:'demo-patisserie', nom:'Maison Dorée', metier:'patisserie', ville:'Lyon', note_moyenne:'4.9', nb_avis:63, fiche:'commander.html?p=demo-patisserie' }
];

function initiale(){
  const t0 = Date.now(), m = 'm1', fin = t0 + 215 * jour;
  const lignes = (tab, rows) => rows.map((r, i) => ({ id:`${tab}-${i + 1}`, owner_id:'demo', mariage_id:m, created_at:new Date(t0 - (rows.length - i) * 3600000).toISOString(), ...r }));
  // [mois avant, titre, catégorie, fait]
  const tachesBrutes = [
    [12, 'Fixer le budget et le nombre d\'invités approximatif', 'general', true], [12, 'Choisir la date et la ville', 'general', true], [12, 'Réserver le lieu de réception', 'lieu', true],
    [11, 'Réserver le traiteur', 'traiteur', true], [11, 'Réserver le photographe et le vidéaste', 'photo', true], [9, 'Réserver le DJ ou le groupe', 'musique', false],
    [9, 'Choisir les tenues des mariés', 'tenues', true], [8, 'Réserver le fleuriste et la décoration', 'deco', false], [6, 'Envoyer les « save the date »', 'papeterie', false],
    [6, 'Réserver coiffure et maquillage, prévoir un essai', 'beaute', false], [5, 'Organiser le transport des mariés et des invités', 'transport', false],
    [4, 'Envoyer les faire-part', 'papeterie', false], [4, 'Constituer le dossier administratif (mairie ou équivalent)', 'admin', false],
    [3, 'Dégustation et menu définitif avec le traiteur', 'traiteur', false], [3, 'Commander la pièce montée ou le gâteau', 'gateau', false],
    [2, 'Essayages finaux des tenues', 'tenues', false], [1, 'Confirmer chaque prestataire par écrit', 'general', false], [1, 'Établir le plan de table', 'general', false],
    [1, 'Relancer les invités sans réponse', 'general', false]
  ];
  const taches = lignes('mariage_taches', tachesBrutes.map(([mois, titre, categorie, fait]) => {
    const d = new Date(fin); d.setMonth(d.getMonth() - mois);
    return { titre, categorie, echeance:isoJ(d.getTime()), fait, notes:null };
  }));
  const pct = [['Lieu de réception', 20, 5200, 1500, 'Domaine des Tilleuls'], ['Traiteur et boissons', 28, 6800, 2000, 'Saveurs & Co'], ['Photo et vidéo', 10, 1900, 500, 'Studio Lumière'], ['Musique et animation', 7, 0, 0, null],
    ['Fleurs et décoration', 8, 0, 0, null], ['Tenues', 10, 2300, 2300, 'Atelier Rivoli'], ['Coiffure et maquillage', 3, 0, 0, null], ['Gâteau ou pièce montée', 3, 650, 0, 'Maison Dorée'],
    ['Transport', 2, 0, 0, null], ['Faire-part et papeterie', 2, 180, 180, 'Imprimerie du Port'], ['Alliances', 3, 1100, 1100, 'Bijouterie Aurélie'], ['Imprévus', 4, 0, 0, null]];
  const budget = lignes('mariage_budget', pct.map(([poste, p, montant, paye, prestataire]) => ({ poste, prevu:Math.round(24000 * p / 100), montant, paye, prestataire, echeance_solde:montant > paye ? isoJ(fin - 45 * jour) : null, notes:null })));
  const noms = ['Famille Martin', 'Sophie Durand', 'Thomas Leroy', 'Camille Moreau', 'Lucas Petit', 'Famille Benali', 'Inès Haddad', 'Yanis Bouzid', 'Emma Roux', 'Hugo Fontaine', 'Léa Girard', 'Famille Dubois',
    'Nathan Lambert', 'Chloé Mercier', 'Antoine Rey', 'Manon Faure', 'Famille Nguyen', 'Julien Perrin', 'Sarah Cohen', 'Maxime Blanc', 'Laura Colin', 'Famille Garcia', 'Pierre Chevalier', 'Alice Marchand',
    'Romain Dupuis', 'Zoé Lefebvre', 'Famille Okafor', 'Victor Henry', 'Jade Clement', 'Paul Morin', 'Ines Barbier', 'Adam Meyer', 'Clara Noel', 'Famille Lopez', 'Mehdi Ait', 'Eva Schmitt'];
  const regimes = { 1:'Végétarienne', 5:'Halal', 6:'Sans gluten', 11:'Allergie aux fruits à coque', 16:'Végétalien', 19:'Allergie aux crustacés', 25:'Casher' };
  const invites = lignes('mariage_invites', noms.map((nom, i) => {
    const statut = i % 9 === 4 ? 'non' : (i % 3 === 0 || i % 5 === 1 ? 'attente' : 'oui');
    return { nom, groupe:['Famille', 'Amis', 'Collègues'][i % 3], email:null, statut, nb_personnes:nom.startsWith('Famille') ? 4 : (i % 4 === 0 ? 2 : 1),
      regime:statut === 'oui' ? (regimes[i] || null) : null, rsvp_token:'demo-inv-' + (i + 1) };
  }));
  const dem = (i, pro, statut, extra) => ({ id:'dem-' + i, mariage_id:m, owner_id:'demo', prestataire_id:'p-' + pro.slug, prestataire_nom:pro.nom, prestataire_slug:pro.slug,
    message:'Bonjour, nous nous marions le ' + new Date(fin).toLocaleDateString('fr-FR', { day:'numeric', month:'long', year:'numeric' }) + ' à Lyon et aimerions un devis. Pouvez-vous nous dire si vous êtes disponible ?', date_evenement:isoJ(fin), nb_invites:80, budget_indicatif:null,
    contact_nom:'Sophie et Karim', contact_email:'sophie.karim@exemple.fr', contact_telephone:null, statut, reponse:null, montant_propose:null, created_at:new Date(t0 - i * 2 * jour).toISOString(), ...extra });
  const demandes = [
    dem(1, PROS_DEMO[0], 'envoyee', {}),
    dem(2, PROS_DEMO[1], 'repondue', { reponse:'Félicitations ! Forfait mariée : essai maquillage, maquillage du jour J et retouches pendant la soirée. Je suis disponible à cette date.', montant_propose:240, repondu_le:new Date(t0 - jour).toISOString() }),
    dem(3, PROS_DEMO[2], 'indisponible', { reponse:'Je ne suis malheureusement pas disponible à cette date.', repondu_le:new Date(t0 - 3 * jour).toISOString() }),
    dem(4, PROS_DEMO[3], 'acceptee', { reponse:'Pièce montée de 80 parts, trois parfums au choix, livrée et installée le jour J.', montant_propose:650, repondu_le:new Date(t0 - 6 * jour).toISOString() })
  ];
  return { n:100, mariages:[{ id:m, owner_id:'demo', titre:'Mariage de Sophie et Karim', date_mariage:isoJ(fin), ville:'Lyon', budget_total:24000, nb_invites:80, created_at:new Date(t0).toISOString() }],
    mariage_taches:taches, mariage_budget:budget, mariage_invites:invites, mariage_demandes:demandes };
}

let DB;
const charger = () => { try{ DB = JSON.parse(sessionStorage.getItem(CLE)); }catch(e){ DB = null; } if(!DB) DB = initiale(); };
const sauver = () => { try{ sessionStorage.setItem(CLE, JSON.stringify(DB)); }catch(e){} };
export const reinitialiserDemoMariage = () => { try{ sessionStorage.removeItem(CLE); }catch(e){} };
export function premierJetonEnAttente(){ charger(); const i = DB.mariage_invites.find(x => x.statut === 'attente'); return i ? i.rsvp_token : 'demo-inv-1'; }

const DEFAUTS = { mariage_taches:{ fait:false, categorie:'general', echeance:null, notes:null }, mariage_budget:{ prevu:0, montant:0, paye:0, prestataire:null, echeance_solde:null, notes:null },
  mariage_invites:{ statut:'attente', nb_personnes:1, regime:null, email:null, groupe:null } };

function table(nom, filtreExtra){
  const fl = filtreExtra ? [filtreExtra] : [], tris = []; let mode = 'select', charge = null, unique = false, max = null;
  const b = {
    select(){ return b; }, eq(c, v){ fl.push(r => r[c] === v); return b; }, is(c, v){ fl.push(r => (r[c] ?? null) === v); return b; }, in(c, vs){ fl.push(r => vs.includes(r[c])); return b; },
    order(c, o){ tris.push([c, !(o && o.ascending === false)]); return b; }, limit(n){ max = n; return b; }, maybeSingle(){ unique = true; return b; }, single(){ unique = true; return b; },
    insert(p){ mode = 'insert'; charge = p; return b; }, update(p){ mode = 'update'; charge = p; return b; }, delete(){ mode = 'delete'; return b; },
    then(ok, ko){
      let res;
      if(mode === 'insert'){
        const l = (Array.isArray(charge) ? charge : [charge]).map(x => ({ id:'n-' + (DB.n++), owner_id:'demo', created_at:new Date().toISOString(), ...(DEFAUTS[nom] || {}), ...(nom === 'mariage_invites' ? { rsvp_token:'demo-inv-' + DB.n } : {}), ...x }));
        DB[nom].push(...l); res = { data:unique ? l[0] : l, error:null };
      } else if(mode === 'update'){ DB[nom].filter(r => fl.every(f => f(r))).forEach(r => Object.assign(r, charge)); res = { data:null, error:null }; }
      else if(mode === 'delete'){ DB[nom] = DB[nom].filter(r => !fl.every(f => f(r))); res = { data:null, error:null }; }
      else {
        let l = DB[nom].filter(r => fl.every(f => f(r)));
        if(tris.length) l = [...l].sort((x, y) => { for(const [c, asc] of tris){ const a = x[c] ?? null, z = y[c] ?? null; if(a === z) continue; if(a === null) return 1; if(z === null) return -1; return (a > z ? 1 : -1) * (asc ? 1 : -1); } return 0; });
        if(max) l = l.slice(0, max);
        res = { data:unique ? (l[0] || null) : l, error:null };
      }
      sauver(); return Promise.resolve(res).then(ok, ko);
    }
  };
  return b;
}

// Faux client : `role` = 'couple' (voit tout) ou 'pro' (voit les demandes adressées à Maison Éloïse et y répond).
export function creerFauxSupabase(role = 'couple'){
  charger();
  const pro = role === 'pro' ? r => r.prestataire_slug === 'demo-coiffure' : null;
  const ok = data => Promise.resolve({ data, error:null }), ko = message => Promise.resolve({ data:null, error:{ message } });
  return {
    from: nom => table(nom, nom === 'mariage_demandes' ? pro : null),
    auth: { getSession:async () => ({ data:{ session:{ access_token:'demo', user:{ id:'u-demo', email:'sophie.karim@exemple.fr', user_metadata:{ full_name:'Sophie et Karim' } } } } }), signOut:async () => {} },
    rpc: async (nom, a) => {
      if(nom === 'mariage_demander'){
        const p = PROS_DEMO.find(x => x.slug === a.p_slug); if(!p) return ko('Ce prestataire n\'accepte pas de demandes.');
        if(DB.mariage_demandes.some(d => d.prestataire_slug === p.slug && ['envoyee', 'repondue'].includes(d.statut))) return ko('Une demande est déjà en cours avec ce prestataire.');
        const id = 'dem-' + (DB.n++);
        DB.mariage_demandes.unshift({ id, mariage_id:a.p_mariage, owner_id:'demo', prestataire_id:'p-' + p.slug, prestataire_nom:p.nom, prestataire_slug:p.slug, message:a.p_message, date_evenement:a.p_date, nb_invites:a.p_nb,
          budget_indicatif:a.p_budget, contact_nom:a.p_nom, contact_email:a.p_email, contact_telephone:a.p_tel, statut:'envoyee', reponse:null, montant_propose:null, created_at:new Date().toISOString() });
        sauver(); return ok(id);
      }
      if(nom === 'mariage_repondre'){ const d = DB.mariage_demandes.find(x => x.id === a.p_demande); if(!d) return ko('Demande introuvable.'); Object.assign(d, { statut:a.p_statut, reponse:a.p_reponse, montant_propose:a.p_montant, repondu_le:new Date().toISOString() }); sauver(); return ok(null); }
      if(nom === 'mariage_decider'){ const d = DB.mariage_demandes.find(x => x.id === a.p_demande); if(!d) return ko('Demande introuvable.'); d.statut = a.p_statut; sauver(); return ok(null); }
      if(nom === 'rsvp_lire'){ const i = DB.mariage_invites.find(x => x.rsvp_token === a.p_token); const m = DB.mariages[0];
        return ok(i ? { invite:i.nom, statut:i.statut, nb_personnes:i.nb_personnes, regime:i.regime, titre:m.titre, date_mariage:m.date_mariage, ville:m.ville } : null); }
      if(nom === 'rsvp_repondre'){ const i = DB.mariage_invites.find(x => x.rsvp_token === a.p_token); if(!i) return ko('Invitation introuvable.');
        Object.assign(i, { statut:a.p_statut, nb_personnes:Math.max(1, Math.min(10, a.p_nb || 1)), regime:(a.p_regime || '').trim().slice(0, 300) || null, repondu_le:new Date().toISOString() }); sauver(); return ok(null); }
      return ok(null);
    }
  };
}

// Faux annuaire : même forme que /api/annuaire, filtré par texte, ville et métier.
export function annuaireDemo(params){
  const q = (params.get('q') || '').toLowerCase(), ville = (params.get('ville') || '').toLowerCase(), metier = params.get('metier') || '';
  return { praticiens: PROS_DEMO.filter(p => (!q || (p.nom + ' ' + p.metier).toLowerCase().includes(q)) && (!ville || p.ville.toLowerCase().includes(ville)) && (!metier || p.metier === metier)).map(p => ({ ...p, photos:[], latitude:null, longitude:null })) };
}
