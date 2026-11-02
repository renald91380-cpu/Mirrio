/* Mirrio — tarifs des forfaits par monnaie, à UN seul endroit.
 *
 * Prix fixes par pays (pas de conversion à l'affichage) : calculés à partir du taux de change du 2 novembre 2026, arrondis à un prix « rond » :
 *   1 EUR ≈ 10,7 MAD  et  1 EUR ≈ 0,93 CHF   (relevés indicatifs, à revérifier avant chaque révision des prix : Bank Al-Maghrib, BNS, BCE).
 * Paiement annuel = deux mois offerts = 10 fois le prix mensuel, dans chaque monnaie. Aucun prélèvement réel n'existe encore (voir CLAUDE.md §1).
 * Les éléments de la page portent data-prix="<forfait>-<m|a>" (m = mensuel, a = annuel) ; appliquer() les met à jour selon la monnaie choisie dans le sélecteur.
 */
(function(){
  'use strict';
  var TARIFS = {
    EUR: { solo:[19, 190], equipe:[39, 390], groupe:[79, 790], patisserie:[29, 290], sup:[5, 50] },
    MAD: { solo:[199, 1990], equipe:[419, 4190], groupe:[849, 8490], patisserie:[309, 3090], sup:[55, 550] },
    CHF: { solo:[18, 180], equipe:[36, 360], groupe:[74, 740], patisserie:[27, 270], sup:[5, 50] }
  };
  function monnaie(){ return (window.I18N && TARIFS[window.I18N.devise]) ? window.I18N.devise : 'EUR'; }
  function format(n, devise){
    var l = window.I18N ? window.I18N.locale : 'fr-FR';
    return new Intl.NumberFormat(l, { style:'currency', currency:devise, minimumFractionDigits: n % 1 ? 2 : 0, maximumFractionDigits:2 }).format(n);
  }
  function prix(cle, devise){
    var p = cle.split('-'), t = (TARIFS[devise || monnaie()] || TARIFS.EUR)[p[0]];
    return t ? t[p[1] === 'a' ? 1 : 0] : null;
  }
  function appliquer(){
    var d = monnaie();
    document.querySelectorAll('[data-prix]').forEach(function(el){ var v = prix(el.getAttribute('data-prix'), d); if(v != null) el.textContent = format(v, d); });
    document.querySelectorAll('.plan .prix[data-plan]').forEach(function(el){
      var p = el.getAttribute('data-plan'), t = TARIFS[d][p], an = el.getAttribute('data-periode') === 'annuel';
      el.setAttribute('data-m', t[0]); el.setAttribute('data-a', t[1]);
      el.setAttribute('data-eco', 'soit ' + format(Math.round(t[1] / 12 * 100) / 100, d) + ' par mois');
      el.innerHTML = format(an ? t[1] : t[0], d) + (an ? '<small> /an</small>' : '<small> /mois</small>');
      var eco = el.parentElement.querySelector('.eco-an'); if(eco && an) eco.textContent = el.getAttribute('data-eco') + ', deux mois offerts';
    });
  }
  window.MIRRIO_TARIFS = { TARIFS: TARIFS, appliquer: appliquer, prix: prix, format: format, monnaie: monnaie };
  var lancer = function(){ appliquer(); if(window.I18N) window.I18N.onChange(appliquer); };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lancer); else lancer();
})();
