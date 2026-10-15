// Mirrio — rendu d'un devis / d'une facture.
//
// Un seul rendu, deux usages : l'aperçu live de l'écran Paramètres et la vue
// imprimée de l'écran Devis & factures. C'est volontaire — si l'aperçu et
// l'impression étaient deux bouts de code distincts, ce que l'utilisateur règle
// finirait par ne plus être ce que son client reçoit.

import { ACCENTS, ACCENT_DEFAUT } from './theme.js';

const PARAMS_DEFAUT = {
  emetteur_nom:'', emetteur_adresse:'', emetteur_cp:'', emetteur_ville:'',
  emetteur_pays:'France', emetteur_email:'', emetteur_tel:'',
  forme_juridique:'', siret:'', tva_numero:'', rcs_ville:'',
  assujetti_tva:false, tva_taux_defaut:20,
  iban:'', bic:'', delai_paiement_jours:30,
  conditions_paiement:'', penalites_retard:'', mentions_pied:'',
  prefixe_devis:'DEV', prefixe_facture:'FAC',
  modele:'moderne', couleur_document:'theme',
  afficher_logo:true, afficher_mention_cadence:true, signature_url:null
};

// Mention obligatoire pour un émetteur non assujetti (franchise en base, art. 293 B du CGI).
export const MENTION_FRANCHISE_TVA = 'TVA non applicable, art. 293 B du CGI.';

// Rappel légal par défaut pour les retards de paiement entre professionnels
// (art. L441-10 et D441-5 du code de commerce).
export const PENALITES_DEFAUT =
  'En cas de retard de paiement, une pénalité égale à trois fois le taux d’intérêt légal ' +
  'sera appliquée, ainsi qu’une indemnité forfaitaire de 40 € pour frais de recouvrement.';

