/* Mirrio — traduction du site (français, anglais, néerlandais de Belgique, darija en écriture arabe) et sélecteur de drapeau.
 *
 * Principe : le FRANÇAIS reste la langue d'écriture des pages. Chaque texte français a ses traductions dans des fichiers JSON {"texte français": ["en", "nl", "ar"]} :
 *   /i18n/commun.json (bandeau cookies, sélecteur…) puis un fichier par page, nommé dans l'attribut de la balise : <script src="/i18n.js" data-pages="fidelite"></script>.
 * Le script traduit le texte déjà présent, les attributs (placeholder, title, aria-label, alt, content des méta description) ET tout ce que la page ajoute ensuite
 * (MutationObserver). Un texte qui varie s'écrit avec des trous : "Encore {0} points" (la clé française garde les trous, la traduction aussi).
 * Dans le code d'une page : I18N.t('Encore {0} points', n) pour les textes assemblés en JavaScript.
 * Un texte sans traduction reste en français (jamais de page cassée). `translate="no"` ou la classe `notranslate` protège un élément.
 *
 * Deux choix indépendants, mémorisés sur l'appareil (stockage nécessaire, pas de traceur) :
 *   la LANGUE (mirrio-lang) et le PAYS (mirrio-pays : FR, BE, CH, MA) qui règle la monnaie et la TVA via site/pays-profils.js.
 * Pour un salon connecté, le pays vient de ses réglages (parametres_facturation.profil_pays) : le drapeau l'affiche, il se change dans Paramètres.
 * Darija : écriture arabe, de droite à gauche (dir="rtl", police Noto Sans Arabic chargée seulement dans cette langue).
 */
