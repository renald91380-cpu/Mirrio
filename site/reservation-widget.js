// Mirrio - fonctions de présentation pures pour le widget de réservation en
// ligne (site/reservation.html). Même découpage que document-render.js /
// voir-document.html : ce module ne fait ni fetch ni gestion d'état, il
// construit seulement du HTML/CSS à partir de données déjà chargées.

import { ACCENTS, ACCENT_DEFAUT } from './theme.js';

export function echapperHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
}

export function formaterEuros(n){
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
}

export function formaterDuree(minutes){
  if(minutes % 60 === 0) return `${minutes / 60} h`;
  if(minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${String(minutes % 60).padStart(2, '0')}`;
}

// Prix TTC d'une prestation : même calcul que côté serveur (voir
// api/reservation-publique.js). `prix_unitaire` est HT, la TVA s'ajoute
// par-dessus. Affiché ici pour que le total montré au client corresponde
// exactement au montant qui sera réellement débité.
export function prixTTC(p){
  const taux = Number(p.tva_taux) || 0;
  return Number(p.prix_unitaire) * (1 + taux / 100);
}

export function totaux(liste){
  return {
    duree: liste.reduce((s, p) => s + (Number(p.duree_minutes) || 0), 0),
    prix: liste.reduce((s, p) => s + prixTTC(p), 0)
  };
}

// Résumé court d'une sélection : « 2 prestations, 1 h 45, 93 € ».
export function resumeSelection(liste){
  if(!liste.length) return '';
  const { duree, prix } = totaux(liste);
  const n = liste.length;
  return `${n} prestation${n > 1 ? 's' : ''}, ${formaterDuree(duree)}, ${formaterEuros(prix)}`;
}

// ---------------------------------------------------------------- style salon
// La page de réservation prolonge la vitrine du salon : mêmes variables que
// pro.html (couleur, fond, typographie, forme des boutons). Sans réglage
// « Ma page », on retombe sur l'accent de la marque et le style moderne.
const POLICES = {
  moderne:    { titre:"'Bricolage Grotesque', system-ui, sans-serif", corps:"'Geist', system-ui, sans-serif" },
  elegante:   { titre:"'Fraunces', Georgia, serif",                    corps:"'Inter', Arial, sans-serif" },
  douce:      { titre:"'Nunito', Arial, sans-serif",                   corps:"'Nunito', Arial, sans-serif" },
  editoriale: { titre:"'Playfair Display', Georgia, serif",            corps:"'DM Sans', Arial, sans-serif" }
};
const FONDS = {
  clair:  { bg:'#F5F5F3', surface:'#FFFFFF', ink:'#101216', muted:'#5B606B', trait:'rgba(16,18,22,.12)' },
  creme:  { bg:'#F5F1E7', surface:'#FFFFFF', ink:'#1C2333', muted:'#625F57', trait:'rgba(28,35,51,.12)' },
  sombre: { bg:'#0F1217', surface:'#181C23', ink:'#F1F1EE', muted:'#A4A8B5', trait:'rgba(255,255,255,.13)' }
};
const RAYONS = { arrondi:'12px', carre:'3px', pilule:'999px' };

function luminance(hex){
  const [r, g, b] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
    .map(v => v <= .03928 ? v / 12.92 : Math.pow((v + .055) / 1.055, 2.4));
  return .2126 * r + .7152 * g + .0722 * b;
}
const texteSur = hex => luminance(hex) > .38 ? '#101216' : '#FFFFFF';

// Renvoie un bloc CSS `:root{...}` prêt à injecter.
export function stylesSalon(accentKey, style){
  const s = style || {};
  const a = ACCENTS[accentKey] || ACCENTS[ACCENT_DEFAUT];
  const couleur = /^#[0-9a-fA-F]{6}$/.test(s.couleur || '') ? s.couleur : a.hex;
  const police = POLICES[s.police] || POLICES.moderne;
  const fond = FONDS[s.fond] || FONDS.clair;
  const v = {
    '--c':couleur, '--c-texte':texteSur(couleur), '--bg':fond.bg, '--surface':fond.surface, '--ink':fond.ink,
    '--muted':fond.muted, '--trait':fond.trait, '--titre':police.titre, '--corps':police.corps,
    '--rayon':RAYONS[s.boutons] || RAYONS.arrondi,
    '--c-doux':`color-mix(in srgb, ${couleur} 16%, ${fond.surface})`
  };
  return `:root{ ${Object.entries(v).map(([k, x]) => `${k}:${x}`).join('; ')}; color-scheme:${s.fond === 'sombre' ? 'dark' : 'light'}; }`;
}

export function carteMarque({ business_name, logo_url }){
  if(logo_url && /^https:\/\//i.test(logo_url)){
    return `<img src="${echapperHtml(logo_url)}" alt="${echapperHtml(business_name)}" class="marque-logo">`;
  }
  return `<span class="marque-texte">${echapperHtml(business_name)}</span>`;
}

// Sélection multiple : chaque carte est un bouton à bascule (une ou plusieurs
// prestations peuvent être choisies ensemble, ex. « Coupe + Couleur »).
export function cartePrestation(p, selectionnee){
  return `
    <button type="button" class="carte-prestation${selectionnee ? ' selectionnee' : ''}" data-id="${p.id}" aria-pressed="${selectionnee ? 'true' : 'false'}">
      <span class="cp-case" aria-hidden="true">${selectionnee ? '&#10003;' : ''}</span>
      <span class="cp-corps">
        <span class="cp-titre">${echapperHtml(p.libelle)}</span>
        ${p.description ? `<span class="cp-desc">${echapperHtml(p.description)}</span>` : ''}
        <span class="cp-duree">${formaterDuree(p.duree_minutes)}</span>
      </span>
      <span class="cp-prix">${formaterEuros(prixTTC(p))}</span>
    </button>`;
}

export function boutonJour(date, estOuvert){
  const iso = date.toISOString().slice(0, 10);
  const f = (opts) => new Intl.DateTimeFormat('fr-FR', { timeZone:'UTC', ...opts }).format(date);
  const complet = new Intl.DateTimeFormat('fr-FR', { timeZone:'UTC', weekday:'long', day:'numeric', month:'long' }).format(date);
  return `<button type="button" class="jour-btn" data-date="${iso}" aria-pressed="false" aria-label="${echapperHtml(complet)}${estOuvert ? '' : ', fermé'}" ${estOuvert ? '' : 'disabled'}>
    <span class="j-sem">${f({ weekday:'short' }).replace('.', '')}</span><span class="j-num">${f({ day:'numeric' })}</span><span class="j-mois">${f({ month:'short' }).replace('.', '')}</span></button>`;
}

export function boutonCreneau(iso){
  const label = new Intl.DateTimeFormat('fr-FR', { timeZone:'Europe/Paris', hour:'2-digit', minute:'2-digit' }).format(new Date(iso));
  return `<button type="button" class="creneau-btn" data-iso="${iso}">${label}</button>`;
}

// Heure de Paris (0-23) d'un créneau, pour regrouper matin / après-midi / soir.
export function heureParis(iso){
  // formatToParts : en français l'heure seule s'écrit « 09 h », que Number() ne sait pas lire.
  const h = new Intl.DateTimeFormat('fr-FR', { timeZone:'Europe/Paris', hour:'2-digit', hourCycle:'h23' })
    .formatToParts(new Date(iso)).find(x => x.type === 'hour');
  return Number(h.value);
}

// Acompte demandé en mode « espèces » : le plus grand de (minimum, pourcentage du
// total), jamais plus que le total. Même règle, au centime près, que
// api/reservation-publique.js (le serveur recalcule et fait foi).
export function calculerAcompte(total, { acompte_minimum = 5, acompte_pourcentage = 0 } = {}){
  const totalC = Math.round(total * 100);
  const c = Math.min(totalC, Math.max(500, Math.round(Number(acompte_minimum) * 100), Math.round(totalC * Number(acompte_pourcentage) / 100)));
  return c / 100;
}
