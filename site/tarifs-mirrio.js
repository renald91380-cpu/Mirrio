/* Mirrio — tarifs des forfaits par monnaie, à UN seul endroit.
 *
 * Prix fixes par pays (pas de conversion à l'affichage) : calculés à partir du taux de change du 2 novembre 2026, arrondis à un prix « rond » :
 *   1 EUR ≈ 10,7 MAD  et  1 EUR ≈ 0,93 CHF   (relevés indicatifs, à revérifier avant chaque révision des prix : Bank Al-Maghrib, BNS, BCE).
 * Paiement annuel = UN mois offert = 11 fois le prix mensuel, dans chaque monnaie (décidé le 2 novembre 2026 ; auparavant deux mois offerts). Aucun prélèvement réel n'existe encore (voir CLAUDE.md §1).
 * Les éléments de la page portent data-prix="<forfait>-<m|a>" (m = mensuel, a = annuel) ; appliquer() les met à jour selon la monnaie choisie dans le sélecteur.
 */
(function(){
  'use strict';
  var TARIFS = {
    EUR: { solo:[19, 209], equipe:[39, 429], groupe:[79, 869], patisserie:[29, 319], sup:[5, 55] },
    MAD: { solo:[199, 2189], equipe:[419, 4609], groupe:[849, 9339], patisserie:[309, 3399], sup:[55, 605] },
    CHF: { solo:[18, 198], equipe:[36, 396], groupe:[74, 814], patisserie:[27, 297], sup:[5, 55] }
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
    var T = function(fr){ var a = Array.prototype.slice.call(arguments, 1); return window.I18N ? window.I18N.t.apply(window.I18N, [fr].concat(a)) : fr.replace(/\{(\d+)\}/g, function(_, n){ return a[+n]; }); };
    var blocs = [];
    // 1) on remet en français les blocs déjà traduits qui contiennent un montant ; 2) on met les montants à jour (éléments relus après la remise en état) ; 3) on retraduit les blocs.
    document.querySelectorAll('[data-prix]').forEach(function(el){
      var b = window.I18N && window.I18N.reinitialiserBloc ? window.I18N.reinitialiserBloc(el) : null; if(b && blocs.indexOf(b) < 0) blocs.push(b);
    });
    document.querySelectorAll('[data-prix]').forEach(function(el){
      var v = prix(el.getAttribute('data-prix'), d); if(v != null) el.textContent = format(v, d);
    });
    if(window.I18N) blocs.forEach(function(b){ window.I18N.traduire(b); });
    document.querySelectorAll('.plan .prix[data-plan]').forEach(function(el){
      var p = el.getAttribute('data-plan'), t = TARIFS[d][p], an = el.getAttribute('data-periode') === 'annuel';
      el.setAttribute('data-m', t[0]); el.setAttribute('data-a', t[1]);
      el.setAttribute('data-eco', T('soit {0} par mois, un mois offert', format(Math.round(t[1] / 12 * 100) / 100, d)));
      el.innerHTML = format(an ? t[1] : t[0], d) + '<small> ' + (an ? T('/an') : T('/mois')) + '</small>';
      var eco = el.parentElement.querySelector('.eco-an'); if(eco && an) eco.textContent = el.getAttribute('data-eco');
    });
  }
  window.MIRRIO_TARIFS = { TARIFS: TARIFS, appliquer: appliquer, prix: prix, format: format, monnaie: monnaie };
  var lancer = function(){ appliquer(); if(window.I18N) window.I18N.onChange(appliquer); };
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', lancer); else lancer();
})();
