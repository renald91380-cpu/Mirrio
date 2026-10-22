// Mirrio — enregistrement du service worker et invitation à installer l'app.
//
// Trois chemins, car chaque navigateur fait à sa façon :
//   - Android / Chrome / Edge : invite native (`beforeinstallprompt`), que le navigateur déclenche lui-même quand il juge la
//     page installable ET le visiteur « engagé » (quelques secondes, des interactions). Rien n'est garanti à la première visite.
//   - iPhone / iPad : aucune invite native, on explique le geste (Partager, puis Sur l'écran d'accueil), dans Safari comme dans
//     les autres navigateurs (iOS 16.4 et plus).
//   - Navigateurs intégrés (Instagram, Facebook, TikTok…) : on ne peut pas installer, on invite à ouvrir la page dans le navigateur.
// En plus : un lien « Installer l'application » (attribut data-installer) toujours disponible, qui ne dépend ni d'un événement ni
// d'un refus passé. Un refus (×) n'est plus définitif : l'invitation revient après 14 jours.
(function(){
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  const ua = navigator.userAgent;
  const dejaInstallee = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  const liens = () => document.querySelectorAll('[data-installer]');
  if(dejaInstallee){ document.addEventListener('DOMContentLoaded', () => liens().forEach(l => l.hidden = true)); return; }

  const CLE = 'cadence-pwa-masque', DELAI = 14 * 86400000;
  const masque = () => { try{ const t = Number(localStorage.getItem(CLE)); return t > 1 && Date.now() - t < DELAI; }catch(e){ return false; } };   // « 1 » (ancien refus définitif) est ignoré
  const retenir = () => { try{ localStorage.setItem(CLE, String(Date.now())); }catch(e){} };

  const ios = /iphone|ipad|ipod/i.test(ua) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);   // iPadOS se présente comme un Mac
  const integre = /instagram|fban|fbav|fb_iab|line\/|tiktok|snapchat|micromessenger|twitter/i.test(ua);
  const android = /android/i.test(ua);
  let invite = null, bandeauOuvert = null;

  function bandeau(texte, action, definitif){
    // Pas par-dessus le bandeau cookies : on attend que le visiteur ait fait son choix.
    if(document.getElementById('mirrio-cookies')){ setTimeout(() => bandeau(texte, action, definitif), 2000); return; }
    if(bandeauOuvert) bandeauOuvert.remove();
    const b = document.createElement('div');
    b.setAttribute('role', 'dialog'); b.setAttribute('aria-label', 'Installer Mirrio');
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:calc(12px + env(safe-area-inset-bottom, 0px));z-index:9999;max-width:420px;margin:0 auto;background:#1C2333;color:#F5F1E7;' +
      'border-radius:14px;padding:12px 14px;display:flex;align-items:center;gap:10px;font:14px/1.4 Inter,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.3);';
    b.innerHTML = '<span style="flex:1"></span>';
    b.firstChild.textContent = texte;
    if(action){
      const ok = document.createElement('button');
      ok.textContent = 'Installer';
      ok.style.cssText = 'background:#E2A63D;color:#1C2333;border:none;border-radius:8px;padding:10px 16px;min-height:44px;font:600 14px Inter,Arial,sans-serif;cursor:pointer;';
      ok.onclick = () => { action(); b.remove(); bandeauOuvert = null; };
      b.appendChild(ok);
    }
    const x = document.createElement('button');
    x.textContent = '×'; x.setAttribute('aria-label', 'Fermer');
    x.style.cssText = 'background:none;border:none;color:#F5F1E7;font-size:24px;cursor:pointer;line-height:1;min-width:44px;min-height:44px;';
    x.onclick = () => { b.remove(); bandeauOuvert = null; if(!definitif) retenir(); };
    b.appendChild(x);
    document.body.appendChild(b); bandeauOuvert = b;
  }

  const consigne = () => {
    if(integre) return 'Pour installer Mirrio, ouvrez cette page dans votre navigateur (menu ⋯ ou Partager, puis « Ouvrir dans Safari » ou « Ouvrir dans Chrome »).';
    if(ios) return 'Pour installer : touchez Partager (le carré avec une flèche), puis « Sur l’écran d’accueil ».';
    if(android) return 'Pour installer : ouvrez le menu ⋮ de votre navigateur, puis « Installer l’application » ou « Ajouter à l’écran d’accueil ».';
    return 'Pour installer : cliquez sur l’icône d’installation dans la barre d’adresse de votre navigateur (Chrome, Edge).';
  };

  // Android / Chrome / Edge : invite native différée.
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); invite = e;
    if(!masque()) bandeau('Installer Mirrio sur votre écran d’accueil', () => { invite.prompt(); });
  });
  window.addEventListener('appinstalled', () => { if(bandeauOuvert) bandeauOuvert.remove(); liens().forEach(l => l.hidden = true); });

  // iPhone / iPad (tous navigateurs) et navigateurs intégrés : on explique le geste, une fois toutes les deux semaines.
  if((ios || integre) && !masque()){
    window.addEventListener('load', () => setTimeout(() => { if(!bandeauOuvert) bandeau(consigne()); }, 2500));
  }

  // Lien « Installer l'application » : toujours possible, ne dépend d'aucun événement ni d'un refus passé.
  document.addEventListener('click', e => {
    const l = e.target.closest && e.target.closest('[data-installer]');
    if(!l) return;
    e.preventDefault();
    if(invite) invite.prompt(); else bandeau(consigne(), null, true);
  });
})();
