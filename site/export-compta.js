// Mirrio — export comptable : analyse des données (export_comptable / comptable_donnees), rapport affichable et fichiers CSV.
// Partagé par export-comptable.html (le salon, connecté) et comptable.html (le comptable, lien en lecture seule) : un seul calcul, donc
// les chiffres vus par le comptable sont exactement ceux que télécharge le salon. Les totaux passent par calculerTotaux() (document-render.js),
// comme l'aperçu, l'impression, l'export CSV de Comptabilité et la caisse.
//
// Conventions Excel françaises : séparateur « ; », décimales à la virgule, BOM UTF-8, fins de ligne CRLF.
import { calculerTotaux } from './document-render.js';

export const MODES = { especes:'Espèces', carte:'Carte', cheque:'Chèque', virement:'Virement', autre:'Autre' };
const STATUTS = { envoye:'Envoyée', accepte:'Acceptée', paye:'Payée', en_retard:'En retard', refuse:'Refusée' };
const r2 = n => Math.round((Number(n) + Number.EPSILON) * 100) / 100;
import { formaterMontant } from './pays-profils.js';
const eur = n => formaterMontant(r2(n));
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
const dateFr = d => d ? new Date(String(d).slice(0, 10) + 'T12:00:00').toLocaleDateString('fr-FR') : '';
const heureFr = d => d ? new Date(d).toLocaleTimeString('fr-FR', { hour:'2-digit', minute:'2-digit' }) : '';

// ------------------------------------------------------------------ périodes
const iso = (y, m, j) => `${y}-${String(m).padStart(2, '0')}-${String(j).padStart(2, '0')}`;
export function periodesPredefinies(){
  const a = new Date(), y = a.getFullYear(), m = a.getMonth() + 1, aujourdhui = iso(y, m, a.getDate());
  const dernierJour = (yy, mm) => new Date(yy, mm, 0).getDate();
  const mp = m === 1 ? [y - 1, 12] : [y, m - 1], t = Math.floor((m - 1) / 3) * 3 + 1;
  return [
    ['Ce mois', iso(y, m, 1), aujourdhui],
    ['Mois dernier', iso(mp[0], mp[1], 1), iso(mp[0], mp[1], dernierJour(mp[0], mp[1]))],
    ['Ce trimestre', iso(y, t, 1), aujourdhui],
    ['Cette année', iso(y, 1, 1), aujourdhui],
    ['Année dernière', iso(y - 1, 1, 1), iso(y - 1, 12, 31)]
  ];
}

// ------------------------------------------------------------------ analyse
export function analyser(data){
  const params = { assujetti_tva:!!data.salon.assujetti_tva, tva_taux_defaut:Number(data.salon.tva_taux_defaut) || 0 };
  const assujetti = params.assujetti_tva;
  const parTaux = new Map(), parMode = {};
  const tot = { ht:0, tva:0, ttc:0, encaisse:0 };
  const factures = (data.factures || []).map(f => {
    const t = calculerTotaux(f.lignes, params);
    const lignes = (f.lignes || []).map(l => {
      const ht = r2(Number(l.quantite) * Number(l.prix_unitaire)), taux = assujetti ? Number(l.tva_taux ?? params.tva_taux_defaut) || 0 : 0;
      const tva = r2(ht * taux / 100);
      const e = parTaux.get(taux) || { base:0, tva:0 }; e.base += ht; e.tva += tva; parTaux.set(taux, e);
      return { ...l, ht, taux, tva, ttc:r2(ht + tva) };
    });
    const paiements = (f.paiements || []).map(p => ({ ...p, montant:Number(p.montant) }));
    paiements.forEach(p => { parMode[p.mode] = r2((parMode[p.mode] || 0) + p.montant); });
    const encaisse = r2(paiements.reduce((s, p) => s + p.montant, 0));
    const ht = r2(t.totalHT), tva = r2(t.totalTVA), ttc = r2(t.totalTTC);
    tot.ht += ht; tot.tva += tva; tot.ttc += ttc; tot.encaisse += encaisse;
    return { ...f, lignes, paiements, ht, tva, ttc, encaisse };
  });
  return {
    salon:data.salon, periode:data.periode, tronque:!!data.tronque, assujetti, factures, partage:data.partage || null,
    clotures:(data.clotures || []).filter(c => c.rapport),
    totaux:{ ht:r2(tot.ht), tva:r2(tot.tva), ttc:r2(tot.ttc), encaisse:r2(tot.encaisse) },
    tva:[...parTaux.entries()].sort((a, b) => a[0] - b[0]).map(([taux, v]) => ({ taux, base:r2(v.base), tva:r2(v.tva) })),
    parMode
  };
}

