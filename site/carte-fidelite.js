/* Mirrio — rendu de la carte de fidélité (même dessin que le pass Apple Wallet / Google Wallet) : UN seul code pour la page du client (fidelite.html)
 * et l'aperçu en direct de l'écran du salon (fidelite-salon.html), pour que ce que le salon règle soit exactement ce que reçoit son client.
 *
 *   MIRRIO_CARTE.html(c, { qr: true })  -> HTML de la carte : logo + nom du salon + STATUT, bandeau image avec une pastille par tampon,
 *                                          MEMBRE / TAMPONS (ou POINTS) / VISITES, QR code et code court.
 *   MIRRIO_CARTE.css                    -> la feuille de style à poser une fois dans la page.
 *   MIRRIO_CARTE.remplirQr(racine, url) -> dessine le QR dans l'élément .pass-qr (bibliothèque qrcode-generator, chargée à la demande).
 *
 * `c` est la réponse de /api/fidelite : salon, logo, image, couleur_fond, couleur_texte, niveau, visites, prenom, points, seuil, mode, points_par_visite, code.
 * Les textes passent par I18N.t() (quatre langues) ; tout ce qui vient du salon est échappé, les images doivent être en https.
 */
(function(){
  'use strict';
  var esc = function(v){ return String(v == null ? '' : v).replace(/[&<>"']/g, function(ch){ return { '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[ch]; }); };
  var T = function(fr){ var a = Array.prototype.slice.call(arguments, 1); return window.I18N ? window.I18N.t.apply(window.I18N, [fr].concat(a)) : fr.replace(/\{(\d+)\}/g, function(_, n){ return a[+n]; }); };
  var hex = function(h, repli){ return /^#[0-9a-fA-F]{6}$/.test(h || '') ? h : repli; };
  var clair = function(h){ var r = parseInt(h.substr(1, 2), 16), g = parseInt(h.substr(3, 2), 16), b = parseInt(h.substr(5, 2), 16); return (0.299 * r + 0.587 * g + 0.114 * b) > 150; };
  var https = function(u){ return /^https:\/\//.test(u || '') || /^img\//.test(u || '') ? u : ''; };

  function couleurs(c){
    var fond = hex(c.couleur_fond, '#101216');
    return { fond: fond, texte: hex(c.couleur_texte, clair(fond) ? '#101216' : '#FFFFFF'), plein: clair(fond) ? '#101216' : '#FFFFFF' };
  }
  function pastilles(c){
    var tampons = c.mode === 'visite' && Number(c.points_par_visite) === 1 && c.seuil <= 12;
    var n = tampons ? c.seuil : 10, pleins = tampons ? Math.min(c.points, c.seuil) : Math.round(Math.min(1, c.points / c.seuil) * 10), h = '';
    for(var i = 0; i < n; i++) h += '<i class="' + (i < pleins ? 'p' : '') + '"></i>';
    return { html: h, libelle: tampons ? T('{0} tampons sur {1}', pleins, c.seuil) : T('{0} points sur {1}', c.points, c.seuil), tampons: tampons };
  }

  function html(c, o){
    o = o || {}; var col = couleurs(c), pa = pastilles(c), logo = https(c.logo), image = https(c.image);
    var fondBandeau = image ? 'background-image:url(&quot;' + esc(image) + '&quot;)' : '';
    return '<article class="pass" style="--pf:' + col.fond + ';--pt:' + col.texte + ';--pp:' + col.plein + '" aria-label="' + esc(T('Ma carte de fidélité')) + '">' +
      '<header class="pass-tete">' + (logo ? '<img src="' + esc(logo) + '" alt="">' : '') + '<span class="pass-nom notranslate" translate="no">' + esc(c.salon) + '</span>' +
        (c.niveau ? '<div class="pass-statut"><small>' + esc(T('STATUT')) + '</small><b class="notranslate" translate="no">' + esc(c.niveau) + '</b></div>' : '') + '</header>' +
      '<div class="pass-bandeau' + (image ? ' avec-image' : '') + '" style="' + fondBandeau + '"><div class="pass-pastilles" role="img" aria-label="' + esc(pa.libelle) + '">' + pa.html + '</div></div>' +
      '<div class="pass-champs"><div><small>' + esc(T('MEMBRE')) + '</small><b class="notranslate" translate="no">' + esc(c.prenom || T('Client')) + '</b></div>' +
        '<div><small>' + esc(pa.tampons ? T('TAMPONS') : T('POINTS')) + '</small><b dir="ltr">' + esc(c.points) + ' / ' + esc(c.seuil) + '</b></div>' +
        (c.visites != null ? '<div class="d"><small>' + esc(T('VISITES')) + '</small><b dir="ltr">' + esc(c.visites) + '</b></div>' : '') + '</div>' +
      (o.qr === false ? '' : '<div class="pass-qrbox"><div class="pass-qr" role="img" aria-label="' + esc(T('QR code de votre carte')) + '"></div>' + (c.code ? '<code dir="ltr">' + esc(c.code) + '</code>' : '') + '</div>') +
    '</article>';
  }

  var css = '.pass{ background:var(--pf); color:var(--pt); border-radius:26px; overflow:hidden; border:1px solid rgba(255,255,255,.14); box-shadow:0 18px 44px rgba(0,0,0,.28); max-width:460px; margin:0 auto; }' +
    '.pass-tete{ display:flex; align-items:center; gap:12px; padding:16px 20px; }' +
    '.pass-tete img{ height:46px; max-width:120px; object-fit:contain; flex:none; }' +
    '.pass-nom{ font:700 15px "Bricolage Grotesque", system-ui, sans-serif; letter-spacing:.01em; text-transform:uppercase; flex:1; min-width:0; line-height:1.15; }' +
    '.pass-statut{ text-align:end; flex:none; } .pass-statut small, .pass-champs small{ display:block; font:600 11.5px "Geist", system-ui, sans-serif; letter-spacing:.07em; opacity:.62; } .pass-statut b{ font:500 24px "Bricolage Grotesque", system-ui, sans-serif; }' +
    '.pass-bandeau{ position:relative; aspect-ratio:750 / 246; background:linear-gradient(135deg, color-mix(in srgb, var(--pt) 16%, var(--pf)), var(--pf)); background-size:cover; background-position:center; }' +
    '.pass-bandeau::after{ content:""; position:absolute; inset:0; background:linear-gradient(to bottom, transparent 40%, var(--pf) 118%); }' +
    '.pass-pastilles{ position:absolute; z-index:1; left:4%; right:4%; bottom:9%; display:flex; gap:1.2%; } .pass-pastilles i{ flex:1; height:clamp(8px, 2.4vw, 12px); border-radius:99px; background:rgba(110,110,116,.62); } .pass-pastilles i.p{ background:var(--pp); }' +
    '.pass-champs{ display:grid; grid-template-columns:1fr auto 1fr; gap:10px; padding:14px 20px 8px; } .pass-champs div:nth-child(2){ text-align:center; } .pass-champs .d{ text-align:end; } .pass-champs b{ font:500 26px "Bricolage Grotesque", system-ui, sans-serif; display:block; overflow-wrap:anywhere; } .pass-champs div:first-child b{ font-size:23px; }' +
    '.pass-qrbox{ background:#fff; color:#111; margin:18px auto 22px; padding:14px 14px 8px; border-radius:16px; width:min(236px, 72%); text-align:center; } .pass-qr svg{ width:100%; height:auto; display:block; } .pass-qrbox code{ display:block; margin-top:6px; font:500 19px "Geist", ui-monospace, monospace; letter-spacing:.02em; }';

  var qrChargement = null;
  function chargerQr(){
    if(window.qrcode) return Promise.resolve(true);
    return qrChargement || (qrChargement = new Promise(function(res){ var s = document.createElement('script'); s.src = 'https://cdnjs.cloudflare.com/ajax/libs/qrcode-generator/1.4.4/qrcode.min.js'; s.onload = function(){ res(!!window.qrcode); }; s.onerror = function(){ res(false); }; document.head.appendChild(s); }));
  }
  function remplirQr(racine, url){
    var z = (racine || document).querySelector('.pass-qr'); if(!z) return Promise.resolve();
    return chargerQr().then(function(ok){ if(!ok){ z.innerHTML = '<small>' + esc(url) + '</small>'; return; } var q = window.qrcode(0, 'M'); q.addData(url); q.make(); z.innerHTML = q.createSvgTag({ cellSize:6, margin:0, scalable:true }); });
  }

  var st = document.createElement('style'); st.id = 'mirrio-carte-css'; st.textContent = css; document.head.appendChild(st);
  window.MIRRIO_CARTE = { html: html, css: css, couleurs: couleurs, remplirQr: remplirQr };
})();
