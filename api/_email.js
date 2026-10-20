// Mirrio - gabarit d'email « confirmation de rendez-vous et de paiement » (module `_`, pas une route Vercel).
//
// Un seul email qui joue deux rôles : confirmer le rendez-vous ET servir de reçu de paiement.
// Structure (comme un reçu bancaire) : bandeau sombre, monogramme du salon, titre, trois repères
// (quand, heure, avec qui), résumé des prestations avec acompte déduit et reste à régler, détail du paiement
// (montant, date, moyen), boutons. HTML d'email : tableaux et styles en ligne uniquement.

const esc = s => String(s == null ? '' : s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');
const eur = n => new Intl.NumberFormat('fr-FR', { style: 'currency', currency: 'EUR' }).format(Number(n) || 0);
const fmt = (iso, opts) => new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', ...opts }).format(new Date(iso));
const heure = iso => {
  const p = Object.fromEntries(new Intl.DateTimeFormat('fr-FR', { timeZone: 'Europe/Paris', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(iso)).map(x => [x.type, x.value]));
  return p.minute === '00' ? `${Number(p.hour)}h` : `${Number(p.hour)}h${p.minute}`;
};

// Lien WhatsApp (wa.me) vers le salon, ou null si le numéro est absent ou invalide.
export function lienWhatsapp(brut, salon){
  let n = String(brut || '').replace(/[\s.\-()]/g, '');
  if(/^00\d+$/.test(n)) n = n.slice(2); else if(/^\+\d+$/.test(n)) n = n.slice(1);
  else if(/^0[1-9]\d{8}$/.test(n)) n = '33' + n.slice(1);
  if(!/^[1-9]\d{7,14}$/.test(n)) return null;
  return `https://wa.me/${n}?text=${encodeURIComponent(`Bonjour${salon ? ' ' + salon : ''}, j'ai une question sur mon rendez-vous.`)}`;
}

const INK = '#101216', AMBER = '#E2A63D', MUTED = '#6B7080', LINE = '#E6E6E1';
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
// Titres en romaine classique (empattements), cohérents avec le logotype gravé ; texte courant en sans.
const SERIF = "'Cormorant Garamond','Palatino Linotype',Palatino,'Book Antiqua',Georgia,serif";
const MARQUE = "Cinzel,'Trajan Pro',Optima,Georgia,serif";

const etiquette = t => `<div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:${MUTED};margin-bottom:5px;">${esc(t)}</div>`;
const titreSection = t => `<div style="margin:30px 0 12px;font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:${INK};border-bottom:1px solid ${INK};padding-bottom:8px;">${esc(t)}</div>`;
const bouton = (href, texte, fort) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 10px 0;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;${fort ? `background:${AMBER};color:${INK};` : `background:#F5F5F3;color:${INK};border:1px solid #D9D9D4;`}">${esc(texte)}</a>`;

// Ligne « carte de menu » : libellé, points de conduite, prix.
const ligneMenu = (libelle, prix, { fort = false, discret = false } = {}) => `<tr>
  <td style="padding:7px 0;font-size:${fort ? 17 : 15}px;${fort ? 'font-weight:700;' : ''}${discret ? `color:${MUTED};` : `color:${INK};`}white-space:nowrap;">${libelle}</td>
  <td style="padding:7px 8px 11px;width:100%;"><div style="border-bottom:2px dotted #CFCFC8;height:1px;line-height:1px;font-size:1px;">&nbsp;</div></td>
  <td align="right" style="padding:7px 0;font-size:${fort ? 17 : 15}px;${fort ? 'font-weight:700;' : ''}${discret ? `color:${MUTED};` : `color:${INK};`}white-space:nowrap;">${prix}</td></tr>`;

// params : { salon, logoUrl, reference, titre, avec, adresse, debut, fin,
//            lignes:[{libelle, prix}], acompteDeduit, reste,
//            paiement:{ montant, date, moyen } | null,
//            boutons:[{href, texte, fort}], mention }
export function gabaritConfirmation(p){
  const initiale = esc((p.salon || '?').trim().charAt(0).toUpperCase());
  const monogramme = p.logoUrl && /^https:\/\//i.test(p.logoUrl)
    ? `<img src="${esc(p.logoUrl)}" width="52" height="52" alt="" style="display:block;border-radius:50%;object-fit:cover;background:#fff;">`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="52" height="52" style="width:52px;height:52px;border-radius:50%;background:${INK};color:${AMBER};font-family:${MARQUE};font-size:22px;font-weight:700;">${initiale}</td></tr></table>`;

  const total = (p.lignes || []).reduce((t, l) => t + (Number(l.prix) || 0), 0);
  const resume = (p.lignes && p.lignes.length) ? `${titreSection('Résumé')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">
      ${p.lignes.map(l => ligneMenu(esc(l.libelle), eur(l.prix))).join('')}
      ${ligneMenu('Total', eur(total), { fort: true })}
      ${p.acompteDeduit > 0 ? ligneMenu('Acompte réglé par carte, déduit', '− ' + eur(p.acompteDeduit), { discret: true }) : ''}
    </table>` : '';
  const reste = p.reste > 0 ? `<div style="margin:16px 0 0;padding:18px 20px;border-radius:14px;background:#FBEFD2;">
      <div style="font-size:11px;font-weight:700;letter-spacing:.14em;text-transform:uppercase;color:#7A5200;">Reste à régler sur place</div>
      <div style="font-family:${SERIF};font-size:34px;font-weight:700;color:${INK};line-height:1.15;margin-top:2px;">${eur(p.reste)}</div>
      <div style="font-size:13.5px;color:#5B4A1E;margin-top:2px;">Le solde se règle au salon, en espèces ou par carte.</div></div>` : '';

  const paiement = p.paiement ? `${titreSection('Paiement')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
      <td valign="top" width="34%">${etiquette('Montant payé')}<div style="font-size:16px;font-weight:600;">${eur(p.paiement.montant)}</div></td>
      <td valign="top" width="36%">${etiquette('Le')}<div style="font-size:16px;font-weight:600;">${esc(fmt(p.paiement.date, { day: 'numeric', month: 'short', year: 'numeric' }))}</div><div style="font-size:13.5px;color:${MUTED};">${esc(heure(p.paiement.date))}</div></td>
      <td valign="top" width="30%">${etiquette('Moyen')}<div style="font-size:16px;font-weight:600;">${esc(p.paiement.moyen || 'Carte bancaire')}</div></td>
    </tr></table>` : '';

  const mois = fmt(p.debut, { month: 'short' }).replace('.', '').toUpperCase();
  const jourNum = fmt(p.debut, { day: 'numeric' });
  const jourSem = fmt(p.debut, { weekday: 'long' });

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light">
<title>${esc(p.titre)}</title></head>
<body style="margin:0;padding:0;background:#F5F5F3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F3;"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-radius:24px;overflow:hidden;background:#ffffff;font-family:${SANS};color:${INK};">
    <tr><td bgcolor="${INK}" style="background:${INK};padding:22px 32px;">
      <table role="presentation" width="100%" cellpadding="0" cellspacing="0"><tr>
        <td style="font-family:${MARQUE};font-weight:700;font-size:16px;letter-spacing:.2em;text-transform:uppercase;color:#F5F5F3;">Mirrio<span style="color:${AMBER};">.</span></td>
        <td align="right" style="font-size:12px;letter-spacing:.08em;color:#A3A8B3;">${p.reference ? 'N° ' + esc(p.reference) : ''}</td>
      </tr></table>
    </td></tr>
    <tr><td style="height:4px;line-height:4px;font-size:4px;background:${AMBER};">&nbsp;</td></tr>
    <tr><td style="padding:34px 36px 36px;">
      <table role="presentation" cellpadding="0" cellspacing="0"><tr>
        <td valign="middle" style="padding-right:14px;">${monogramme}</td>
        <td valign="middle"><div style="font-size:11px;font-weight:700;letter-spacing:.16em;text-transform:uppercase;color:#A1700A;">${esc(p.titre)}</div>
          <div style="font-family:${SERIF};font-size:32px;font-weight:700;line-height:1.1;color:${INK};margin-top:2px;">${esc(p.salon)}</div></td>
      </tr></table>

      <table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin-top:26px;"><tr>
        <td valign="top" width="92" style="width:92px;"><table role="presentation" width="92" cellpadding="0" cellspacing="0" style="border-radius:16px;overflow:hidden;background:${INK};"><tr><td align="center" style="padding:12px 0 14px;">
          <div style="font-size:11px;font-weight:700;letter-spacing:.2em;color:${AMBER};">${esc(mois)}</div>
          <div style="font-family:${SERIF};font-size:46px;font-weight:700;line-height:1;color:#ffffff;margin:2px 0;">${esc(jourNum)}</div>
          <div style="font-size:12px;letter-spacing:.06em;color:#A3A8B3;text-transform:capitalize;">${esc(jourSem)}</div>
        </td></tr></table></td>
        <td valign="top" style="padding-left:20px;">
          <div style="margin-bottom:12px;">${etiquette('Heure')}<div style="font-size:19px;font-weight:700;">${esc(heure(p.debut))} - ${esc(heure(p.fin))}</div></div>
          <div style="margin-bottom:${p.adresse ? 12 : 0}px;">${etiquette('Avec')}<div style="font-size:16px;font-weight:600;">${p.avec ? esc(p.avec) : 'L’équipe du salon'}</div></div>
          ${p.adresse ? `<div>${etiquette('Adresse')}<div style="font-size:14.5px;color:${INK};line-height:1.4;">${esc(p.adresse)}</div></div>` : ''}
        </td>
      </tr></table>

      ${resume}
      ${reste}
      ${paiement}
      <div style="margin:30px 0 0;">${(p.boutons || []).map(b => bouton(b.href, b.texte, b.fort)).join('')}</div>
      <div style="font-size:12.5px;color:#8A8F9A;margin-top:18px;line-height:1.55;">${esc(p.mention || 'Vous pouvez annuler jusqu’à 24 h avant le rendez-vous. L’acompte réglé n’est pas remboursé en cas d’absence.')}</div>
    </td></tr>
  </table>
  <div style="font-family:${SANS};font-size:12px;color:#8A8F9A;margin-top:16px;">Envoyé via Mirrio, la réservation en ligne sans commission.</div>
</td></tr></table></body></html>`;
}