// ------------------------------------------------------------------ CSV
const nb = n => (n == null || n === '' ? '' : r2(n).toFixed(2).replace('.', ','));
const cel = v => { const s = String(v == null ? '' : v); return /[;"\r\n]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s; };
const csv = (entetes, lignes) => '﻿' + [entetes, ...lignes].map(l => l.map(cel).join(';')).join('\r\n') + '\r\n';
const modesTexte = f => [...new Set(f.paiements.map(p => MODES[p.mode] || p.mode))].join(' + ');

export function csvJournal(a){
  const taux = a.tva.map(t => t.taux);
  return csv(['Date', 'Numéro', 'Client', 'Statut', 'Origine', 'Total HT', ...taux.map(t => `TVA ${String(t).replace('.', ',')} %`), 'Total TVA', 'Total TTC', 'Moyens de paiement', 'Encaissé en caisse'],
    a.factures.map(f => {
      const ven = {}; f.lignes.forEach(l => { ven[l.taux] = (ven[l.taux] || 0) + l.tva; });
      return [dateFr(f.date_emission), f.numero, f.client || '', STATUTS[f.statut] || f.statut, f.origine_caisse ? 'Caisse' : 'Facturation', nb(f.ht), ...taux.map(t => nb(ven[t] || 0)), nb(f.tva), nb(f.ttc), modesTexte(f), nb(f.encaisse)];
    }));
}
export function csvLignes(a){
  return csv(['Date', 'Numéro', 'Description', 'Quantité', 'Prix unitaire HT', 'Taux TVA', 'Total HT', 'TVA', 'Total TTC'],
    a.factures.flatMap(f => f.lignes.map(l => [dateFr(f.date_emission), f.numero, l.description, String(l.quantite).replace('.', ','), nb(l.prix_unitaire), a.assujetti ? String(l.taux).replace('.', ',') + ' %' : '', nb(l.ht), nb(l.tva), nb(l.ttc)])));
}
export function csvPaiements(a){
  return csv(['Date', 'Heure', 'Numéro de facture', 'Client', 'Moyen de paiement', 'Montant'],
    a.factures.flatMap(f => f.paiements.map(p => [dateFr(p.date), heureFr(p.date), f.numero, f.client || '', MODES[p.mode] || p.mode, nb(p.montant)])));
}
export function csvClotures(a){
  const modes = Object.keys(MODES);
  return csv(['Ouverture', 'Clôture', 'Nombre de ventes', 'CA HT', 'TVA', 'CA TTC', ...modes.map(m => MODES[m]), 'Fond de caisse', 'Espèces attendues', 'Espèces comptées', 'Écart'],
    a.clotures.map(c => { const r = c.rapport, pm = r.par_mode || {};
      return [dateFr(c.ouverte_le) + ' ' + heureFr(c.ouverte_le), dateFr(c.cloturee_le) + ' ' + heureFr(c.cloturee_le), r.nb_ventes, nb(r.total_ht), nb(r.total_tva), nb(r.total_ttc), ...modes.map(m => nb(pm[m] || 0)), nb(r.fond_caisse), nb(r.especes_attendues), nb(r.especes_comptees), nb(r.ecart)]; }));
}
export function csvTva(a){
  return csv(['Taux de TVA', 'Base HT', 'TVA'], [...a.tva.map(t => [String(t.taux).replace('.', ',') + ' %', nb(t.base), nb(t.tva)]), ['Total', nb(a.totaux.ht), nb(a.totaux.tva)]]);
}
export const FICHIERS = [
  ['journal-des-ventes', 'Journal des ventes', csvJournal, 'Une ligne par facture : HT, TVA par taux, TTC, moyens de paiement.'],
  ['detail-des-lignes', 'Détail des lignes', csvLignes, 'Chaque prestation facturée, avec son taux de TVA.'],
  ['paiements-caisse', 'Paiements de caisse', csvPaiements, 'Chaque encaissement : moyen de paiement et montant.'],
  ['clotures-de-caisse', 'Clôtures de caisse (Z)', csvClotures, 'Total par moyen de paiement, espèces attendues et comptées, écart.'],
  ['recapitulatif-tva', 'Récapitulatif de TVA', csvTva, 'Base HT et TVA collectée par taux, pour la déclaration.']
];

export function telecharger(nom, contenu){
  const url = URL.createObjectURL(new Blob([contenu], { type:'text/csv;charset=utf-8' }));
  const l = document.createElement('a'); l.href = url; l.download = nom; document.body.appendChild(l); l.click(); l.remove();
  setTimeout(() => URL.revokeObjectURL(url), 2000);
}
export const nomFichier = (a, cle) => `${(a.salon.nom || 'salon').toLowerCase().normalize('NFD').replace(/[̀-ͯ]/g, '').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')}_${cle}_${a.periode.debut}_${a.periode.fin}.csv`;
export function toutTelecharger(a){ FICHIERS.forEach(([cle, , f], i) => setTimeout(() => telecharger(nomFichier(a, cle), f(a)), i * 350)); }

// ------------------------------------------------------------------ rapport affichable
export function injecterStyleRapport(){
  if(document.getElementById('style-rapport')) return;
  const s = document.createElement('style'); s.id = 'style-rapport';
  s.textContent = `.kpis{ display:grid; gap:12px; grid-template-columns:repeat(auto-fit,minmax(170px,1fr)); margin-bottom:16px; }
    .kpi{ background:var(--surface); border:1px solid var(--line); border-radius:18px; padding:16px 18px; } .kpi small{ color:var(--muted); display:block; } .kpi b{ font:800 26px var(--display); letter-spacing:-.02em; }
    .tableau{ background:var(--surface); border:1px solid var(--line); border-radius:18px; padding:8px 14px; margin-bottom:16px; overflow-x:auto; } .tableau h2{ font-size:17px; padding:10px 0 4px; }
    .tableau table{ width:100%; border-collapse:collapse; font-size:14px; } .tableau th,.tableau td{ text-align:left; padding:8px 6px; border-bottom:1px solid var(--line); white-space:nowrap; } .tableau th{ color:var(--muted); font-weight:500; }
    .tableau td.n,.tableau th.n{ text-align:right; } .tableau tr:last-child td{ border-bottom:none; }`;
  document.head.appendChild(s);
}
export function rendreRapport(a){
  const tabl = (titre, entetes, lignes, note = '') => `<div class="tableau"><h2>${esc(titre)}</h2>${lignes.length ? `<table><thead><tr>${entetes.map((h, i) => `<th${i ? ' class="n"' : ''}>${esc(h)}</th>`).join('')}</tr></thead><tbody>${lignes.map(l => `<tr>${l.map((c, i) => `<td${i ? ' class="n"' : ''}>${c}</td>`).join('')}</tr>`).join('')}</tbody></table>` : '<p style="color:var(--muted);padding:10px 0">Aucune donnée sur cette période.</p>'}${note ? `<p style="color:var(--muted);font-size:13px;padding:6px 0 10px">${note}</p>` : ''}</div>`;
  const modes = Object.entries(a.parMode);
  return `<div class="kpis">
      <div class="kpi"><small>Factures</small><b>${a.factures.length}</b></div>
      <div class="kpi"><small>Chiffre d'affaires ${a.assujetti ? 'HT' : ''}</small><b>${eur(a.totaux.ht)}</b></div>
      ${a.assujetti ? `<div class="kpi"><small>TVA collectée</small><b>${eur(a.totaux.tva)}</b></div>` : ''}
      <div class="kpi"><small>Total ${a.assujetti ? 'TTC' : ''}</small><b>${eur(a.totaux.ttc)}</b></div>
      <div class="kpi"><small>Encaissé en caisse</small><b>${eur(a.totaux.encaisse)}</b></div></div>
    ${a.tronque ? '<p class="alerte" style="margin-bottom:12px;color:var(--alerte);font-weight:600">Plus de 5 000 factures sur cette période : le rapport est limité aux 5 000 premières. Choisissez une période plus courte.</p>' : ''}
    ${a.assujetti ? tabl('TVA par taux', ['Taux', 'Base HT', 'TVA'], a.tva.map(t => [t.taux + ' %', eur(t.base), eur(t.tva)])) : '<p style="color:var(--muted);margin-bottom:12px">Salon en franchise en base de TVA : aucune TVA collectée.</p>'}
    ${tabl('Encaissements en caisse par moyen de paiement', ['Moyen', 'Montant'], modes.map(([m, v]) => [esc(MODES[m] || m), eur(v)]))}
    ${tabl('Clôtures de caisse', ['Clôture', 'Ventes', 'CA TTC', 'Espèces comptées', 'Écart'], a.clotures.map(c => [esc(dateFr(c.cloturee_le) + ' ' + heureFr(c.cloturee_le)), c.rapport.nb_ventes, eur(c.rapport.total_ttc), eur(c.rapport.especes_comptees), eur(c.rapport.ecart)]))}
    ${tabl('Factures de la période', ['Date', 'Numéro', 'Client', 'Total HT', 'Total TTC', 'Paiement'], a.factures.slice(0, 300).map(f => [dateFr(f.date_emission), esc(f.numero), esc(f.client || ''), eur(f.ht), eur(f.ttc), esc(modesTexte(f) || STATUTS[f.statut] || f.statut)]),
      a.factures.length > 300 ? `Les 300 premières factures sont affichées ici ; les fichiers CSV contiennent les ${a.factures.length}.` : '')}`;
}
