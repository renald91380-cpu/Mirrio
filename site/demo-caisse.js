// Mirrio — démonstration de la caisse (caisse.html?demo=1) : une fausse base en mémoire, rien n'est envoyé au serveur.
//
// Réimplémente juste ce que caisse.html demande à Supabase (select / eq / is / in / order / limit / maybeSingle / single / insert / update / delete)
// sur quelques tables, avec le salon fictif Maison Éloïse (coiffure mixte, franchise de TVA). L'état survit au rechargement
// (sessionStorage) pour pouvoir présenter une journée entière ; `reinitialiserDemoCaisse()` remet tout à zéro.
const CLE = 'mirrio-demo-caisse-v1';
const WS = 'demo';

function donneesInitiales(){
  const p = (id, libelle, ht, categorie, position) => ({ id, owner_id:WS, libelle, prix_unitaire:ht, tva_taux:0, categorie, actif:true, position });
  return {
    n: 1,
    caisse_sessions: [{ id:'sess-demo', owner_id:WS, ouverte_le:new Date().toISOString(), fond_caisse:100, cloturee_le:null }],
    caisse_paiements: [], documents: [], document_lignes: [],
    clients: ['Marie Durand', 'Sophie Leroy', 'Karim Benali', 'Julien Martin', 'Emma Petit'].map((full_name, i) => ({ id:'c' + i, owner_id:WS, full_name })),
    prestations: [
      p('d1', 'Shampoing, coupe, brushing', 55, 'Femme', 1), p('d2', 'Coloration racines', 58, 'Femme', 2), p('d3', 'Balayage', 120, 'Femme', 3),
      p('d4', 'Brushing', 25, 'Femme', 4), p('d5', 'Chignon', 60, 'Femme', 5), p('d6', 'Lissage', 90, 'Femme', 6),
      p('d7', 'Coupe homme', 28, 'Homme', 7), p('d8', 'Barbe', 15, 'Homme', 8), p('d9', 'Coupe + barbe', 38, 'Homme', 9),
      p('d10', 'Soin profond', 20, 'Soins', 10), p('d11', 'Masque réparateur', 12, 'Soins', 11), p('d12', 'Soin du cuir chevelu', 18, 'Soins', 12)
    ],
    parametres_facturation: [{ owner_id:WS, assujetti_tva:false, tva_taux_defaut:20, emetteur_nom:'Maison Éloïse', emetteur_adresse:'12 rue de la République, 69002 Lyon' }]
  };
}

let DB;
function charger(){
  try{ DB = JSON.parse(sessionStorage.getItem(CLE)); }catch(e){ DB = null; }
  if(!DB) DB = donneesInitiales();
}
function enregistrer(){ try{ sessionStorage.setItem(CLE, JSON.stringify(DB)); }catch(e){} }
export function reinitialiserDemoCaisse(){ try{ sessionStorage.removeItem(CLE); }catch(e){} }

function table(nom){
  const filtres = []; let mode = 'select', charge = null, unique = false, tri = null, max = null;
  const b = {
    select(){ return b; }, eq(c, v){ filtres.push(r => r[c] === v); return b; }, is(c, v){ filtres.push(r => (r[c] ?? null) === v); return b; },
    in(c, vs){ filtres.push(r => vs.includes(r[c])); return b; }, order(c){ tri = c; return b; }, limit(n){ max = n; return b; },
    maybeSingle(){ unique = true; return b; }, single(){ unique = true; return b; },
    insert(p){ mode = 'insert'; charge = p; return b; }, update(p){ mode = 'update'; charge = p; return b; }, delete(){ mode = 'delete'; return b; },
    then(ok, ko){
      let res;
      if(mode === 'insert'){
        const lignes = (Array.isArray(charge) ? charge : [charge]).map(x => {
          const id = 'id-' + (DB.n++), maintenant = new Date().toISOString();
          const ligne = { id, created_at:maintenant, ...x };
          if(nom === 'documents') ligne.numero = 'FAC-' + new Date().getFullYear() + '-' + String(DB.documents.length + 1).padStart(3, '0');
          if(nom === 'caisse_sessions'){ ligne.ouverte_le = maintenant; ligne.cloturee_le = null; }
          return ligne;
        });
        if(nom === 'caisse_sessions' && DB.caisse_sessions.some(s => !s.cloturee_le)) res = { data:null, error:{ message:'duplicate key unique' } };
        else { DB[nom].push(...lignes); res = { data:unique ? lignes[0] : lignes, error:null }; }
      } else if(mode === 'update'){
        DB[nom].filter(r => filtres.every(f => f(r))).forEach(r => Object.assign(r, charge)); res = { data:null, error:null };
      } else if(mode === 'delete'){
        DB[nom] = DB[nom].filter(r => !filtres.every(f => f(r))); res = { data:null, error:null };
      } else {
        let l = DB[nom].filter(r => filtres.every(f => f(r)));
        if(tri) l = [...l].sort((x, y) => (x[tri] > y[tri] ? 1 : x[tri] < y[tri] ? -1 : 0));
        if(max) l = l.slice(0, max);
        res = { data: unique ? (l[0] || null) : l, error:null };
      }
      enregistrer();
      return Promise.resolve(res).then(ok, ko);
    }
  };
  return b;
}

export function creerFauxSupabase(){
  charger();
  return {
    from: table,
    auth: { getSession: async () => ({ data:{ session:{ access_token:'demo', user:{ id:'u-demo' } } } }), getUser: async () => ({ data:{ user:{ id:'u-demo' } } }) }
  };
}