(function(){
  'use strict';
  var LANGUES = {
    fr: { nom:'Français', court:'FR', locale:'fr-FR', dir:'ltr', i:-1 },
    en: { nom:'English', court:'EN', locale:'en-GB', dir:'ltr', i:0 },
    nl: { nom:'Nederlands (Vlaams)', court:'NL', locale:'nl-BE', dir:'ltr', i:1 },
    ar: { nom:'الدارجة (المغرب)', court:'AR', locale:'ar-MA', dir:'rtl', i:2 }
  };
  var PAYS = {
    FR: { drapeau:'🇫🇷', nom:{ fr:'France', en:'France', nl:'Frankrijk', ar:'فرنسا' }, devise:'EUR', langue:'fr' },
    BE: { drapeau:'🇧🇪', nom:{ fr:'Belgique', en:'Belgium', nl:'België', ar:'بلجيكا' }, devise:'EUR', langue:'nl' },
    CH: { drapeau:'🇨🇭', nom:{ fr:'Suisse', en:'Switzerland', nl:'Zwitserland', ar:'سويسرا' }, devise:'CHF', langue:'fr' },
    MA: { drapeau:'🇲🇦', nom:{ fr:'Maroc', en:'Morocco', nl:'Marokko', ar:'المغرب' }, devise:'MAD', langue:'ar' }
  };
  var CLE_LANGUE = 'mirrio-lang', CLE_PAYS = 'mirrio-pays';
  var racine = document.documentElement;
  var script = document.currentScript;
  var pages = ((script && script.getAttribute('data-pages')) || '').split(',').map(function(s){ return s.trim(); }).filter(Boolean);
  var sansSelecteur = script && script.hasAttribute('data-sans-selecteur');

  function lire(k){ try{ return localStorage.getItem(k); }catch(e){ return null; } }
  function ecrire(k, v){ try{ localStorage.setItem(k, v); }catch(e){} }
  function detecterLangue(){
    var q = new URLSearchParams(location.search).get('lang');
    if(q && LANGUES[q]){ ecrire(CLE_LANGUE, q); return q; }
    var m = lire(CLE_LANGUE); if(m && LANGUES[m]) return m;
    var nav = (navigator.languages || [navigator.language || 'fr']).map(function(l){ return String(l).slice(0, 2).toLowerCase(); });
    for(var i = 0; i < nav.length; i++){ if(LANGUES[nav[i]]) return nav[i]; }
    return 'fr';
  }
  function detecterPays(){
    var q = new URLSearchParams(location.search).get('pays');
    if(q && PAYS[q.toUpperCase()]){ ecrire(CLE_PAYS, q.toUpperCase()); return q.toUpperCase(); }
    var m = lire(CLE_PAYS); if(m && PAYS[m]) return m;
    return 'FR';
  }

  var etat = { langue: detecterLangue(), pays: detecterPays(), exact: {}, trous: {}, motifs: [], ecouteurs: [] };
  var echapper = function(s){ return s.replace(/[.*+?^$()|[\]\\]/g, '\\$&'); };
  var normaliser = function(s){ return String(s).replace(/\s+/g, ' ').trim(); };

  // --------------------------------------------------------------------------------------- dictionnaire
  function ajouterDico(d){
    Object.keys(d).forEach(function(cle){
      var k = normaliser(cle), v = d[cle];
      if(!Array.isArray(v)) return;
      if(/\{\d+\}/.test(k)){
        var ordre = [], src = echapper(k).replace(/\{(\d+)\}/g, function(_, n){ ordre.push(+n); return '(.+?)'; });
        etat.motifs.push({ re: new RegExp('^' + src + '$'), ordre: ordre, tr: v }); etat.trous[k] = v;
      } else etat.exact[k] = v;
    });
  }
  function remplir(modele, valeurs){ return modele.replace(/\{(\d+)\}/g, function(_, n){ return valeurs[+n] == null ? '' : valeurs[+n]; }); }
  function chercher(fr, langue){
    var L = LANGUES[langue]; if(!L || L.i < 0) return null;
    var k = normaliser(fr); if(!k) return null;
    var e = etat.exact[k]; if(e && e[L.i]) return e[L.i];
    for(var i = 0; i < etat.motifs.length; i++){
      var m = etat.motifs[i], r = m.re.exec(k);
      if(r && m.tr[L.i]){ var vals = []; m.ordre.forEach(function(n, j){ vals[n] = r[j + 1]; }); return remplir(m.tr[L.i], vals); }
    }
    return null;
  }
  // Traduction d'un texte assemblé dans le code : t('Encore {0} points', 38). La clé est le texte français, trous compris.
  function t(fr){
    var args = Array.prototype.slice.call(arguments, 1), k = normaliser(fr), L = LANGUES[etat.langue], tpl = fr;
    if(L.i >= 0){ var v = etat.exact[k] || etat.trous[k]; if(v && v[L.i]) tpl = v[L.i]; }
    return remplir(tpl, args);
  }

  // --------------------------------------------------------------------------------------- traduction du DOM
  var ATTRS = ['placeholder', 'title', 'aria-label', 'alt'];
  var IGNORES = { SCRIPT:1, STYLE:1, NOSCRIPT:1, TEXTAREA:1, CODE:1, PRE:1, OPTION_VALUE:1 };
  var protege = function(el){ return el && el.closest && el.closest('[translate="no"], .notranslate, [data-i18n-ignore]'); };

  function traiterTexte(n){
    var p = n.parentNode; if(!p || IGNORES[p.nodeName] || protege(p)) return;
    if(n.__tr === undefined || n.data !== n.__tr){ n.__fr = n.data; }
    var fr = n.__fr, cible = fr;
    if(etat.langue !== 'fr'){ var tr = chercher(fr, etat.langue); if(tr){ var g = /^\s*/.exec(fr)[0], d = /\s*$/.exec(fr)[0]; cible = g + tr + d; } }
    if(n.data !== cible) n.data = cible;
    n.__tr = cible;
  }
  function traiterAttrs(el){
    if(!el.getAttribute || protege(el)) return;
    var liste = ATTRS;
    for(var i = 0; i < liste.length; i++){
      var a = liste[i], v = el.getAttribute(a); if(v == null) continue;
      el.__a = el.__a || {}; var s = el.__a[a];
      if(!s || v !== s.tr) s = el.__a[a] = { fr: v, tr: v };
      var cible = etat.langue === 'fr' ? s.fr : (chercher(s.fr, etat.langue) || s.fr);
      if(v !== cible) el.setAttribute(a, cible);
      s.tr = cible;
    }
    if(el.nodeName === 'INPUT' && /^(submit|button)$/.test(el.type)){ var vv = el.value; el.__a = el.__a || {}; var sv = el.__a.value; if(!sv || vv !== sv.tr) sv = el.__a.value = { fr:vv, tr:vv }; var cv = etat.langue === 'fr' ? sv.fr : (chercher(sv.fr, etat.langue) || sv.fr); if(vv !== cv) el.value = cv; sv.tr = cv; }
    if(el.nodeName === 'META' && /^(description|og:title|og:description)$/.test(el.getAttribute('name') || el.getAttribute('property') || '')){
      var c = el.getAttribute('content'); el.__a = el.__a || {}; var sc = el.__a.content; if(!sc || c !== sc.tr) sc = el.__a.content = { fr:c, tr:c };
      var cc = etat.langue === 'fr' ? sc.fr : (chercher(sc.fr, etat.langue) || sc.fr); if(c !== cc) el.setAttribute('content', cc); sc.tr = cc;
    }
  }
  function parcourir(racineNoeud){
    if(!racineNoeud) return;
    if(racineNoeud.nodeType === 3){ traiterTexte(racineNoeud); return; }
    if(racineNoeud.nodeType !== 1 && racineNoeud.nodeType !== 9) return;
    var base = racineNoeud.nodeType === 9 ? racineNoeud.documentElement : racineNoeud;
    if(base.nodeType === 1){ traiterAttrs(base); }
    var w = document.createTreeWalker(base, NodeFilter.SHOW_ELEMENT | NodeFilter.SHOW_TEXT, null), x;
    while((x = w.nextNode())){ if(x.nodeType === 3) traiterTexte(x); else traiterAttrs(x); }
  }

  var obs = null, file = [], planifie = false;
  function vider(){
    planifie = false; var l = file; file = [];
    for(var i = 0; i < l.length; i++){ var n = l[i]; if(n.isConnected !== false) parcourir(n); }
    if(obs) obs.takeRecords();   // nos propres modifications ne relancent rien
  }
  function demarrerObservateur(){
    if(obs || !window.MutationObserver) return;
    obs = new MutationObserver(function(muts){
      if(etat.langue === 'fr' && !etat.aTraduit) return;
      for(var i = 0; i < muts.length; i++){
        var m = muts[i];
        if(m.type === 'childList'){ for(var j = 0; j < m.addedNodes.length; j++) file.push(m.addedNodes[j]); }
        else if(m.type === 'characterData') file.push(m.target);
        else if(m.type === 'attributes') file.push(m.target);
      }
      if(!planifie){ planifie = true; (window.requestAnimationFrame || setTimeout)(vider); }
    });
    obs.observe(racine, { childList:true, subtree:true, characterData:true, attributes:true, attributeFilter:['placeholder', 'title', 'aria-label', 'alt', 'value'] });
  }

  // --------------------------------------------------------------------------------------- langue, sens, police
  function appliquerLangue(){
    var L = LANGUES[etat.langue];
    racine.lang = etat.langue === 'ar' ? 'ar-MA' : (etat.langue === 'nl' ? 'nl-BE' : etat.langue);
    racine.dir = L.dir; racine.setAttribute('data-lang', etat.langue);
    if(etat.langue === 'ar' && !document.getElementById('mirrio-police-ar')){
      var l = document.createElement('link'); l.id = 'mirrio-police-ar'; l.rel = 'stylesheet'; l.href = 'https://fonts.googleapis.com/css2?family=Noto+Sans+Arabic:wght@400;500;600;700;800&display=swap'; document.head.appendChild(l);
    }
    if(!document.getElementById('mirrio-i18n-css')){
      var s = document.createElement('style'); s.id = 'mirrio-i18n-css';
      s.textContent = 'html[data-lang=ar] body, html[data-lang=ar] h1, html[data-lang=ar] h2, html[data-lang=ar] h3, html[data-lang=ar] button, html[data-lang=ar] input, html[data-lang=ar] select, html[data-lang=ar] textarea{ font-family:"Noto Sans Arabic","Geist","Segoe UI",system-ui,sans-serif !important; letter-spacing:0 !important; }' +
        'html.i18n-attente body{ visibility:hidden; }' +
        '.i18n-sel{ position:fixed; inset-block-end:14px; inset-inline-end:14px; z-index:2147483000; font:600 14px system-ui,sans-serif; }' +
        '.i18n-sel[data-inline]{ position:static; display:inline-block; }' +
        '.i18n-bt{ display:flex; align-items:center; gap:6px; min-height:44px; padding:0 14px; border-radius:999px; border:1px solid rgba(16,18,22,.18); background:#fff; color:#101216; cursor:pointer; box-shadow:0 6px 20px rgba(16,18,22,.16); font:inherit; }' +
        '.i18n-pan{ position:absolute; inset-block-end:52px; inset-inline-end:0; width:min(340px,92vw); background:#fff; color:#101216; border:1px solid rgba(16,18,22,.14); border-radius:20px; padding:14px; box-shadow:0 18px 50px rgba(16,18,22,.28); }' +
        '.i18n-pan h3{ font:700 12px system-ui,sans-serif; text-transform:uppercase; letter-spacing:.06em; color:#5B606B; margin:4px 0 8px; }' +
        '.i18n-pan .g{ display:grid; grid-template-columns:repeat(2,1fr); gap:6px; margin-block-end:10px; }' +
        '.i18n-pan button{ display:flex; align-items:center; gap:8px; min-height:44px; padding:0 10px; border-radius:12px; border:1.5px solid rgba(16,18,22,.14); background:#fff; color:#101216; cursor:pointer; font:500 14px system-ui,sans-serif; text-align:start; }' +
        '.i18n-pan button[aria-pressed=true]{ border-color:#101216; background:#F5F5F3; box-shadow:0 0 0 2px #E2A63D; }' +
        '.i18n-pan .dr{ font-size:20px; }' +
        '.i18n-pan p{ font:400 12.5px system-ui,sans-serif; color:#5B606B; margin:2px 0 0; }' +
        '@media (prefers-color-scheme:dark){ .i18n-bt,.i18n-pan,.i18n-pan button{ background:#1B1E25; color:#F5F5F3; border-color:rgba(245,245,243,.2); } .i18n-pan button[aria-pressed=true]{ background:#101216; } .i18n-pan h3,.i18n-pan p{ color:#A5A9B3; } }' +
        '@media print{ .i18n-sel{ display:none; } }';
      document.head.appendChild(s);
    }
  }

  // --------------------------------------------------------------------------------------- sélecteur : drapeau (pays) + langue
  var panneau = null, bouton = null, conteneur = null, pays_verrouille = false;
  function libelles(){ return { titre: t('Langue et pays'), langue: t('Langue'), pays: t('Pays (monnaie et TVA)'), verrou: t('Le pays de votre salon se règle dans Paramètres.') }; }
  function dessinerSelecteur(){
    if(sansSelecteur || !document.body) return;
    if(!conteneur){
      conteneur = document.createElement('div'); conteneur.className = 'i18n-sel notranslate'; conteneur.setAttribute('translate', 'no');
      var hote = document.querySelector('[data-langues]');
      if(hote){ conteneur.setAttribute('data-inline', ''); hote.appendChild(conteneur); } else document.body.appendChild(conteneur);
      document.addEventListener('click', function(e){ if(panneau && !conteneur.contains(e.target)) fermer(); });
      document.addEventListener('keydown', function(e){ if(e.key === 'Escape' && panneau){ fermer(); bouton.focus(); } });
    }
    var lb = libelles(), p = PAYS[etat.pays];
    conteneur.innerHTML = '<button class="i18n-bt" type="button" aria-haspopup="dialog" aria-expanded="' + (panneau ? 'true' : 'false') + '" aria-label="' + lb.titre + '"><span class="dr" aria-hidden="true">' + p.drapeau + '</span><span>' + LANGUES[etat.langue].court + '</span><span aria-hidden="true">·</span><span>' + p.devise + '</span></button>';
    bouton = conteneur.firstChild; panneau = null;
    bouton.addEventListener('click', function(){ if(panneau) fermer(); else ouvrir(); });
  }
  function fermer(){ if(panneau){ panneau.remove(); panneau = null; if(bouton) bouton.setAttribute('aria-expanded', 'false'); } }
  function ouvrir(){
    var lb = libelles(), h = '<div class="i18n-pan" role="dialog" aria-label="' + lb.titre + '">';
    h += '<h3>' + lb.langue + '</h3><div class="g">' + Object.keys(LANGUES).map(function(k){ return '<button type="button" data-l="' + k + '" aria-pressed="' + (k === etat.langue) + '"><span>' + LANGUES[k].nom + '</span></button>'; }).join('') + '</div>';
    h += '<h3>' + lb.pays + '</h3><div class="g">' + Object.keys(PAYS).map(function(k){ return '<button type="button" data-p="' + k + '" aria-pressed="' + (k === etat.pays) + '"' + (pays_verrouille ? ' disabled style="opacity:.55;cursor:default"' : '') + '><span class="dr" aria-hidden="true">' + PAYS[k].drapeau + '</span><span>' + PAYS[k].nom[etat.langue] + ' · ' + PAYS[k].devise + '</span></button>'; }).join('') + '</div>';
    if(pays_verrouille) h += '<p>' + lb.verrou + '</p>';
    panneau = document.createElement('div'); panneau.innerHTML = h + '</div>'; panneau = panneau.firstChild; conteneur.appendChild(panneau); bouton.setAttribute('aria-expanded', 'true');
    panneau.addEventListener('click', function(e){
      var l = e.target.closest('[data-l]'), p = e.target.closest('[data-p]');
      if(l){ definirLangue(l.getAttribute('data-l')); }
      if(p && !p.disabled){ definirPays(p.getAttribute('data-p'), true); }
    });
    var premier = panneau.querySelector('[aria-pressed=true]'); if(premier) premier.focus();
  }

  // --------------------------------------------------------------------------------------- API
  function notifier(){ etat.ecouteurs.forEach(function(f){ try{ f(api); }catch(e){} }); }
  function definirLangue(l){
    if(!LANGUES[l]) return; etat.langue = l; ecrire(CLE_LANGUE, l); etat.aTraduit = true;
    appliquerLangue(); parcourir(document); if(obs) obs.takeRecords(); dessinerSelecteur(); notifier();
  }
  function definirPays(c, suggererLangue){
    if(!PAYS[c] || pays_verrouille) return; etat.pays = c; ecrire(CLE_PAYS, c);
    if(suggererLangue && !lire(CLE_LANGUE + '-choisie')){ /* la langue ne change pas d'elle-même : pays et langue sont deux choix */ }
    dessinerSelecteur(); notifier();
  }
  var api = {
    get lang(){ return etat.langue; }, get locale(){ return LANGUES[etat.langue].locale; }, get dir(){ return LANGUES[etat.langue].dir; },
    get pays(){ return etat.pays; }, get devise(){ return PAYS[etat.pays].devise; }, drapeau: function(c){ return (PAYS[c || etat.pays] || PAYS.FR).drapeau; },
    LANGUES: LANGUES, PAYS: PAYS, t: t, setLang: definirLangue, setPays: definirPays, ajouterDico: ajouterDico,
    // Pays imposé par le salon connecté : le sélecteur l'affiche mais ne le change plus.
    imposerPays: function(c){ if(!PAYS[c]) return; etat.pays = c; pays_verrouille = true; dessinerSelecteur(); notifier(); },
    onChange: function(f){ etat.ecouteurs.push(f); },
    traduire: function(noeud){ parcourir(noeud || document); },
    montant: function(n, devise){ return new Intl.NumberFormat(LANGUES[etat.langue].locale, { style:'currency', currency: devise || PAYS[etat.pays].devise }).format(Number(n) || 0); },
    date: function(d, opts){ return new Date(d).toLocaleDateString(LANGUES[etat.langue].locale, opts || { day:'numeric', month:'short' }); }
  };
  window.I18N = api;

  // --------------------------------------------------------------------------------------- démarrage
  function charger(url){ return fetch(url).then(function(r){ return r.ok ? r.json() : {}; }).then(ajouterDico).catch(function(){}); }
  function demarrer(){
    appliquerLangue();
    if(etat.langue !== 'fr'){ etat.aTraduit = true; parcourir(document); }
    demarrerObservateur(); dessinerSelecteur();
  }
  appliquerLangue();
  var fichiers = ['/i18n/commun.json'].concat(pages.map(function(p){ return '/i18n/' + p + '.json'; }));
  if(etat.langue === 'fr'){
    // Français : rien à charger pour afficher la page ; les dictionnaires arrivent pour un changement de langue immédiat.
    Promise.all(fichiers.map(charger));
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
  } else {
    racine.classList.add('i18n-attente');   // évite l'éclair de français pendant le chargement (1,5 s au plus)
    var fin = function(){ racine.classList.remove('i18n-attente'); };
    var minuteur = setTimeout(fin, 1500);
    Promise.all(fichiers.map(charger)).then(function(){
      var pret = function(){ clearTimeout(minuteur); demarrer(); fin(); notifier(); };   // les pages qui assemblent leurs textes se redessinent dans la langue
      if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', pret); else pret();
    });
  }
  // Les dictionnaires chargés après coup (français au départ) servent au premier changement de langue.
  etat.aTraduit = etat.langue !== 'fr';
})();
