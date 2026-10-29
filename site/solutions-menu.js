// Mirrio — menu « Solutions » de la barre de navigation des pages publiques (grand panneau à deux colonnes sous la barre flottante).
// Ajoute une entrée « Solutions » dans `.nav ul` ; le panneau s'ouvre au survol ou au clic, se ferme avec Échap ou un clic ailleurs.
// Un seul endroit pour la liste : la modifier ici la met à jour partout.
(function(){
  'use strict';
  const ENTREES = [
    ['Réservation en ligne 24h/24', 'Une page par salon, de vrais créneaux, un acompte par carte.', 'pro.html?p=demo-coiffure', ''],
    ['Agenda d\'équipe', 'Une colonne par personne, glisser-déposer, horaires de chacun.', 'demos.html', ''],
    ['Caisse prête pour la certification NF525', 'Tickets, avoirs, clôtures : un journal inaltérable.', 'caisse-logiciel.html', 'Nouveau'],
    ['Terminal de paiement', 'Encaissez sur un SumUp Solo, la référence suit le ticket.', 'caisse-logiciel.html#terminal', 'Nouveau'],
    ['Produits et code-barres', 'Votre catalogue, le scan à la caméra, les remises possibles.', 'caisse-logiciel.html#produits', ''],
    ['Plusieurs salons', 'Un planning commun, des salons à cocher, un forfait Groupe.', 'salons.html?demo=1', ''],
    ['Votre page de salon', 'Photos, équipe, prestations, avis : sans commission.', 'explorer.html', ''],
    ['Export pour le comptable', 'TVA par taux, archives, lien en lecture seule.', 'caisse-logiciel.html#compta', '']
  ];
  const css = `
  .nav ul li.solutions{ position:static; }
  .nav ul .sol-btn{ background:none; border:0; font:inherit; color:inherit; cursor:pointer; display:inline-flex; align-items:center; gap:6px; padding:0; min-height:44px; }
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
  }
  if(document.readyState === 'loading') document.addEventListener('DOMContentLoaded', monter); else monter();
})();
