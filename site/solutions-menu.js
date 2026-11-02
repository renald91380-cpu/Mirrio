// Mirrio — menu « Solutions » de la barre de navigation des pages publiques (grand panneau à deux colonnes sous la barre flottante).
// Ajoute une entrée « Solutions » dans `.nav ul` ; le panneau s'ouvre au survol ou au clic, se ferme avec Échap ou un clic ailleurs.
// Un seul endroit pour la liste : la modifier ici la met à jour partout.
(function(){
  'use strict';
  const FONCTIONS = globalThis.MIRRIO_FONCTIONS || { caisse:false };
  const TOUTES = [
    ['Réservation en ligne 24h/24', 'Une page par salon, de vrais créneaux, un acompte par carte.', 'pro.html?p=demo-coiffure', ''],
    ['Agenda d\'équipe', 'Une colonne par personne, glisser-déposer, horaires de chacun.', 'demos.html', ''],
    ['Caisse prête pour la certification NF525', 'Tickets, avoirs, clôtures : un journal inaltérable.', 'caisse-logiciel.html', 'Nouveau'],
    ['Terminal de paiement', 'Encaissez sur un SumUp Solo, la référence suit le ticket.', 'caisse-logiciel.html#terminal', 'Nouveau'],
    ['Produits et code-barres', 'Votre catalogue, le scan à la caméra, les remises possibles.', 'caisse-logiciel.html#produits', ''],
    ['Plusieurs salons', 'Un planning commun, des salons à cocher, un forfait Groupe.', 'salons.html?demo=1', ''],
    ['Votre page de salon', 'Photos, équipe, prestations, avis : sans commission.', 'explorer.html', ''],
    ['Export pour le comptable', 'TVA par taux, archives, lien en lecture seule.', 'caisse-logiciel.html#compta', '']
  ];
  // Caisse non certifiée : ses entrées sont cachées (site/fonctions-config.js).
  const ENTREES = TOUTES.filter(e => FONCTIONS.caisse || !/^caisse-logiciel/.test(e[2]));
  const css = `
  /* Alignement : Solutions (bouton) et les autres liens (a) sur la même ligne, même police, même hauteur. */
  .nav ul{ align-items:center; }
  .nav ul li{ display:flex; align-items:center; min-height:44px; }
  .nav ul li > a{ display:inline-flex; align-items:center; min-height:44px; }
  .nav ul li.solutions{ position:static; }
  .nav ul .sol-btn{ background:none; border:0; font:inherit; line-height:1; letter-spacing:inherit; color:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:0; min-height:44px; }
  .nav ul .sol-btn:hover{ color:var(--ink); }
  .nav ul .sol-btn[aria-expanded=true]{ color:var(--ink); box-shadow:inset 0 -2px 0 var(--ink); }
  .sol-panneau{ position:absolute; left:14px; right:14px; top:calc(100% + 10px); max-width:1200px; margin:0 auto; z-index:60; padding:34px 44px 38px;
    background:var(--surface,#FBFBFA); color:var(--ink); border:1px solid var(--line); border-radius:28px; box-shadow:0 30px 70px -24px rgba(16,18,22,.4); }
  .sol-panneau[hidden]{ display:none; }
  .sol-grille{ display:grid; grid-template-columns:1fr 1fr; gap:6px 48px; list-style:none; }
  .sol-grille a{ display:block; position:relative; padding:14px 16px; border-radius:16px; color:var(--ink); }
  .sol-grille a:hover, .sol-grille a:focus-visible{ background:color-mix(in srgb, var(--accent) 16%, transparent); }
  .sol-grille b{ display:block; font:700 17px var(--display); letter-spacing:-.02em; color:var(--ink); }
  .sol-grille span{ display:block; margin-top:2px; font-size:14.5px; color:var(--muted); }
  .sol-grille em{ position:absolute; right:12px; top:12px; font:700 11px var(--body); font-style:normal; text-transform:uppercase; letter-spacing:.05em; background:var(--ink); color:var(--bg); padding:4px 10px; border-radius:99px; }
  @media(max-width:1180px){ .sol-panneau{ display:none !important; } }
  /* Menu hamburger : sous 1180 px les liens du bandeau passent dans un menu déroulant (Solutions se déplie). */
  .burger{ display:none; flex:none; align-items:center; justify-content:center; width:44px; height:44px; border-radius:50%; border:1px solid color-mix(in srgb, var(--ink) 18%, transparent); background:transparent; color:var(--ink); cursor:pointer; margin-inline-start:auto; }
  .burger:hover{ background:color-mix(in srgb, var(--ink) 8%, transparent); } .burger:focus-visible{ outline:3px solid var(--accent, #E2A63D); outline-offset:2px; }
  .burger-panneau{ position:absolute; left:14px; right:14px; top:calc(100% + 10px); z-index:70; max-height:calc(100vh - 110px); overflow:auto; padding:10px; background:var(--surface,#FBFBFA); color:var(--ink); border:1px solid var(--line); border-radius:24px; box-shadow:0 30px 70px -24px rgba(16,18,22,.4); }
  .burger-panneau[hidden]{ display:none; }
  .burger-panneau a, .burger-panneau summary{ display:flex; align-items:center; justify-content:space-between; min-height:48px; padding:0 16px; border-radius:14px; font:600 16px var(--body); color:var(--ink); cursor:pointer; list-style:none; text-decoration:none; }
  .burger-panneau summary::-webkit-details-marker{ display:none; }
  .burger-panneau a:hover, .burger-panneau summary:hover, .burger-panneau a:focus-visible, .burger-panneau summary:focus-visible{ background:color-mix(in srgb, var(--accent) 16%, transparent); outline:none; }
  .burger-panneau details[open] > summary svg{ transform:rotate(180deg); }
  .burger-panneau .sous{ padding:2px 6px 8px 14px; } .burger-panneau .sous a{ display:block; min-height:0; padding:10px 12px; font:500 15px var(--body); } .burger-panneau .sous a small{ display:block; font:400 13px var(--body); color:var(--muted); margin-top:2px; }
  .burger-panneau .burger-cta{ justify-content:center; margin:8px 6px 4px; min-height:52px; background:var(--accent, #E2A63D); color:#101216; font-weight:700; }
  .burger-panneau .burger-cta:hover{ filter:brightness(.96); }
  .nav .droite{ flex:none; } .nav .boutique{ flex:none; }
  @media(max-width:1180px){ .burger{ display:inline-flex; } }
  /* Téléphone : le bandeau ne doit jamais dépasser l'écran. « Créer mon salon » passe dans le menu hamburger (et reste dans le héros). */
  @media(max-width:600px){ .nav .droite .btn{ display:none; } }
  @media(min-width:1181px){ .burger-panneau{ display:none !important; } }
  @media (prefers-reduced-motion:no-preference){ .sol-panneau{ animation:sol-in .22s cubic-bezier(.16,1,.3,1); } @keyframes sol-in{ from{ opacity:0; transform:translateY(-6px); } } }`;
  function monter(){
    const nav = document.querySelector('.nav'), liste = nav && nav.querySelector('ul');
    if(!liste || liste.querySelector('.solutions')) return;
    const st = document.createElement('style'); st.textContent = css; document.head.appendChild(st);
    const li = document.createElement('li'); li.className = 'solutions';
    li.innerHTML = '<button type="button" class="sol-btn" aria-expanded="false" aria-controls="sol-panneau">Solutions <svg width="12" height="12" viewBox="0 0 12 12" aria-hidden="true"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg></button>';
    liste.insertBefore(li, liste.firstChild);
    const panneau = document.createElement('div'); panneau.className = 'sol-panneau'; panneau.id = 'sol-panneau'; panneau.hidden = true;
    panneau.innerHTML = '<ul class="sol-grille">' + ENTREES.map(([t, d, h, n]) => `<li><a href="${h}"><b>${t}</b><span>${d}</span>${n ? `<em>${n}</em>` : ''}</a></li>`).join('') + '</ul>';
    const entete = nav.closest('header') || nav; entete.style.position = entete.style.position || 'sticky'; entete.appendChild(panneau);
    const bouton = li.querySelector('button'); let tempo = null;
    const ouvrir = o => { clearTimeout(tempo); panneau.hidden = !o; bouton.setAttribute('aria-expanded', String(o)); };
    bouton.addEventListener('click', () => ouvrir(panneau.hidden));
    [li, panneau].forEach(el => { el.addEventListener('mouseenter', () => { if(matchMedia('(hover:hover)').matches) ouvrir(true); }); el.addEventListener('mouseleave', () => { if(matchMedia('(hover:hover)').matches) tempo = setTimeout(() => ouvrir(false), 180); }); });
    document.addEventListener('click', e => { if(!panneau.hidden && !e.target.closest('.solutions, .sol-panneau')) ouvrir(false); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && !panneau.hidden){ ouvrir(false); bouton.focus(); } });

    // ---- Menu hamburger (écrans étroits)
    const entetes = nav.closest('header') || nav;
    const bg = document.createElement('button'); bg.type = 'button'; bg.className = 'burger notranslate'; bg.setAttribute('translate', 'no'); bg.setAttribute('aria-expanded', 'false'); bg.setAttribute('aria-controls', 'burger-panneau');
    bg.setAttribute('aria-label', (window.I18N ? window.I18N.t('Menu') : 'Menu'));
    bg.innerHTML = '<svg width="22" height="22" viewBox="0 0 24 24" aria-hidden="true"><path d="M4 7h16M4 12h16M4 17h16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"/></svg>';
    const droite = nav.querySelector('.droite'); nav.insertBefore(bg, droite || null);
    const bp = document.createElement('div'); bp.className = 'burger-panneau'; bp.id = 'burger-panneau'; bp.hidden = true;
    const fleche = '<svg width="14" height="14" viewBox="0 0 12 12" aria-hidden="true" style="transition:transform .2s"><path d="M2 4.5 6 8.5 10 4.5" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round"/></svg>';
    const liens = [...liste.querySelectorAll(':scope > li:not(.solutions) > a')].map(a => `<a href="${a.getAttribute('href')}">${a.textContent}</a>`).join('');
    bp.innerHTML = `<details><summary>Solutions ${fleche}</summary><div class="sous">${ENTREES.map(([t, d, h]) => `<a href="${h}">${t}<small>${d}</small></a>`).join('')}</div></details>${liens}`;
    const cta = nav.querySelector('.droite .btn'); if(cta) bp.insertAdjacentHTML('beforeend', `<a class="btn burger-cta" href="${cta.getAttribute('href')}">${cta.textContent}</a>`);
    entetes.appendChild(bp);
    const bascule = o => { bp.hidden = !o; bg.setAttribute('aria-expanded', String(o)); };
    bg.addEventListener('click', () => bascule(bp.hidden));
    bp.addEventListener('click', e => { if(e.target.closest('a')) bascule(false); });
    document.addEventListener('click', e => { if(!bp.hidden && !e.target.closest('.burger, .burger-panneau')) bascule(false); });
    document.addEventListener('keydown', e => { if(e.key === 'Escape' && !bp.hidden){ bascule(false); bg.focus(); } });
    addEventListener('resize', () => { if(innerWidth > 1180) bascule(false); });
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter); else monter();
})();
