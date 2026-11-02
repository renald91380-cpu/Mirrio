/* Mirrio — interrupteurs de fonctions : UN seul endroit pour montrer ou cacher une fonction du produit, réglable depuis le back-office (admin.html, carte « Fonctionnalités »).
 *
 * Source de vérité : la table `fonctions_produit` (db/schema-v53-fonctions.sql), lisible par tous, modifiable par l'administrateur seulement.
 * Ce fichier garde des valeurs par défaut (ci-dessous), puis les remplace par la dernière valeur connue (localStorage, pour ne pas faire clignoter la page),
 * puis par la valeur lue en base à chaque chargement. Si la base ne répond pas, les valeurs par défaut ou connues restent en vigueur.
 *
 * Clés : caisse (caisse, attestation, page « logiciel de caisse »), fidelite (programme de fidélité et cartes Wallet côté salon), equipe (statistiques et commissions par personne).
 *
 * Dans une page :
 *   data-fonction="fidelite"                 l'élément est masqué quand la fonction est désactivée (data-caisse = data-fonction="caisse", ancien nom conservé)
 *   <html data-garde-fonction="equipe:clients.html">   la page redirige vers la page de repli quand la fonction est désactivée (data-garde-caisse="x" = "caisse:x")
 *   MIRRIO_FONCTIONS.caisse / .fidelite / .equipe        valeur courante ; MIRRIO_FONCTIONS.pret = promesse résolue quand la base a répondu (ou après 2,5 s)
 *   événement « mirrio:fonctions » sur document quand une valeur change.
 *
 * Usage : fichier classique (<script src="/fonctions-config.js"></script>) ou importé (theme.js). La caisse reste affichée « en cours de certification » tant que
 * le certificat NF525 n'est pas délivré (voir CLAUDE.md §3.50) : ne jamais écrire « certifiée ».
 */
(function(){
  'use strict';
  var CLE_CACHE = 'mirrio-fonctions';
  var F = (globalThis.MIRRIO_FONCTIONS = globalThis.MIRRIO_FONCTIONS || { caisse:true, fidelite:true, equipe:true });
  if(F.pret) return;   // déjà chargé (script classique puis import par theme.js)

  try{ var memo = JSON.parse(localStorage.getItem(CLE_CACHE) || 'null'); if(memo) Object.keys(memo).forEach(function(k){ if(typeof memo[k] === 'boolean') F[k] = memo[k]; }); }catch(e){}

  var racine = typeof document !== 'undefined' ? document.documentElement : null;
  var garde = null;
  if(racine){
    var g = racine.getAttribute('data-garde-fonction'), gc = racine.getAttribute('data-garde-caisse');
    if(g){ var i = g.indexOf(':'); garde = { cle:g.slice(0, i), repli:g.slice(i + 1) }; }
    else if(gc){ garde = { cle:'caisse', repli:gc }; }
  }

  function appliquer(){
    if(typeof document === 'undefined') return;
    document.querySelectorAll('[data-fonction],[data-caisse]').forEach(function(e){
      var cle = e.getAttribute('data-fonction') || 'caisse', actif = F[cle] !== false;
      if(!actif){ if(e.getAttribute('data-masque') !== '1'){ e.setAttribute('data-masque', '1'); e.setAttribute('data-affichage', e.style.display || ''); e.style.display = 'none'; } }
      else if(e.getAttribute('data-masque') === '1'){ e.style.display = e.getAttribute('data-affichage') || ''; e.removeAttribute('data-masque'); }
    });
  }
  function surveiller(){
    if(!garde || !racine) return;
    if(F[garde.cle] === false){ racine.style.visibility = 'hidden'; }   // pas de flash de la page avant de savoir si on reste
    else racine.style.visibility = '';
  }
  function decider(definitif){
    if(!garde) return;
    if(F[garde.cle] === false){ if(definitif) location.replace(garde.repli); }
    else if(racine) racine.style.visibility = '';
  }

  surveiller();
  if(typeof document !== 'undefined'){
    if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appliquer); else appliquer();
  }

  F.pret = new Promise(function(resolve){
    var fini = false;
    function terminer(){ if(fini) return; fini = true; appliquer(); decider(true); resolve(F); }
    setTimeout(terminer, 2500);
    import('/supabase-config.js').then(function(c){
      return fetch(c.SUPABASE_URL + '/rest/v1/fonctions_produit?select=cle,actif', { headers:{ apikey:c.SUPABASE_ANON_KEY, Authorization:'Bearer ' + c.SUPABASE_ANON_KEY } });
    }).then(function(r){ return r.ok ? r.json() : null; }).then(function(lignes){
      if(Array.isArray(lignes)){
        var change = false, memo2 = {};
        lignes.forEach(function(l){ if(l && typeof l.actif === 'boolean'){ if(F[l.cle] !== l.actif) change = true; F[l.cle] = l.actif; memo2[l.cle] = l.actif; } });
        try{ localStorage.setItem(CLE_CACHE, JSON.stringify(memo2)); }catch(e){}
        if(change && typeof document !== 'undefined') document.dispatchEvent(new CustomEvent('mirrio:fonctions', { detail:F }));
      }
    }).catch(function(){}).then(terminer);
  });
})();
