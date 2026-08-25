// Cadence — fonctions de présentation pures pour le widget de réservation en
// ligne (site/reservation.html). Même découpage que document-render.js /
// voir-document.html : ce module ne fait ni fetch ni gestion d'état, il
// construit seulement du HTML/CSS à partir de données déjà chargées.

import { ACCENTS, ACCENT_DEFAUT } from './theme.js';

export function echapperHtml(str){
  return String(str == null ? '' : str)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
}

export function formaterEuros(n){
  return new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(n || 0);
}

export function formaterDuree(minutes){
  if(minutes % 60 === 0) return `${minutes / 60} h`;
  if(minutes < 60) return `${minutes} min`;
  return `${Math.floor(minutes / 60)} h ${minutes % 60}`;
}

// Prix TTC d'une prestation — même calcul que côté serveur (voir
// api/reservation-publique.js) : `prix_unitaire` est HT, la TVA s'ajoute
// par-dessus. Affiché ici pour que le total montré au client corresponde
// exactement au montant qui sera réellement débité.
export function prixTTC(p){
  const taux = Number(p.tva_taux) || 0;
  return Number(p.prix_unitaire) * (1 + taux / 100);
}

// Résumé d'une sélection de prestations (durée + prix cumulés) — utilisé
// pour le bouton « Continuer » de l'étape de choix, où plusieurs prestations
// peuvent désormais être cochées ensemble.
export function resumeSelection(liste){
  if(!liste.length) return '';
  const duree = liste.reduce((s, p) => s + (Number(p.duree_minutes) || 0), 0);
  const total = liste.reduce((s, p) => s + prixTTC(p), 0);
  const n = liste.length;
  return `${n} prestation${n > 1 ? 's' : ''} sélectionnée${n > 1 ? 's' : ''} — ${formaterDuree(duree)} — ${formaterEuros(total)}`;
}

// Variables CSS d'accent posées sur :root — même jeu de couleurs que le reste
// de l'app (theme.js), mais appliqué localement : cette page n'a pas de
// session, donc pas de cache de marque à réutiliser.
export function stylesAccent(accentKey){
  const a = ACCENTS[accentKey] || ACCENTS[ACCENT_DEFAUT];
  return `:root{ --accent:${a.hex}; --accent-text:${a.texte}; --accent-doux:${a.doux}; }`;
}

export function carteMarque({ business_name, logo_url }){
  if(logo_url){
    return `<img src="${echapperHtml(logo_url)}" alt="${echapperHtml(business_name)}" class="marque-logo">`;
  }
  return `<span class="marque-texte">${echapperHtml(business_name)}</span>`;
}

// Sélection multiple : chaque carte est une case à cocher (une ou plusieurs
// prestations peuvent être choisies ensemble, ex. « Coupe + Couleur »), pas
// une navigation immédiate — voir le bouton « Continuer » de reservation.html.
export function cartePrestation(p, selectionnee){
  return `
    <button type="button" class="carte-prestation ${selectionnee ? 'selectionnee' : ''}" data-id="${p.id}" aria-pressed="${selectionnee ? 'true' : 'false'}">
      <div class="cp-case" aria-hidden="true">${selectionnee ? '✓' : ''}</div>
      <div class="cp-corps">
        <div class="cp-titre">${echapperHtml(p.libelle)}</div>
        ${p.description ? `<div class="cp-desc">${echapperHtml(p.description)}</div>` : ''}
        <div class="cp-meta">
          <span>${formaterDuree(p.duree_minutes)}</span>
          <span class="cp-prix">${formaterEuros(prixTTC(p))}</span>
        </div>
      </div>
    </button>`;
}

export function boutonJour(date, estOuvert){
  const iso = date.toISOString().slice(0, 10);
  const label = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', weekday: 'short', day: 'numeric', month: 'short' }).format(date);
  return `<button type="button" class="jour-btn" data-date="${iso}" ${estOuvert ? '' : 'disabled'}>${label}</button>`;
}

export function boutonCreneau(iso){
  const label = new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit' }).format(new Date(iso));
  return `<button type="button" class="creneau-btn" data-iso="${iso}">${label}</button>`;
}
