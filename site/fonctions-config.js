/* Mirrio — interrupteurs de fonctions : UN seul endroit pour montrer ou cacher une fonction du produit.
 *
 * caisse : true  = la caisse est visible, avec la mention « en cours de certification » (décision du 2 novembre 2026, suite).
 * caisse : false  => la caisse (caisse.html) n'est pas encore certifiée NF525 (voir docs/caisse-conformite.md) : elle est CACHÉE partout (onglet, menus, pages publiques,
 *                    démonstrations, plan du site) et ses pages redirigent. Les fonctions qui en dépendent (statistiques et commissions par personne, fidélité, attestation)
 *                    sont cachées avec elle. Rien n'est supprimé : tout le code et la base restent en place.
 *                    Pour la remettre : passer `caisse` à true ici, remettre `/caisse-logiciel.html` dans `api/_sitemap.js` et revérifier les textes marketing
 *                    (voir CLAUDE.md §3.50).
 *
 * Usage : fichier classique (<script src="/fonctions-config.js"></script>) ou importé (theme.js). Tout élément portant l'attribut data-caisse est retiré de la page quand
 * la caisse est cachée ; une page qui ne doit pas s'afficher porte data-garde-caisse="<page de repli>" sur la balise <html>.
 */
(function(){
  'use strict';
  var F = (globalThis.MIRRIO_FONCTIONS = globalThis.MIRRIO_FONCTIONS || { caisse: true });
  function appliquer(){
    if(F.caisse) return;
    var racine = document.documentElement, repli = racine.getAttribute('data-garde-caisse');
    if(repli){ location.replace(repli); return; }
    document.querySelectorAll('[data-caisse]').forEach(function(e){ e.remove(); });
  }
  if(typeof document !== 'undefined'){
    if(document.documentElement.getAttribute('data-garde-caisse') && !F.caisse){ location.replace(document.documentElement.getAttribute('data-garde-caisse')); }
    else if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', appliquer); else appliquer();
  }
})();
