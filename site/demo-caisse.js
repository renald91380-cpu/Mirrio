// Mirrio — démonstration de la caisse (caisse.html?demo=1) : une fausse base en mémoire, rien n'est envoyé au serveur.
//
// Réimplémente juste ce que caisse.html demande à Supabase (select / eq / is / in / order / limit / maybeSingle / single / insert / update / delete)
// sur quelques tables, avec le salon fictif Maison Éloïse (coiffure mixte, franchise de TVA). L'état survit au rechargement
// (sessionStorage) pour pouvoir présenter une journée entière ; `reinitialiserDemoCaisse()` remet tout à zéro.
const CLE = 'mirrio-demo-caisse-v2';
const WS = 'demo';

function donneesInitiales(){
  const p = (id, libelle, ht, categorie, position) => ({ id, owner_id:WS, libelle, prix_unitaire:ht, tva_taux:0, categorie, actif:true, position });
  return {
    n: 1,
    caisse_sessions: [{ id:'sess-demo', owner_id:WS, ouverte_le:new Date().toISOString(), fond_caisse:100, cloturee_le:null }],
    caisse_paiements: [], documents: [], document_lignes: [], caisse_tickets: [], caisse_journal: [],
    chaine: { seq:0, hash:'GENESIS', gt:0, gta:0, n_ticket:0, n_avoir:0, n_formation:0, n_z:0, cle:'cle-demo' },
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
    in(c, vs){ filtres.push(r => vs.includes(r[c])); return b; }, gte(c, v){ filtres.push(r => r[c] >= v); return b; }, order(c){ tri = c; return b; }, limit(n){ max = n; return b; },
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

// ---- Fonctions de caisse : mêmes règles que db/schema-v43-caisse-certifiable.sql (chaîne de hash, grands totaux, avoirs, duplicata, Z, vérification).
const enc = new TextEncoder();
const hex = buf => [...new Uint8Array(buf)].map(x => x.toString(16).padStart(2, '0')).join('');
const sha = async t => hex(await crypto.subtle.digest('SHA-256', enc.encode(t)));
const hmac = async (t, k) => hex(await crypto.subtle.sign('HMAC', await crypto.subtle.importKey('raw', enc.encode(k), { name:'HMAC', hash:'SHA-256' }, false, ['sign']), enc.encode(t)));
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
const fmt = n => r2(n || 0).toFixed(2);
const entree = (prev, seq, type, numero, montant, gt, gta, date, payload) => [prev, seq, type, numero || '', fmt(montant), fmt(gt), fmt(gta), date, JSON.stringify(payload || {})].join('|');
const echec = message => { throw new Error(message); };

async function ecrire(type, session, ticket, numero, montant, payload, gt){
  payload = JSON.parse(JSON.stringify(payload || {}));   // copie : le contenu scellé ne doit plus bouger ensuite
  const c = DB.chaine; c.seq++;
  if(gt && montant != null){ c.gt = r2(c.gt + montant); c.gta = r2(c.gta + Math.abs(montant)); }
  const date = new Date().toISOString(), h = await sha(entree(c.hash, c.seq, type, numero, montant, c.gt, c.gta, date, payload));
  const e = { id:'j' + c.seq, owner_id:WS, seq:c.seq, type, session_id:session, ticket_id:ticket, numero, montant_ttc:montant, payload:payload || {}, gt_perpetuel:c.gt, gt_absolu:c.gta,
    prev_hash:c.hash, hash:h, signature:await hmac(h, c.cle), created_at:date };
  c.hash = h; DB.caisse_journal.push(e); return e;
}
function totaux(lignes, neg){
  const assuj = !!DB.parametres_facturation[0].assujetti_tva;
  if(!Array.isArray(lignes) || !lignes.length || lignes.length > 100) echec('Le ticket doit contenir entre 1 et 100 lignes.');
  const norm = lignes.map((l, i) => {
    const q = Number(l.quantite), pu = Number(l.prix_unitaire) || 0, tx = assuj ? Number(l.tva_taux) || 0 : 0, d = String(l.description || '').trim().slice(0, 200);
    if(!d) echec(`Ligne ${i + 1}: libellé manquant.`);
    if(!q || Math.abs(q) > 10000 || (!neg && q < 0) || (neg && q > 0)) echec(`Ligne ${i + 1}: quantité invalide.`);
    if(pu < 0 || pu > 100000 || tx < 0 || tx > 30) echec(`Ligne ${i + 1}: prix ou TVA invalide.`);
    return { description:d, quantite:q, prix_unitaire:pu, tva_taux:tx, remise_pct:Number(l.remise_pct) || 0, index_origine:l.index_origine ?? null };
  });
  const par = new Map(); norm.forEach(l => par.set(l.tva_taux, (par.get(l.tva_taux) || 0) + l.quantite * l.prix_unitaire));
  const ventilation = [...par.entries()].sort((a, b) => a[0] - b[0]).map(([taux, base]) => ({ taux, base:r2(base), montant:r2(base * taux / 100) }));
  const ht = r2(ventilation.reduce((a, v) => a + v.base, 0)), tva = r2(ventilation.reduce((a, v) => a + v.montant, 0));
  return { lignes:norm, total_ht:ht, total_tva:tva, total_ttc:r2(ht + tva), ventilation, assujetti:assuj };
}
function paiements(p, cible){
  if(!Array.isArray(p) || !p.length || p.length > 6) echec('Indiquez au moins un moyen de paiement.');
  const out = p.map(x => {
    const m = r2(x.montant), r = x.recu == null ? null : Number(x.recu);
    if(!['especes', 'carte', 'cheque', 'virement', 'autre'].includes(x.mode)) echec('Moyen de paiement inconnu.');
    if(!(m > 0)) echec('Montant de paiement invalide.');
    if(x.mode === 'especes' && r != null && r < m) echec('Espèces reçues insuffisantes.');
    return { mode:x.mode, montant:m, recu:x.mode === 'especes' ? (r ?? m) : null };
  });
  const somme = r2(out.reduce((a, x) => a + x.montant, 0));
  if(Math.abs(somme - cible) > 0.011) echec(`Le total des paiements (${somme.toFixed(2)}) ne correspond pas au montant du ticket (${cible.toFixed(2)}).`);
  out[out.length - 1].montant = r2(out[out.length - 1].montant + cible - somme);
  return out;
}
const jsonTicket = (t, j, dup) => ({ ticket_id:t.id, numero:t.numero, type:t.type, formation:t.formation, date:t.date_ticket, client_nom:t.client_nom, lignes:t.lignes, total_ht:t.total_ht, total_tva:t.total_tva,
  total_ttc:t.total_ttc, ventilation:t.ventilation, paiements:t.paiements, assujetti:t.assujetti_tva, motif:t.motif, origine_numero:(DB.caisse_tickets.find(o => o.id === t.ticket_origine) || {}).numero || null,
  hash:t.journal_hash, signature:j.signature, gt_perpetuel:j.gt_perpetuel, duplicata:dup });
const sessionOuverte = id => DB.caisse_sessions.find(s => s.id === id && !s.cloturee_le);
function agregat(f){
  const tk = DB.caisse_tickets.filter(t => !t.formation && f(t)), somme = c => r2(tk.reduce((a, t) => a + t[c], 0)), par = {}, vent = new Map();
  tk.forEach(t => { t.paiements.forEach(p => { par[p.mode] = r2((par[p.mode] || 0) + (t.type === 'avoir' ? -p.montant : p.montant)); });
    t.ventilation.forEach(v => { const x = vent.get(v.taux) || { base:0, montant:0 }; x.base += v.base; x.montant += v.montant; vent.set(v.taux, x); }); });
  const ventes = tk.filter(t => t.type === 'vente').map(t => t.numero).sort();
  return { nb_ventes:ventes.length, nb_avoirs:tk.filter(t => t.type === 'avoir').length, total_ht:somme('total_ht'), total_tva:somme('total_tva'), total_ttc:somme('total_ttc'),
    premier_ticket:ventes[0] || null, dernier_ticket:ventes[ventes.length - 1] || null, par_mode:par,
    ventilation_tva:[...vent.entries()].sort((a, b) => a[0] - b[0]).map(([taux, x]) => ({ taux, base:r2(x.base), montant:r2(x.montant) })),
    nb_formation:DB.caisse_tickets.filter(t => t.formation && f(t)).length };
}
const FONCTIONS = {
  async caisse_ouvrir(a){
    if(!(a.p_fond >= 0)) echec('Fond de caisse invalide.');
    if(DB.caisse_sessions.some(s => !s.cloturee_le)) echec('Une caisse est déjà ouverte sur ce salon (unique).');
    const s = { id:'sess-' + (DB.n++), owner_id:WS, ouverte_le:new Date().toISOString(), fond_caisse:r2(a.p_fond), cloturee_le:null };
    DB.caisse_sessions.push(s); await ecrire('ouverture', s.id, null, null, null, { fond_caisse:s.fond_caisse }, false); return s;
  },
  async caisse_encaisser(a){
    if(!sessionOuverte(a.p_session)) echec('Aucune session de caisse ouverte.');
    const tot = totaux(a.p_lignes, false); if(tot.total_ttc <= 0) echec('Le total du ticket doit être positif.');
    const pay = paiements(a.p_paiements, tot.total_ttc), cl = DB.clients.find(c => c.id === a.p_client), formation = !!a.p_formation, c = DB.chaine, now = new Date();
    const numero = formation ? 'FORM-' + String(++c.n_formation).padStart(6, '0') : `T-${now.getFullYear()}-` + String(++c.n_ticket).padStart(6, '0');
    const id = 't' + (DB.n++);
    const j = await ecrire(formation ? 'formation' : 'vente', a.p_session, id, numero, tot.total_ttc, { nb_lignes:tot.lignes.length }, !formation);
    const t = { id, owner_id:WS, session_id:a.p_session, journal_seq:j.seq, journal_hash:j.hash, type:'vente', formation, numero, date_ticket:now.toISOString(), client_id:cl ? cl.id : null, client_nom:cl ? cl.full_name : null,
      lignes:tot.lignes, total_ht:tot.total_ht, total_tva:tot.total_tva, total_ttc:tot.total_ttc, ventilation:tot.ventilation, paiements:pay, assujetti_tva:tot.assujetti, ticket_origine:null, motif:null };
    DB.caisse_tickets.push(t); return jsonTicket(t, j, 0);
  },
  async caisse_avoir(a){
    const o = DB.caisse_tickets.find(t => t.id === a.p_ticket && t.type === 'vente' && !t.formation); if(!o) echec('Ticket introuvable.');
    const motif = String(a.p_motif || '').trim(); if(motif.length < 3) echec('Indiquez le motif de l\'avoir (3 à 200 caractères).');
    const sess = DB.caisse_sessions.find(s => !s.cloturee_le); if(!sess) echec('Aucune session de caisse ouverte.');
    const lignes = [];
    o.lignes.forEach((l, k) => {
      const i = k + 1, deja = DB.caisse_tickets.filter(x => x.ticket_origine === o.id).reduce((s, x) => s + x.lignes.filter(z => z.index_origine === i).reduce((q, z) => q + Math.abs(z.quantite), 0), 0), reste = l.quantite - deja;
      const dmd = a.p_selection ? Number((a.p_selection.find(z => z.index === i) || {}).quantite) || 0 : reste;
      if(dmd < 0 || dmd > reste) echec(`Ligne ${i}: on ne peut pas rembourser plus que ce qui reste (${reste}).`);
      if(dmd > 0) lignes.push({ ...l, quantite:-dmd, index_origine:i });
    });
    if(!lignes.length) echec('Rien à rembourser sur ce ticket.');
    const tot = totaux(lignes, true), pay = paiements([{ mode:a.p_paiements[0].mode, montant:-tot.total_ttc }], -tot.total_ttc), c = DB.chaine, now = new Date();
    const numero = `AV-${now.getFullYear()}-` + String(++c.n_avoir).padStart(6, '0'), id = 't' + (DB.n++);
    const j = await ecrire('avoir', sess.id, id, numero, tot.total_ttc, { ticket_origine:o.numero, motif }, true);
    const t = { id, owner_id:WS, session_id:sess.id, journal_seq:j.seq, journal_hash:j.hash, type:'avoir', formation:false, numero, date_ticket:now.toISOString(), client_id:o.client_id, client_nom:o.client_nom,
      lignes:tot.lignes, total_ht:tot.total_ht, total_tva:tot.total_tva, total_ttc:tot.total_ttc, ventilation:tot.ventilation, paiements:pay, assujetti_tva:tot.assujetti, ticket_origine:o.id, motif };
    DB.caisse_tickets.push(t); return jsonTicket(t, j, 0);
  },
  async caisse_duplicata(a){
    const t = DB.caisse_tickets.find(x => x.id === a.p_ticket); if(!t) echec('Ticket introuvable.');
    const n = DB.caisse_journal.filter(e => e.type === 'duplicata' && e.ticket_id === t.id).length + 1;
    await ecrire('duplicata', t.session_id, t.id, t.numero, null, { rang:n }, false);
    return jsonTicket(t, DB.caisse_journal.find(e => e.seq === t.journal_seq), n);
  },
  async caisse_cloturer(a){
    const s = sessionOuverte(a.p_session); if(!s) echec('Aucune session de caisse ouverte.');
    if(!(a.p_comptees >= 0)) echec('Comptez les espèces du tiroir avant de clôturer.');
    const agg = agregat(t => t.session_id === s.id), att = r2(s.fond_caisse + (agg.par_mode.especes || 0)), c = DB.chaine, maintenant = new Date().toISOString();
    const rapport = { ...agg, numero_z:'Z-' + String(++c.n_z).padStart(6, '0'), fond_caisse:s.fond_caisse, especes_attendues:att, especes_comptees:r2(a.p_comptees), ecart:r2(a.p_comptees - att),
      ouverte_le:s.ouverte_le, cloturee_le:maintenant, assujetti_tva:!!DB.parametres_facturation[0].assujetti_tva };
    const j = await ecrire('cloture_z', s.id, null, rapport.numero_z, agg.total_ttc, rapport, false);
    Object.assign(rapport, { gt_perpetuel:j.gt_perpetuel, gt_absolu:j.gt_absolu, journal_seq:j.seq, hash:j.hash, signature:j.signature });
    Object.assign(s, { cloturee_le:maintenant, especes_comptees:rapport.especes_comptees, ecart:rapport.ecart, rapport }); return rapport;
  },
  async caisse_cloturer_periode(a){
    const n = new Date(), fin = a.p_type === 'mensuelle' ? new Date(a.p_annee, a.p_mois, 1) : new Date(a.p_annee + 1, 0, 1);
    const per = a.p_type === 'mensuelle' ? a.p_annee + '-' + String(a.p_mois).padStart(2, '0') : String(a.p_annee);
    if(fin > n) echec(`La période ${per} n'est pas terminée.`);
    if(DB.caisse_journal.some(e => e.type === 'cloture_' + a.p_type && e.payload.periode === per)) echec(`La période ${per} est déjà clôturée.`);
    const debut = a.p_type === 'mensuelle' ? new Date(a.p_annee, a.p_mois - 1, 1) : new Date(a.p_annee, 0, 1);
    const agg = agregat(t => new Date(t.date_ticket) >= debut && new Date(t.date_ticket) < fin), payload = { ...agg, periode:per, type:a.p_type };
    const j = await ecrire('cloture_' + a.p_type, null, null, per, agg.total_ttc, payload, false);
    return { ...payload, gt_perpetuel:j.gt_perpetuel, journal_seq:j.seq, hash:j.hash, signature:j.signature };
  },
  async caisse_verifier(){
    let prev = 'GENESIS', gt = 0, gta = 0, defaut = null, attendu = 1;
    for(const e of DB.caisse_journal){
      if(e.seq !== attendu){ defaut = { seq:attendu, raison:'Entrée manquante dans la séquence' }; break; }
      if(e.prev_hash !== prev){ defaut = { seq:e.seq, raison:'La chaîne est rompue (empreinte précédente différente)' }; break; }
      if(e.type === 'vente' || e.type === 'avoir'){ gt = r2(gt + e.montant_ttc); gta = r2(gta + Math.abs(e.montant_ttc)); }
      if(e.gt_perpetuel !== gt || e.gt_absolu !== gta){ defaut = { seq:e.seq, raison:'Grand total incohérent' }; break; }
      const h = await sha(entree(e.prev_hash, e.seq, e.type, e.numero, e.montant_ttc, e.gt_perpetuel, e.gt_absolu, e.created_at, e.payload));
      if(h !== e.hash){ defaut = { seq:e.seq, raison:'Le contenu a été modifié (empreinte différente)' }; break; }
      prev = e.hash; attendu++;
    }
    return { ok:!defaut, entrees:DB.caisse_journal.length, defaut, gt_perpetuel:DB.chaine.gt, gt_absolu:DB.chaine.gta,
      tickets:DB.caisse_tickets.filter(t => t.type === 'vente' && !t.formation).length, avoirs:DB.caisse_tickets.filter(t => t.type === 'avoir').length };
  },
  async caisse_archiver(a){
    const d0 = new Date(a.p_debut + 'T00:00:00'), d1 = new Date(new Date(a.p_fin + 'T00:00:00').getTime() + 86400000);
    const corps = { format:'mirrio-caisse-archive-1', demo:true, debut:a.p_debut, fin:a.p_fin, verification:await FONCTIONS.caisse_verifier(),
      journal:DB.caisse_journal.filter(e => new Date(e.created_at) >= d0 && new Date(e.created_at) < d1), tickets:DB.caisse_tickets.filter(t => new Date(t.date_ticket) >= d0 && new Date(t.date_ticket) < d1) };
    return { ...corps, empreinte:await sha(JSON.stringify(corps)) };
  }
};

export function creerFauxSupabase(){
  charger();
  return {
    from: table,
    rpc: async (nom, args) => {
      charger();
      try{ const data = await FONCTIONS[nom](args || {}); enregistrer(); return { data, error:null }; }
      catch(e){ return { data:null, error:{ message:e.message } }; }
    },
    auth: { getSession: async () => ({ data:{ session:{ access_token:'demo', user:{ id:'u-demo' } } } }), getUser: async () => ({ data:{ user:{ id:'u-demo' } } }) }
  };
}