export function echapper(str){
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

export function formatMontant(n){
  return new Intl.NumberFormat('fr-FR', { style:'currency', currency:'EUR' }).format(Number(n) || 0);
}

export function formatDate(d){
  if(!d) return '—';
  const date = (d instanceof Date) ? d : new Date(d);
  if(isNaN(date)) return '—';
  return date.toLocaleDateString('fr-FR', { day:'2-digit', month:'long', year:'numeric' });
}

// La couleur du document suit le thème de l'interface par défaut, mais peut
// s'en détacher : un photographe peut vouloir une app sobre et un devis coloré.
export function couleurDocument(params, brand){
  const p = { ...PARAMS_DEFAUT, ...(params || {}) };
  if(p.couleur_document && p.couleur_document !== 'theme' && /^#[0-9A-Fa-f]{6}$/.test(p.couleur_document)){
    return p.couleur_document;
  }
  const accent = ACCENTS[brand?.accent] || ACCENTS[ACCENT_DEFAUT];
  return accent.hex;
}

// ---------------------------------------------------------------------------
// Totaux
// ---------------------------------------------------------------------------
// Calculés ici et nulle part ailleurs, pour que l'aperçu, l'impression et la
// liste des documents ne puissent pas diverger d'un centime.

export function calculerTotaux(lignes, params){
  const p = { ...PARAMS_DEFAUT, ...(params || {}) };
  let totalHT = 0;
  const parTaux = new Map();

  (lignes || []).forEach(l => {
    const ht = (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0);
    totalHT += ht;
    if(p.assujetti_tva){
      const taux = Number(l.tva_taux ?? p.tva_taux_defaut) || 0;
      parTaux.set(taux, (parTaux.get(taux) || 0) + ht * taux / 100);
    }
  });

  const totalTVA = [...parTaux.values()].reduce((a,b) => a + b, 0);
  return {
    totalHT,
    totalTVA,
    totalTTC: totalHT + totalTVA,
    assujetti: !!p.assujetti_tva,
    ventilation: [...parTaux.entries()].sort((a,b) => a[0] - b[0]).map(([taux, montant]) => ({ taux, montant }))
  };
}

// ---------------------------------------------------------------------------
// Styles du document
// ---------------------------------------------------------------------------
// Deux modèles, une seule feuille : « moderne » pose un bandeau de couleur et
// des libellés en capitales espacées ; « classique » s'en tient à des filets
// fins et à une seule ligne de couleur sous l'en-tête.

export function stylesDocument(couleur, modele){
  const moderne = modele !== 'classique';
  return `
  .cad-doc{
    background:#fff; color:#1C2333; font-family:'Inter',Arial,sans-serif;
    font-size:13px; line-height:1.5; padding:${moderne ? '0 0 34px' : '34px 0'};
    width:100%; overflow:hidden;
  }
  .cad-doc .bandeau{ height:${moderne ? '8px' : '0'}; background:${couleur}; }
  .cad-doc .corps{ padding:${moderne ? '30px 34px 0' : '0 34px'}; }
  .cad-doc .tete{ display:flex; justify-content:space-between; align-items:flex-start; gap:24px; margin-bottom:26px; }
  .cad-doc .emetteur{ min-width:0; }
  .cad-doc .emetteur img{ max-height:52px; max-width:180px; object-fit:contain; margin-bottom:10px; }
  .cad-doc .emetteur .nom{ font-family:'Fraunces',Georgia,serif; font-weight:700; font-size:19px; margin-bottom:5px; }
  .cad-doc .emetteur .ligne{ font-size:11.5px; color:rgba(28,35,51,0.62); }
  .cad-doc .bloc-titre{ text-align:right; flex-shrink:0; }
  .cad-doc .bloc-titre .type{
    font-family:'Fraunces',Georgia,serif; font-weight:700; font-size:23px;
    color:${moderne ? couleur : '#1C2333'}; text-transform:uppercase;
    letter-spacing:${moderne ? '0.04em' : '0'};
  }
  .cad-doc .bloc-titre .numero{ font-family:'IBM Plex Mono',monospace; font-size:12.5px; color:rgba(28,35,51,0.6); margin-top:2px; }
  .cad-doc .filet{ height:1px; background:${moderne ? 'rgba(28,35,51,0.12)' : couleur}; margin-bottom:22px; }
  .cad-doc .meta{ display:flex; justify-content:space-between; gap:24px; margin-bottom:24px; }
  .cad-doc .meta .label{
    font-size:9.5px; text-transform:uppercase; letter-spacing:.07em;
    color:${moderne ? couleur : 'rgba(28,35,51,0.45)'}; font-weight:600; margin-bottom:4px;
  }
  .cad-doc .meta .valeur{ font-size:12.5px; }
  .cad-doc .meta .valeur strong{ font-weight:600; }
  .cad-doc .meta .mono{ font-family:'IBM Plex Mono',monospace; font-size:12px; }
  .cad-doc table{ width:100%; border-collapse:collapse; margin-bottom:18px; }
  .cad-doc thead th{
    text-align:left; font-size:9.5px; text-transform:uppercase; letter-spacing:.06em; font-weight:600;
    padding:8px 6px;
    ${moderne
      ? `background:${couleur}; color:#fff; border:none;`
      : `color:rgba(28,35,51,0.5); border-bottom:1.5px solid #1C2333;`}
  }
  .cad-doc thead th:first-child{ padding-left:${moderne ? '10px' : '6px'}; }
  .cad-doc thead th:last-child{ padding-right:${moderne ? '10px' : '6px'}; }
  .cad-doc tbody td{ padding:9px 6px; border-bottom:1px solid rgba(28,35,51,0.1); font-size:12.5px; vertical-align:top; }
  .cad-doc tbody td:first-child{ padding-left:${moderne ? '10px' : '6px'}; }
  .cad-doc tbody td:last-child{ padding-right:${moderne ? '10px' : '6px'}; }
  .cad-doc td.num, .cad-doc th.num{ text-align:right; font-family:'IBM Plex Mono',monospace; white-space:nowrap; }
  .cad-doc .desc-sec{ display:block; font-size:11px; color:rgba(28,35,51,0.5); margin-top:2px; }
  .cad-doc .totaux{ display:flex; justify-content:flex-end; margin-bottom:22px; }
  .cad-doc .totaux table{ width:auto; min-width:250px; margin:0; }
  .cad-doc .totaux td{ border:none; padding:4px 0; font-size:12.5px; }
  .cad-doc .totaux td:last-child{ text-align:right; font-family:'IBM Plex Mono',monospace; padding-left:26px; }
  .cad-doc .totaux tr.ttc td{
    border-top:1.5px solid ${couleur}; padding-top:8px; font-weight:700; font-size:15px;
    font-family:'Fraunces',Georgia,serif;
  }
  .cad-doc .totaux tr.ttc td:last-child{ font-family:'IBM Plex Mono',monospace; color:${couleur}; }
  .cad-doc .encadre{
    border-left:3px solid ${couleur}; background:rgba(28,35,51,0.03);
    padding:11px 14px; margin-bottom:16px; font-size:11.5px;
  }
  .cad-doc .encadre .titre{ font-weight:600; margin-bottom:3px; font-size:10.5px; text-transform:uppercase; letter-spacing:.05em; color:rgba(28,35,51,0.5); }
  .cad-doc .encadre .mono{ font-family:'IBM Plex Mono',monospace; }
  .cad-doc .acquittee{ display:flex; justify-content:flex-end; margin:-8px 0 22px; }
  .cad-doc .acquittee-badge{
    display:inline-flex; align-items:center; gap:5px; font-size:11px; font-weight:700;
    text-transform:uppercase; letter-spacing:.06em; color:${couleur};
    border:1.5px solid ${couleur}; border-radius:5px; padding:5px 11px;
  }
  .cad-doc .notes{ font-size:11.5px; color:rgba(28,35,51,0.65); margin-bottom:16px; white-space:pre-wrap; }
  .cad-doc .pied{
    border-top:1px solid rgba(28,35,51,0.12); padding-top:11px; margin-top:20px;
    font-size:9.5px; color:rgba(28,35,51,0.5); line-height:1.6;
  }
  .cad-doc .signature{ margin:18px 0; }
  .cad-doc .signature img{ max-height:56px; max-width:170px; object-fit:contain; }
  .cad-doc .vide{ color:rgba(28,35,51,0.35); font-style:italic; }
  `;
}

// ---------------------------------------------------------------------------
// Corps du document
// ---------------------------------------------------------------------------

export function rendreDocument({ doc, lignes, client, params, brand }){
  const p = { ...PARAMS_DEFAUT, ...(params || {}) };
  const couleur = couleurDocument(p, brand);
  const estDevis = (doc?.type || 'devis') === 'devis';
  // 'paye' est le même statut que gère déjà l'écran Devis & factures (case
  // à cocher « Acquitté(e) », badge de la liste, calcul du CA encaissé du
  // tableau de bord) — un seul et même champ, pour ne jamais désynchroniser
  // ce qui est marqué payé de ce qui s'affiche sur le document imprimé.
  const estAcquitte = doc?.statut === 'paye';
  const totaux = calculerTotaux(lignes, p);

  const nomEmetteur = p.emetteur_nom || brand?.business_name || 'Votre activité';
  const lignesEmetteur = [
    p.emetteur_adresse,
    [p.emetteur_cp, p.emetteur_ville].filter(Boolean).join(' '),
    p.emetteur_pays,
    p.emetteur_email,
    p.emetteur_tel
  ].filter(Boolean);

  const logo = (p.afficher_logo && brand?.logo_url)
    ? `<img src="${echapper(brand.logo_url)}" alt="">`
    : '';

  const corpsLignes = (lignes && lignes.length) ? lignes.map(l => {
    const ht = (Number(l.quantite) || 0) * (Number(l.prix_unitaire) || 0);
    const taux = Number(l.tva_taux ?? p.tva_taux_defaut) || 0;
    return `<tr>
      <td>${echapper(l.description)}${l.description_secondaire ? `<span class="desc-sec">${echapper(l.description_secondaire)}</span>` : ''}</td>
      <td class="num">${Number(l.quantite) || 0}</td>
      <td class="num">${formatMontant(l.prix_unitaire)}</td>
      ${p.assujetti_tva ? `<td class="num">${taux} %</td>` : ''}
      <td class="num">${formatMontant(ht)}</td>
    </tr>`;
  }).join('') : `<tr><td colspan="${p.assujetti_tva ? 5 : 4}" class="vide">Aucune ligne pour l’instant.</td></tr>`;

  // Sans TVA, « HT » et « TTC » ne veulent rien dire : une seule ligne de total,
  // et l'en-tête de colonne perd sa mention « HT ».
  const blocTotaux = p.assujetti_tva
    ? `<tr><td>Total HT</td><td>${formatMontant(totaux.totalHT)}</td></tr>
       ${totaux.ventilation.map(v => `<tr><td>TVA ${v.taux} %</td><td>${formatMontant(v.montant)}</td></tr>`).join('')}
       <tr class="ttc"><td>Total TTC</td><td>${formatMontant(totaux.totalTTC)}</td></tr>`
    : `<tr class="ttc"><td>${estDevis ? 'Total' : 'Net à payer'}</td><td>${formatMontant(totaux.totalHT)}</td></tr>`;

  const mentionsLegales = [
    p.forme_juridique,
    p.siret ? `SIRET ${p.siret}` : '',
    p.rcs_ville ? `RCS ${p.rcs_ville}` : '',
    p.assujetti_tva ? (p.tva_numero ? `TVA ${p.tva_numero}` : '') : MENTION_FRANCHISE_TVA
  ].filter(Boolean).join(' · ');

  const conditions = p.conditions_paiement
    || `Paiement à ${p.delai_paiement_jours} jours à réception de ${estDevis ? 'la facture' : 'la présente facture'}.`;

  return `
  <div class="cad-doc">
    <div class="bandeau"></div>
    <div class="corps">
      <div class="tete">
        <div class="emetteur">
          ${logo}
          <div class="nom">${echapper(nomEmetteur)}</div>
          ${lignesEmetteur.map(l => `<div class="ligne">${echapper(l)}</div>`).join('')}
        </div>
        <div class="bloc-titre">
          <div class="type">${estDevis ? 'Devis' : 'Facture'}</div>
          <div class="numero">${echapper(doc?.numero || `${estDevis ? p.prefixe_devis : p.prefixe_facture}-${new Date().getFullYear()}-001`)}</div>
        </div>
      </div>
      <div class="filet"></div>

      <div class="meta">
        <div>
          <div class="label">${estDevis ? 'Devis pour' : 'Facturé à'}</div>
          <div class="valeur"><strong>${echapper(client?.full_name || 'Client')}</strong></div>
          ${client?.company ? `<div class="valeur">${echapper(client.company)}</div>` : ''}
          ${client?.email ? `<div class="valeur">${echapper(client.email)}</div>` : ''}
        </div>
        <div style="text-align:right;">
          <div class="label">Émis le</div>
          <div class="valeur mono">${formatDate(doc?.date_emission || new Date())}</div>
          ${estAcquitte ? '' : `
          <div class="label" style="margin-top:9px;">${estDevis ? 'Valable jusqu’au' : 'Échéance'}</div>
          <div class="valeur mono">${formatDate(doc?.date_echeance)}</div>`}
        </div>
      </div>

      <table>
        <thead>
          <tr>
            <th>Description</th>
            <th class="num">Qté</th>
            <th class="num">Prix unit.</th>
            ${p.assujetti_tva ? '<th class="num">TVA</th>' : ''}
            <th class="num">${p.assujetti_tva ? 'Total HT' : 'Total'}</th>
          </tr>
        </thead>
        <tbody>${corpsLignes}</tbody>
      </table>

      <div class="totaux"><table>${blocTotaux}</table></div>

      ${estAcquitte ? `<div class="acquittee"><span class="acquittee-badge">✓ Acquittée</span></div>` : ''}

      ${doc?.notes ? `<div class="notes">${echapper(doc.notes)}</div>` : ''}

      ${(!estAcquitte && (p.iban || conditions)) ? `
      <div class="encadre">
        <div class="titre">${estDevis ? 'Conditions' : 'Règlement'}</div>
        <div>${echapper(conditions)}</div>
        ${p.iban ? `<div class="mono" style="margin-top:5px;">IBAN ${echapper(p.iban)}${p.bic ? ` · BIC ${echapper(p.bic)}` : ''}</div>` : ''}
      </div>` : ''}

      ${p.signature_url ? `<div class="signature"><img src="${echapper(p.signature_url)}" alt="Signature"></div>` : ''}

      <div class="pied">
        ${mentionsLegales ? `<div>${echapper(mentionsLegales)}</div>` : ''}
        ${(!estDevis && !estAcquitte && p.penalites_retard !== '') ? `<div>${echapper(p.penalites_retard || PENALITES_DEFAUT)}</div>` : ''}
        ${p.mentions_pied ? `<div>${echapper(p.mentions_pied)}</div>` : ''}
        ${p.afficher_mention_cadence ? '<div style="opacity:.7;">Édité avec Mirrio</div>' : ''}
      </div>
    </div>
  </div>`;
}

// Document d'exemple, pour que l'aperçu des paramètres montre quelque chose de
// crédible avant que l'utilisateur ait créé sa première facture.
export function documentExemple(vocab){
  const terme = vocab?.Singulier || 'Séance';
  const aujourdhui = new Date();
  const echeance = new Date(aujourdhui.getTime() + 30 * 86400000);
  return {
    doc: { type:'facture', numero:null, date_emission:aujourdhui, date_echeance:echeance,
           notes:'Merci de votre confiance.' },
    // Client volontairement distinct de l'émetteur : dans l'aperçu des
    // Paramètres, voir deux fois le même nom prête à confusion.
    client: { full_name:'Camille Bernard', company:'Atelier Bernard', email:'camille@atelier-bernard.fr' },
    lignes: [
      { description:`${terme} — forfait mensuel`, description_secondaire:'4 rendez-vous', quantite:4, prix_unitaire:60 },
      { description:'Bilan trimestriel', quantite:1, prix_unitaire:90 },
      { description:'Déplacement', quantite:2, prix_unitaire:15 }
    ]
  };
}
