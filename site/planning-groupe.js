// Mirrio — planning du groupe : calendrier mensuel des salons (cochés ou décochés comme des agendas partagés), puis la journée choisie
// avec les disponibilités de chaque personne pour la prestation demandée, et l'ajout d'un rendez-vous pris au téléphone ou sur place.
// Module partagé par salons.html (vrai : RPC groupe_planning / groupe_ajouter_rdv / groupe_annuler_rdv) et sa démo (fausse base en mémoire) :
// il ne parle qu'à un « fournisseur » { charger(debut, fin), ajouter(r), annuler(id) }, jamais directement à Supabase.
//
// Forme attendue de charger() : { salons:[{ id, nom, ville, horaires:{ jours:[1..7, lundi = 1], debut:'09:30', fin:'19:00' },
//   equipe:[{ id, nom }], prestations:[{ id, libelle, duree }], rdv:[{ id, titre, debut, fin, intervenant_id, client, telephone }] }] }
const COULEURS = ['#E2A63D', '#3F7CAC', '#2E7D5B', '#B3402A', '#7A5BA6', '#C2577A', '#2B8A8A', '#8A6431', '#5E6AD2', '#6B8E23'];
const PAS = 15; // minutes entre deux débuts de créneau proposés
const MOIS = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
const JOURS_COURTS = ['Lun', 'Mar', 'Mer', 'Jeu', 'Ven', 'Sam', 'Dim'];
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const cle = d => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
const hhmm = d => `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
const minutes = t => { const [h, m] = String(t || '0:0').split(':'); return (+h) * 60 + (+m || 0); };
const jourIso = d => (d.getDay() + 6) % 7 + 1; // lundi = 1 … dimanche = 7
const debutJour = d => new Date(d.getFullYear(), d.getMonth(), d.getDate());
const ajouterJours = (d, n) => new Date(d.getFullYear(), d.getMonth(), d.getDate() + n);
const norm = s => String(s || '').trim().toLowerCase();

const CSS = `
.pg{ --pg-ligne:var(--line,rgba(16,18,22,.12)); }
.pg-haut{ display:flex; flex-wrap:wrap; gap:10px; align-items:center; justify-content:space-between; margin-bottom:12px; }
.pg-salons{ display:flex; flex-wrap:wrap; gap:8px; margin-bottom:14px; }
.pg-salons label{ display:inline-flex; align-items:center; gap:8px; min-height:44px; padding:0 14px; border:1px solid var(--pg-ligne); border-radius:99px; background:var(--surface,#fff); cursor:pointer; font-weight:600; font-size:14px; }
.pg-salons label.off{ opacity:.55; }
.pg-salons input{ position:absolute; opacity:0; pointer-events:none; }
.pg-salons .pastille{ width:14px; height:14px; border-radius:5px; border:2px solid var(--c); background:var(--c); flex:none; }
.pg-salons label.off .pastille{ background:transparent; }
.pg-salons label:focus-within{ outline:3px solid var(--accent,#E2A63D); outline-offset:2px; }
.pg-nav{ display:flex; align-items:center; gap:8px; }
.pg-nav h3{ margin:0; min-width:170px; text-align:center; font-size:20px; text-transform:capitalize; }
.pg-btn{ min-height:44px; padding:0 16px; border-radius:99px; border:1px solid var(--pg-ligne); background:var(--surface,#fff); color:inherit; font:600 14px inherit; font-family:inherit; cursor:pointer; }
.pg-btn.prin{ background:var(--accent,#E2A63D); color:var(--accent-ink,#101216); border-color:transparent; }
.pg-btn:focus-visible{ outline:3px solid var(--accent,#E2A63D); outline-offset:2px; }
.pg-mois{ display:grid; grid-template-columns:repeat(7,minmax(0,1fr)); gap:6px; }
.pg-entete{ font-size:12px; font-weight:600; text-transform:uppercase; letter-spacing:.04em; color:var(--muted,#5B606B); text-align:center; padding:4px 0; }
.pg-jour{ min-height:92px; padding:8px; border:1px solid var(--pg-ligne); border-radius:14px; background:var(--surface,#fff); text-align:left; cursor:pointer; color:inherit; font:inherit; display:flex; flex-direction:column; gap:6px; }
.pg-jour:hover{ border-color:var(--accent,#E2A63D); }
.pg-jour:focus-visible{ outline:3px solid var(--accent,#E2A63D); outline-offset:2px; }
.pg-jour.hors{ opacity:.4; }
.pg-jour.auj .num{ background:var(--accent,#E2A63D); color:var(--accent-ink,#101216); }
.pg-jour .num{ align-self:flex-start; min-width:26px; height:26px; border-radius:99px; display:grid; place-items:center; font-weight:700; font-size:13px; padding:0 6px; }
.pg-jour .barres{ display:flex; flex-direction:column; gap:3px; }
.pg-jour .barre{ display:flex; align-items:center; gap:5px; font-size:12px; font-weight:600; line-height:1.2; }
.pg-jour .barre i{ width:9px; height:9px; border-radius:3px; background:var(--c); flex:none; }
.pg-jour .barre.ferme{ color:var(--muted,#5B606B); font-weight:400; }
.pg-legende{ margin:12px 0 0; font-size:13px; color:var(--muted,#5B606B); }
.pg-presta{ display:flex; flex-wrap:wrap; gap:10px; align-items:end; margin:0 0 14px; padding:14px; border:1px solid var(--pg-ligne); border-radius:16px; background:var(--surface,#fff); }
.pg-presta label{ display:block; font-size:13px; font-weight:600; margin-bottom:4px; }
.pg-presta select,.pg-champ input,.pg-champ select,.pg-champ textarea{ min-height:44px; padding:0 12px; border:1px solid var(--pg-ligne); border-radius:12px; background:var(--bg,#fff); color:inherit; font:inherit; width:100%; box-sizing:border-box; }
.pg-champ textarea{ padding:10px 12px; min-height:70px; }
.pg-salon-jour{ margin:0 0 18px; border:1px solid var(--pg-ligne); border-radius:18px; background:var(--surface,#fff); overflow:hidden; }
.pg-salon-jour > h4{ margin:0; padding:12px 16px; display:flex; gap:10px; align-items:center; border-bottom:1px solid var(--pg-ligne); font-size:16px; }
.pg-salon-jour > h4 i{ width:12px; height:12px; border-radius:4px; background:var(--c); }
.pg-salon-jour > h4 small{ font-weight:400; color:var(--muted,#5B606B); }
.pg-pers{ padding:12px 16px; border-bottom:1px solid var(--pg-ligne); }
.pg-pers:last-child{ border-bottom:0; }
.pg-pers b{ display:block; margin-bottom:8px; }
.pg-creneaux{ display:flex; flex-wrap:wrap; gap:6px; }
.pg-creneaux button{ min-height:40px; padding:0 12px; border-radius:99px; border:1px solid var(--c); background:transparent; color:inherit; font:600 14px inherit; font-family:inherit; cursor:pointer; }
.pg-creneaux button:hover{ background:var(--c); color:#fff; }
.pg-creneaux button:focus-visible{ outline:3px solid var(--accent,#E2A63D); outline-offset:2px; }
.pg-rdvs{ margin:10px 0 0; padding:0; list-style:none; display:grid; gap:4px; font-size:13px; color:var(--muted,#5B606B); }
.pg-rdvs button{ border:0; background:none; padding:2px 0; font:inherit; color:inherit; cursor:pointer; text-align:left; text-decoration:underline dotted; }
.pg-vide{ color:var(--muted,#5B606B); font-size:14px; margin:0; }
.pg-champ{ margin:0 0 12px; } .pg-champ label{ display:block; font-size:13px; font-weight:600; margin-bottom:4px; }
.pg-dlg{ border:none; border-radius:24px; padding:24px; width:min(480px,calc(100vw - 24px)); background:var(--surface,#fff); color:var(--ink,#101216); box-shadow:0 30px 80px -20px rgba(0,0,0,.5); }
.pg-dlg::backdrop{ background:rgba(8,10,14,.55); }
.pg-dlg h3{ margin:0 0 4px; } .pg-dlg .sous{ margin:0 0 14px; color:var(--muted,#5B606B); font-size:14px; }
.pg-dlg .pg-erreur{ color:var(--alerte,#B3402A); font-size:14px; margin:0 0 10px; }
.pg-dlg .acts{ display:flex; gap:10px; justify-content:flex-end; flex-wrap:wrap; margin-top:6px; }
@media (max-width:640px){ .pg-jour{ min-height:64px; padding:5px; } .pg-jour .barre span{ display:none; } .pg-nav h3{ min-width:0; font-size:17px; } }
`;

export function monterPlanning(zone, fournisseur, options = {}){
  if(!document.getElementById('pg-css')){ const s = document.createElement('style'); s.id = 'pg-css'; s.textContent = CSS; document.head.appendChild(s); }
  const notifier = options.notifier || (() => {});
  let mois = debutJour(new Date()); mois.setDate(1);
  let jour = null;                  // null = vue mensuelle ; sinon la journée ouverte
  let donnees = [];                 // salons chargés pour la période affichée
  let decoches = new Set();         // salons masqués (Outlook : on coche / décoche un agenda)
  let prestaChoisie = '';           // libellé demandé (« type de prestation »), '' = toutes
  let cache = new Map();            // clé de période → salons

  const couleur = id => COULEURS[Math.max(0, donnees.findIndex(s => s.id === id)) % COULEURS.length];
  const visibles = () => donnees.filter(s => !decoches.has(s.id));

  async function recharger(){
    const debut = ajouterJours(mois, -((jourIso(mois) - 1) + 0)), fin = ajouterJours(debut, 42);
    zone.setAttribute('aria-busy', 'true');
    try{
      const r = await fournisseur.charger(debut, fin);
      donnees = (r && r.salons) || [];
      for(const s of donnees){ s.rdv = (s.rdv || []).map(x => ({ ...x, d: new Date(x.debut), f: new Date(x.fin) })); }
      dessiner();
    }catch(e){
      zone.innerHTML = `<div class="pg"><p class="pg-vide">Impossible de charger le planning (${esc(e && e.message || e)}). ${options.aideErreur || ''}</p></div>`;
    }finally{ zone.removeAttribute('aria-busy'); }
  }

  // ---------- disponibilités ----------
  function dureePour(salon, libelle){
    if(!libelle) return null;
    const p = salon.prestations.find(x => norm(x.libelle) === norm(libelle));
    return p ? p.duree : undefined; // undefined = ce salon ne propose pas cette prestation
  }
  function creneauxLibres(salon, personne, jr, duree){
    const h = salon.horaires; if(!h || !(h.jours || []).includes(jourIso(jr))) return [];
    const ouv = minutes(h.debut), clo = minutes(h.fin), base = debutJour(jr).getTime(), res = [];
    const pris = salon.rdv.filter(r => cle(r.d) === cle(jr) && (!personne || r.intervenant_id == null || r.intervenant_id === personne.id));
    const maintenant = Date.now();
    for(let m = ouv; m + duree <= clo; m += PAS){
      const d = base + m * 60000, f = d + duree * 60000;
      if(d < maintenant) continue;
      if(pris.some(r => r.d.getTime() < f && r.f.getTime() > d)) continue;
      res.push(m);
    }
    return res;
  }

  // ---------- vue mensuelle ----------
  function dessinerMois(){
    const debut = ajouterJours(mois, -(jourIso(mois) - 1)), auj = cle(new Date()), vis = visibles();
    let cases = '';
    for(let i = 0; i < 42; i++){
      const d = ajouterJours(debut, i); if(i >= 35 && d.getMonth() !== mois.getMonth()) break;
      const barres = vis.map(s => {
        const ouvert = ((s.horaires && s.horaires.jours) || []).includes(jourIso(d));
        const n = s.rdv.filter(r => cle(r.d) === cle(d)).length;
        if(!ouvert && !n) return '';
        return `<div class="barre${ouvert ? '' : ' ferme'}" style="--c:${couleur(s.id)}"><i></i><span>${ouvert ? `${n} rdv` : 'fermé'}</span>${n && !ouvert ? '' : ''}</div>`;
      }).join('');
      const totalRdv = vis.reduce((a, s) => a + s.rdv.filter(r => cle(r.d) === cle(d)).length, 0);
      cases += `<button type="button" class="pg-jour${d.getMonth() !== mois.getMonth() ? ' hors' : ''}${cle(d) === auj ? ' auj' : ''}" data-j="${cle(d)}"
        aria-label="${JOURS_COURTS[jourIso(d) - 1]} ${d.getDate()} ${MOIS[d.getMonth()]} : ${totalRdv} rendez-vous"><span class="num">${d.getDate()}</span><span class="barres">${barres}</span></button>`;
    }
    return `<div class="pg-mois" role="group" aria-label="Mois de ${MOIS[mois.getMonth()]} ${mois.getFullYear()}">${JOURS_COURTS.map(j => `<div class="pg-entete">${j}</div>`).join('')}${cases}</div>
      <p class="pg-legende">Chaque couleur est un salon. Touchez un jour pour voir la journée et les disponibilités de chaque personne.</p>`;
  }

  // ---------- vue journée ----------
  function dessinerJournee(){
    const vis = visibles();
    const libelles = [...new Map(donnees.flatMap(s => s.prestations).map(p => [norm(p.libelle), p.libelle])).values()].sort((a, b) => a.localeCompare(b, 'fr'));
    let html = `<div class="pg-presta"><div><label for="pg-presta">Prestation demandée</label>
      <select id="pg-presta"><option value="">Toutes (créneau de 30 min)</option>${libelles.map(l => `<option${norm(l) === norm(prestaChoisie) ? ' selected' : ''}>${esc(l)}</option>`).join('')}</select></div>
      <p class="pg-vide" style="flex:1;min-width:200px">Les créneaux affichés tiennent compte de la durée de cette prestation dans chaque salon, des horaires et des rendez-vous déjà pris de chaque personne.</p></div>`;
    if(!vis.length) html += '<p class="pg-vide">Aucun salon coché : cochez au moins un salon ci-dessus.</p>';
    for(const s of vis){
      const duree = dureePour(s, prestaChoisie);
      const ouvert = ((s.horaires && s.horaires.jours) || []).includes(jourIso(jour));
      const rdvJour = s.rdv.filter(r => cle(r.d) === cle(jour));
      html += `<section class="pg-salon-jour" style="--c:${couleur(s.id)}"><h4><i></i>${esc(s.nom)} <small>${esc(s.ville || '')}${ouvert ? ` · ouvert ${esc(s.horaires.debut.slice(0, 5))} - ${esc(s.horaires.fin.slice(0, 5))}` : ' · fermé ce jour'}</small></h4>`;
      if(duree === undefined) html += `<div class="pg-pers"><p class="pg-vide">Ce salon ne propose pas « ${esc(prestaChoisie)} ».</p></div>`;
      else if(!ouvert) html += '<div class="pg-pers"><p class="pg-vide">Fermé ce jour-là.</p></div>';
      else {
        const d = duree || 30, pers = s.equipe.length ? s.equipe : [{ id:null, nom:'Salon' }];
        html += pers.map(p => {
          const libres = creneauxLibres(s, s.equipe.length ? p : null, jour, d);
          return `<div class="pg-pers"><b>${esc(p.nom)} <span class="pg-vide" style="display:inline">· ${libres.length ? `${libres.length} créneaux de ${d} min` : 'complet'}</span></b>
            <div class="pg-creneaux">${libres.length ? libres.map(m => `<button type="button" data-ajout="${esc(s.id)}" data-p="${esc(p.id == null ? '' : p.id)}" data-m="${m}" data-d="${d}">${String(Math.floor(m / 60)).padStart(2, '0')}:${String(m % 60).padStart(2, '0')}</button>`).join('') : '<span class="pg-vide">Aucun créneau libre.</span>'}</div></div>`;
        }).join('');
      }
      if(rdvJour.length) html += `<div class="pg-pers"><b>Déjà au planning (${rdvJour.length})</b><ul class="pg-rdvs">${rdvJour.map(r => {
        const qui = (s.equipe.find(e => e.id === r.intervenant_id) || {}).nom;
        return `<li><button type="button" data-annuler="${esc(r.id)}" title="Annuler ce rendez-vous">${hhmm(r.d)} - ${hhmm(r.f)} · ${esc(r.client || r.titre || 'Rendez-vous')}${r.titre && r.client ? ` (${esc(r.titre)})` : ''}${qui ? ` · ${esc(qui)}` : ''}</button></li>`;
      }).join('')}</ul></div>`;
      html += '</section>';
    }
    return html;
  }

  function dessiner(){
    const titre = jour
      ? `${JOURS_COURTS[jourIso(jour) - 1]} ${jour.getDate()} ${MOIS[jour.getMonth()]} ${jour.getFullYear()}`
      : `${MOIS[mois.getMonth()]} ${mois.getFullYear()}`;
    zone.innerHTML = `<div class="pg">
      <div class="pg-salons" role="group" aria-label="Salons affichés dans le calendrier">${donnees.map(s => `<label class="${decoches.has(s.id) ? 'off' : ''}" style="--c:${couleur(s.id)}"><input type="checkbox" data-salon="${esc(s.id)}"${decoches.has(s.id) ? '' : ' checked'}><span class="pastille"></span>${esc(s.nom)}</label>`).join('')}</div>
      <div class="pg-haut"><div class="pg-nav">
        ${jour ? '<button type="button" class="pg-btn" data-nav="mois">← Mois</button>' : ''}
        <button type="button" class="pg-btn" data-nav="prec" aria-label="${jour ? 'Jour précédent' : 'Mois précédent'}">‹</button>
        <h3 aria-live="polite">${titre}</h3>
        <button type="button" class="pg-btn" data-nav="suiv" aria-label="${jour ? 'Jour suivant' : 'Mois suivant'}">›</button>
        <button type="button" class="pg-btn" data-nav="auj">Aujourd'hui</button></div>
        <button type="button" class="pg-btn prin" data-ajout-libre>Ajouter un rendez-vous</button></div>
      ${jour ? dessinerJournee() : dessinerMois()}</div>`;
    brancher();
  }

  function brancher(){
    zone.querySelectorAll('[data-salon]').forEach(c => c.onchange = () => { c.checked ? decoches.delete(c.dataset.salon) : decoches.add(c.dataset.salon); dessiner(); });
    zone.querySelectorAll('[data-j]').forEach(b => b.onclick = () => { const [a, m, j] = b.dataset.j.split('-').map(Number); jour = new Date(a, m - 1, j); dessiner(); window.scrollTo({ top:zone.getBoundingClientRect().top + scrollY - 70, behavior:'smooth' }); });
    zone.querySelectorAll('[data-nav]').forEach(b => b.onclick = async () => {
      const a = b.dataset.nav;
      if(a === 'mois'){ jour = null; dessiner(); return; }
      const avant = mois.getTime();
      if(a === 'auj'){ jour = jour ? debutJour(new Date()) : null; mois = debutJour(new Date()); mois.setDate(1); }
      else if(jour){ jour = ajouterJours(jour, a === 'prec' ? -1 : 1); mois = new Date(jour.getFullYear(), jour.getMonth(), 1); }
      else mois = new Date(mois.getFullYear(), mois.getMonth() + (a === 'prec' ? -1 : 1), 1);
      if(mois.getTime() !== avant || a === 'auj') await recharger(); else dessiner();
    });
    const sel = zone.querySelector('#pg-presta'); if(sel) sel.onchange = () => { prestaChoisie = sel.value; dessiner(); };
    zone.querySelectorAll('[data-ajout]').forEach(b => b.onclick = () => ouvrirFormulaire({ salon:b.dataset.ajout, personne:b.dataset.p, minute:+b.dataset.m, duree:+b.dataset.d }));
    const libre = zone.querySelector('[data-ajout-libre]'); if(libre) libre.onclick = () => ouvrirFormulaire({});
    zone.querySelectorAll('[data-annuler]').forEach(b => b.onclick = () => annulerRdv(b.dataset.annuler));
  }

  // ---------- ajout / annulation ----------
  function ouvrirFormulaire(init){
    const choix = visibles(); if(!choix.length){ notifier('Cochez d\'abord un salon.'); return; }
    const salonInit = choix.find(s => s.id === init.salon) || choix[0];
    const jr = jour || debutJour(new Date());
    const dlg = document.createElement('dialog'); dlg.className = 'pg-dlg'; dlg.setAttribute('aria-labelledby', 'pg-dt');
    const optsPrestas = s => `<option value="">Rendez-vous (sans prestation)</option>${s.prestations.map(p => `<option value="${esc(p.id)}" data-d="${p.duree}"${norm(p.libelle) === norm(prestaChoisie) ? ' selected' : ''}>${esc(p.libelle)} (${p.duree} min)</option>`).join('')}`;
    const optsPers = s => `<option value="">Non attribué</option>${s.equipe.map(e => `<option value="${esc(e.id)}"${String(e.id) === String(init.personne) ? ' selected' : ''}>${esc(e.nom)}</option>`).join('')}`;
    dlg.innerHTML = `<form method="dialog" novalidate><h3 id="pg-dt">Ajouter un rendez-vous</h3><p class="sous">Client venu sur place ou au téléphone.</p>
      <p class="pg-erreur" role="alert" hidden></p>
      <div class="pg-champ"><label for="pg-s">Salon</label><select id="pg-s">${choix.map(s => `<option value="${esc(s.id)}"${s.id === salonInit.id ? ' selected' : ''}>${esc(s.nom)}</option>`).join('')}</select></div>
      <div class="pg-champ"><label for="pg-pr">Prestation</label><select id="pg-pr">${optsPrestas(salonInit)}</select></div>
      <div class="pg-champ"><label for="pg-pe">Avec</label><select id="pg-pe">${optsPers(salonInit)}</select></div>
      <div style="display:grid;grid-template-columns:1fr 1fr 1fr;gap:10px">
        <div class="pg-champ"><label for="pg-d">Jour</label><input id="pg-d" type="date" value="${cle(jr)}"></div>
        <div class="pg-champ"><label for="pg-h">Heure</label><input id="pg-h" type="time" step="900" value="${init.minute != null ? `${String(Math.floor(init.minute / 60)).padStart(2, '0')}:${String(init.minute % 60).padStart(2, '0')}` : '10:00'}"></div>
        <div class="pg-champ"><label for="pg-du">Durée (min)</label><input id="pg-du" type="number" min="5" max="480" step="5" value="${init.duree || 30}"></div></div>
      <div class="pg-champ"><label for="pg-n">Nom du client</label><input id="pg-n" type="text" maxlength="80" autocomplete="off"></div>
      <div class="pg-champ"><label for="pg-t">Téléphone (facultatif)</label><input id="pg-t" type="tel" maxlength="30" inputmode="tel" autocomplete="off"></div>
      <div class="pg-champ"><label for="pg-no">Note (facultatif)</label><textarea id="pg-no" maxlength="300"></textarea></div>
      <div class="acts"><button type="button" class="pg-btn" data-x>Annuler</button><button type="submit" class="pg-btn prin">Ajouter au planning</button></div></form>`;
    document.body.appendChild(dlg);
    const $d = s => dlg.querySelector(s), err = $d('.pg-erreur');
    const salon = () => choix.find(s => s.id === $d('#pg-s').value);
    $d('#pg-s').onchange = () => { $d('#pg-pr').innerHTML = optsPrestas(salon()); $d('#pg-pe').innerHTML = optsPers(salon()); majDuree(); };
    function majDuree(){ const o = $d('#pg-pr').selectedOptions[0]; if(o && o.dataset.d) $d('#pg-du').value = o.dataset.d; }
    $d('#pg-pr').onchange = majDuree; if(init.duree == null) majDuree();
    const fermer = () => { dlg.close(); dlg.remove(); };
    $d('[data-x]').onclick = fermer; dlg.addEventListener('cancel', () => dlg.remove());
    $d('form').onsubmit = async e => {
      e.preventDefault(); err.hidden = true;
      const s = salon(), [a, m, j] = $d('#pg-d').value.split('-').map(Number), [h, mi] = ($d('#pg-h').value || '').split(':').map(Number), du = +$d('#pg-du').value;
      const nom = $d('#pg-n').value.trim();
      const montrer = t => { err.textContent = t; err.hidden = false; };
      if(!a || isNaN(h)) return montrer('Choisissez un jour et une heure.');
      if(!(du >= 5)) return montrer('Indiquez une durée d\'au moins 5 minutes.');
      if(!nom) return montrer('Indiquez le nom du client.');
      const debut = new Date(a, m - 1, j, h, mi), fin = new Date(debut.getTime() + du * 60000);
      const prest = s.prestations.find(p => String(p.id) === $d('#pg-pr').value);
      const envoi = forcer => fournisseur.ajouter({ salon:s.id, debut, fin, titre:prest ? prest.libelle : 'Rendez-vous', prestation:prest ? prest.id : null,
        intervenant:$d('#pg-pe').value || null, client:nom, telephone:$d('#pg-t').value.trim() || null, notes:$d('#pg-no').value.trim() || null, forcer });
      try{
        try{ await envoi(false); }
        catch(x){
          if(!/chevauche/i.test(x && x.message || '')) throw x;
          if(!confirm('Ce créneau chevauche un autre rendez-vous de cette personne. Ajouter quand même ?')) return;
          await envoi(true);
        }
        fermer(); notifier(`Rendez-vous ajouté chez ${s.nom}.`); jour = debutJour(debut); mois = new Date(a, m - 1, 1); await recharger();
      }catch(x){ montrer((x && x.message) || 'Ajout impossible.'); }
    };
    dlg.showModal(); $d('#pg-n').focus();
  }

  async function annulerRdv(id){
    const s = donnees.find(x => x.rdv.some(r => r.id === id)), r = s && s.rdv.find(x => x.id === id); if(!r) return;
    if(!confirm(`Annuler le rendez-vous de ${r.client || r.titre || 'ce client'} à ${hhmm(r.d)} chez ${s.nom} ?`)) return;
    try{ await fournisseur.annuler(id); notifier('Rendez-vous annulé.'); await recharger(); }
    catch(e){ notifier((e && e.message) || 'Annulation impossible.'); }
  }

  recharger();
  return { recharger };
}
