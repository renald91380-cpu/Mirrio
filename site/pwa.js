// Cadence — enregistrement du service worker et invitation à installer l'app.
(function(){
  if('serviceWorker' in navigator){
    window.addEventListener('load', () => navigator.serviceWorker.register('/sw.js').catch(() => {}));
  }
  const dejaInstallee = window.matchMedia('(display-mode: standalone)').matches || navigator.standalone;
  if(dejaInstallee) return;
  try{ if(localStorage.getItem('cadence-pwa-masque')) return; }catch(e){}

  const ios = /iphone|ipad|ipod/i.test(navigator.userAgent);
  let invite = null;

  function bandeau(texte, action){
    const b = document.createElement('div');
    b.setAttribute('role', 'dialog');
    b.style.cssText = 'position:fixed;left:12px;right:12px;bottom:12px;z-index:9999;max-width:420px;margin:0 auto;background:#1C2333;color:#F5F1E7;' +
      'border-radius:12px;padding:12px 14px;display:flex;align-items:center;gap:10px;font:14px/1.4 Inter,Arial,sans-serif;box-shadow:0 8px 28px rgba(0,0,0,.3);';
    b.innerHTML = '<span style="flex:1"></span>';
    b.firstChild.textContent = texte;
    if(action){
      const ok = document.createElement('button');
      ok.textContent = 'Installer';
      ok.style.cssText = 'background:#E2A63D;color:#1C2333;border:none;border-radius:8px;padding:8px 14px;font:600 14px Inter,Arial,sans-serif;cursor:pointer;';
      ok.onclick = () => { action(); b.remove(); };
      b.appendChild(ok);
    }
    const x = document.createElement('button');
    x.textContent = '×'; x.setAttribute('aria-label', 'Fermer');
    x.style.cssText = 'background:none;border:none;color:#F5F1E7;font-size:22px;cursor:pointer;line-height:1;';
    x.onclick = () => { b.remove(); try{ localStorage.setItem('cadence-pwa-masque', '1'); }catch(e){} };
    b.appendChild(x);
    document.body.appendChild(b);
  }

  // Android / Chrome / Edge : invite native différée.
  window.addEventListener('beforeinstallprompt', e => {
    e.preventDefault(); invite = e;
    bandeau('Installer Cadence sur votre écran d’accueil', () => { invite.prompt(); });
  });

  // iOS Safari n'a pas d'invite : on explique le geste, une fois.
  if(ios && /safari/i.test(navigator.userAgent) && !/crios|fxios/i.test(navigator.userAgent)){
    window.addEventListener('load', () => setTimeout(
      () => bandeau('Pour installer : touchez Partager, puis « Sur l’écran d’accueil ».'), 2500));
  }
})();
