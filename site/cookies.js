// Mirrio — information sur les cookies et choix de l'utilisateur.
//
// Aujourd'hui Mirrio ne dépose QUE des cookies / stockages strictement nécessaires (session de connexion, préférences d'affichage,
// mémorisation de ce choix). Aucun outil de mesure d'audience ni de publicité n'est actif. Le bandeau est quand même affiché :
//   - pour l'informer (loi marocaine 09-08 / CNDP, RGPD / directive ePrivacy pour les visiteurs européens) ;
//   - pour que tout futur outil optionnel soit soumis au consentement dès le premier jour, sans refaire l'écran.
//
// Règle pour tout nouveau traceur NON essentiel : ne le charger que si `window.mirrioConsent.mesure()` est vrai, et réagir à
// l'événement `mirrio:consent` (détail : { essentiels, mesure }) pour le charger ou l'arrêter quand le choix change.
//
// Le choix est gardé en localStorage (`mirrio-cookies`), douze mois, puis redemandé. Un lien ou un bouton portant l'attribut
// `data-cookies` rouvre les préférences à tout moment (pied de page).
(function(){
  'use strict';
  const CLE = 'cadence-cookies', DUREE = 365 * 86400000;
  const lire = () => {
    try{
      const c = JSON.parse(localStorage.getItem(CLE) || 'null');
      return c && c.v === 1 && Date.now() - c.date < DUREE ? c : null;
    }catch(e){ return null; }
  };
  let choix = lire();

  window.mirrioConsent = {
    decide: () => !!choix,
    mesure: () => !!(choix && choix.mesure),
    ouvrir: () => ouvrirPreferences()
  };

  function enregistrer(mesure){
    choix = { v: 1, essentiels: true, mesure: !!mesure, date: Date.now() };
    try{ localStorage.setItem(CLE, JSON.stringify(choix)); }catch(e){}
    document.dispatchEvent(new CustomEvent('mirrio:consent', { detail: { essentiels: true, mesure: choix.mesure } }));
    fermer();
  }

  const css = `
  #mirrio-cookies,#mirrio-cookies-prefs{ --c-bg:#fff; --c-ink:#101216; --c-muted:#5B606B; --c-line:rgba(16,18,22,.14); --c-accent:#E2A63D; --c-accent-ink:#101216;
    font:400 15px/1.5 'Geist',system-ui,-apple-system,'Segoe UI',sans-serif; color:var(--c-ink); }
  @media (prefers-color-scheme:dark){ #mirrio-cookies,#mirrio-cookies-prefs{ --c-bg:#1A1D24; --c-ink:#F1F1EE; --c-muted:#A3A8B3; --c-line:rgba(255,255,255,.16); } }
  #mirrio-cookies{ position:fixed; z-index:2147483000; left:16px; right:16px; bottom:16px; max-width:720px; margin:0 auto; background:var(--c-bg);
    border:1px solid var(--c-line); border-radius:22px; padding:20px 22px; box-shadow:0 18px 50px -12px rgba(0,0,0,.35); }
  #mirrio-cookies h2,#mirrio-cookies-prefs h2{ font:700 17px/1.3 'Bricolage Grotesque',system-ui,sans-serif; margin:0 0 6px; }
  #mirrio-cookies p,#mirrio-cookies-prefs p{ margin:0 0 14px; color:var(--c-muted); }
  #mirrio-cookies a,#mirrio-cookies-prefs a{ color:inherit; text-decoration:underline; }
  .mc-actions{ display:flex; flex-wrap:wrap; gap:10px; }
  .mc-btn{ min-height:44px; padding:0 20px; border-radius:999px; font:600 15px 'Geist',system-ui,sans-serif; cursor:pointer; border:1px solid var(--c-line); background:transparent; color:var(--c-ink); }
  .mc-btn.mc-primary{ background:var(--c-accent); border-color:var(--c-accent); color:var(--c-accent-ink); }
  .mc-btn:focus-visible,#mirrio-cookies input:focus-visible,#mirrio-cookies-prefs input:focus-visible{ outline:3px solid var(--c-accent); outline-offset:2px; }
  #mirrio-cookies-prefs{ position:fixed; inset:0; z-index:2147483001; display:grid; place-items:center; padding:16px; background:rgba(8,10,14,.55); }
  #mirrio-cookies-prefs .mc-box{ background:var(--c-bg); border-radius:24px; max-width:560px; width:100%; max-height:calc(100vh - 32px); overflow:auto; padding:24px; }
  .mc-cat{ border:1px solid var(--c-line); border-radius:16px; padding:14px 16px; margin:0 0 12px; display:flex; gap:14px; align-items:flex-start; justify-content:space-between; }
  .mc-cat b{ display:block; font-weight:600; } .mc-cat span{ color:var(--c-muted); font-size:14px; display:block; margin-top:2px; }
  .mc-cat input{ width:22px; height:22px; margin-top:2px; accent-color:var(--c-accent); flex:none; }
  @media (max-width:560px){ .mc-actions .mc-btn{ flex:1 1 100%; } }
  @media (prefers-reduced-motion:no-preference){ #mirrio-cookies{ animation:mc-in .35s cubic-bezier(.16,1,.3,1); } @keyframes mc-in{ from{ opacity:0; transform:translateY(12px); } } }
  @media print{ #mirrio-cookies,#mirrio-cookies-prefs{ display:none; } }`;

  function style(){
    if(document.getElementById('mirrio-cookies-css')) return;
    const s = document.createElement('style'); s.id = 'mirrio-cookies-css'; s.textContent = css; document.head.appendChild(s);
  }

  function fermer(){
    const b = document.getElementById('mirrio-cookies'), p = document.getElementById('mirrio-cookies-prefs');
    if(p){ p.remove(); if(retour && document.contains(retour)) retour.focus(); }
    if(b) b.remove();
  }

  function bandeau(){
    if(document.getElementById('mirrio-cookies') || choix) return;
    style();
    const d = document.createElement('div');
    d.id = 'mirrio-cookies'; d.setAttribute('role', 'region'); d.setAttribute('aria-labelledby', 'mc-titre');
    d.innerHTML = `<h2 id="mc-titre">Vos données, votre choix</h2>
      <p>Mirrio utilise uniquement des cookies et stockages <strong>nécessaires</strong> (connexion, préférences). Aucun cookie publicitaire. Vous pouvez autoriser ou refuser une éventuelle mesure d'audience, et changer d'avis à tout moment. <a href="/confidentialite.html#cookies">En savoir plus</a></p>
      <div class="mc-actions">
        <button type="button" class="mc-btn" data-mc="refuser">Tout refuser</button>
        <button type="button" class="mc-btn" data-mc="perso">Personnaliser</button>
        <button type="button" class="mc-btn mc-primary" data-mc="accepter">Tout accepter</button>
      </div>`;
    d.addEventListener('click', e => {
      const a = e.target.closest('[data-mc]'); if(!a) return;
      if(a.dataset.mc === 'refuser') enregistrer(false);
      else if(a.dataset.mc === 'accepter') enregistrer(true);
      else ouvrirPreferences();
    });
    document.body.appendChild(d);
  }

  let retour = null;
  function ouvrirPreferences(){
    if(document.getElementById('mirrio-cookies-prefs')) return;
    style();
    retour = document.activeElement;
    const p = document.createElement('div');
    p.id = 'mirrio-cookies-prefs';
    p.innerHTML = `<div class="mc-box" role="dialog" aria-modal="true" aria-labelledby="mc-t2">
      <h2 id="mc-t2">Préférences de cookies</h2>
      <p>Choisissez ce que Mirrio peut enregistrer sur votre appareil. Vous pouvez modifier ce choix à tout moment depuis le lien « Gérer les cookies » en bas de page.</p>
      <div class="mc-cat"><div><b>Nécessaires</b><span>Connexion, sécurité, mémorisation de vos préférences et de ce choix. Indispensables, ils ne peuvent pas être désactivés.</span></div><input type="checkbox" checked disabled aria-label="Cookies nécessaires, toujours actifs"></div>
      <div class="mc-cat"><div><b>Mesure d'audience</b><span>Statistiques de fréquentation pour améliorer Mirrio. Aucun outil de ce type n'est actif aujourd'hui : si nous en ajoutons un, il ne se déclenchera que si vous l'avez accepté ici.</span></div><input type="checkbox" id="mc-mesure" aria-label="Mesure d'audience"${choix && choix.mesure ? ' checked' : ''}></div>
      <div class="mc-actions"><button type="button" class="mc-btn" data-mc="refuser">Tout refuser</button><button type="button" class="mc-btn mc-primary" data-mc="sauver">Enregistrer mon choix</button></div>
    </div>`;
    p.addEventListener('click', e => {
      if(e.target === p){ fermerPrefs(); return; }
      const a = e.target.closest('[data-mc]'); if(!a) return;
      enregistrer(a.dataset.mc === 'sauver' ? document.getElementById('mc-mesure').checked : false);
    });
    p.addEventListener('keydown', e => {
      if(e.key === 'Escape'){ fermerPrefs(); return; }
      if(e.key !== 'Tab') return;
      const f = [...p.querySelectorAll('button, input:not([disabled])')];
      const premier = f[0], dernier = f[f.length - 1];
      if(e.shiftKey && document.activeElement === premier){ e.preventDefault(); dernier.focus(); }
      else if(!e.shiftKey && document.activeElement === dernier){ e.preventDefault(); premier.focus(); }
    });
    document.body.appendChild(p);
    p.querySelector('#mc-mesure').focus();
  }
  function fermerPrefs(){
    const p = document.getElementById('mirrio-cookies-prefs'); if(p) p.remove();
    if(retour && document.contains(retour)) retour.focus();
  }

  document.addEventListener('click', e => {
    const l = e.target.closest('[data-cookies]'); if(!l) return;
    e.preventDefault(); ouvrirPreferences();
  });

  const demarrer = () => bandeau();
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', demarrer); else demarrer();
})();
