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

const INK = '#101216', AMBER = '#E2A63D', MUTED = '#6B7080', LINE = '#E6E6E1';
const SANS = "-apple-system,BlinkMacSystemFont,'Segoe UI',Roboto,Helvetica,Arial,sans-serif";
const MARQUE = "Cinzel,'Trajan Pro',Optima,Georgia,serif";

const repere = (label, valeur) => `<td valign="top" style="padding:0 8px 0 0;">
  <div style="font-size:11px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:${MUTED};margin-bottom:4px;">${esc(label)}</div>
  <div style="font-size:16px;font-weight:600;color:${INK};line-height:1.35;">${valeur}</div></td>`;

const rangee = (trois) => `<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="margin:0 0 6px;"><tr>${trois.map(([l, v]) => repere(l, v)).join('')}</tr></table>`;

const titreSection = t => `<div style="font-size:12px;font-weight:700;letter-spacing:.1em;text-transform:uppercase;color:${MUTED};margin:26px 0 10px;">${esc(t)}</div>`;

const bouton = (href, texte, fort) => `<a href="${esc(href)}" style="display:inline-block;margin:0 8px 10px 0;padding:14px 24px;border-radius:999px;text-decoration:none;font-weight:700;font-size:15px;${fort ? `background:${AMBER};color:${INK};` : `background:#F5F5F3;color:${INK};border:1px solid #D9D9D4;`}">${esc(texte)}</a>`;

// params : { salon, logoUrl, reference, titre, avec, adresse, debut, fin,
//            lignes:[{libelle, prix}], acompteDeduit, reste,
//            paiement:{ montant, date, moyen } | null,
//            boutons:[{href, texte, fort}], mention }
export function gabaritConfirmation(p){
  const initiale = esc((p.salon || '?').trim().charAt(0).toUpperCase());
  const monogramme = p.logoUrl && /^https:\/\//i.test(p.logoUrl)
    ? `<img src="${esc(p.logoUrl)}" width="88" height="88" alt="${esc(p.salon)}" style="display:block;border-radius:50%;border:5px solid #ffffff;background:#ffffff;object-fit:cover;">`
    : `<table role="presentation" cellpadding="0" cellspacing="0"><tr><td align="center" valign="middle" width="88" height="88" style="width:88px;height:88px;border-radius:50%;border:5px solid #ffffff;background:${INK};color:${AMBER};font-family:${MARQUE};font-size:36px;font-weight:700;">${initiale}</td></tr></table>`;

  const total = (p.lignes || []).reduce((t, l) => t + (Number(l.prix) || 0), 0);
  const lignes = (p.lignes || []).map(l => `<tr><td style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:15px;color:${INK};">${esc(l.libelle)}</td><td align="right" style="padding:8px 0;border-bottom:1px solid ${LINE};font-size:15px;color:${INK};white-space:nowrap;">${eur(l.prix)}</td></tr>`).join('');
  const ligneTotal = (label, valeur, fort) => `<tr><td style="padding:7px 0;font-size:${fort ? 16 : 14.5}px;${fort ? 'font-weight:700;' : `color:${MUTED};`}">${label}</td><td align="right" style="padding:7px 0;font-size:${fort ? 16 : 14.5}px;${fort ? 'font-weight:700;' : `color:${MUTED};`}white-space:nowrap;">${valeur}</td></tr>`;

  const resume = (p.lignes && p.lignes.length) ? `${titreSection('Résumé')}
    <table role="presentation" width="100%" cellpadding="0" cellspacing="0">${lignes}
      ${ligneTotal('Total', eur(total), true)}
      ${p.acompteDeduit > 0 ? ligneTotal('Acompte réglé par carte (déduit)', '− ' + eur(p.acompteDeduit)) : ''}
    </table>` : '';
  const reste = p.reste > 0 ? `<div style="margin:14px 0 0;padding:16px 18px;border-radius:14px;background:#FBEFD2;">
      <div style="font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#7A5200;">Reste à régler sur place</div>
      <div style="font-size:24px;font-weight:800;color:${INK};margin-top:2px;">${eur(p.reste)}</div>
      <div style="font-size:13.5px;color:#5B4A1E;margin-top:2px;">Le solde se règle au salon, en espèces ou par carte.</div></div>` : '';

  const paiement = p.paiement ? `${titreSection('Paiement')}${rangee([
      ['Montant payé', eur(p.paiement.montant)],
      ['Date du paiement', `${esc(fmt(p.paiement.date, { day: 'numeric', month: 'short', year: 'numeric' }))}<br><span style="font-weight:400;color:${MUTED};font-size:14px;">${esc(heure(p.paiement.date))}</span>`],
      ['Moyen de paiement', esc(p.paiement.moyen || 'Carte bancaire')]
    ])}` : '';

  return `<!doctype html>
<html lang="fr"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1.0"><meta name="color-scheme" content="light">
<title>${esc(p.titre)}</title></head>
<body style="margin:0;padding:0;background:#F5F5F3;">
<table role="presentation" width="100%" cellpadding="0" cellspacing="0" style="background:#F5F5F3;"><tr><td align="center" style="padding:28px 12px;">
  <table role="presentation" width="600" cellpadding="0" cellspacing="0" style="width:100%;max-width:600px;border-radius:24px;overflow:hidden;background:#ffffff;font-family:${SANS};color:${INK};">
    <tr><td align="center" bgcolor="${INK}" style="background:${INK};padding:30px 24px 22px;">
      <div style="font-family:${MARQUE};font-weight:700;font-size:15px;letter-spacing:.2em;text-transform:uppercase;color:#F5F5F3;">Mirrio<span style="color:${AMBER};">.</span></div>
    </td></tr>
    <tr><td align="center" bgcolor="#ffffff" style="background:${INK};background-image:linear-gradient(${INK} 50%, #ffffff 50%);padding:0;">
      <table role="presentation" cellpadding="0" cellspacing="0" align="center"><tr><td>${monogramme}</td></tr></table>
    </td></tr>
    <tr><td style="padding:8px 36px 34px;">
      <h1 style="margin:12px 0 4px;text-align:center;font-size:28px;line-height:1.15;letter-spacing:-.02em;color:${INK};">${esc(p.titre)}</h1>
      <div style="text-align:center;font-size:16px;color:${MUTED};">chez ${esc(p.salon)}</div>
      ${p.reference ? `<div style="text-align:center;font-size:13.5px;color:${MUTED};margin-top:6px;">Réservation n° ${esc(p.reference)}</div>` : ''}
      <div style="height:26px;"></div>
      ${rangee([
        ['Quand', `<span style="text-transform:capitalize;">${esc(fmt(p.debut, { weekday: 'long', day: 'numeric', month: 'long' }))}</span>`],
        ['Heure', `${esc(heure(p.debut))} - ${esc(heure(p.fin))}`],
        ['Avec', p.avec ? esc(p.avec) : 'L’équipe du salon']
      ])}
      ${p.adresse ? `<div style="font-size:14.5px;color:${MUTED};margin-top:10px;">${esc(p.adresse)}</div>` : ''}
      ${resume}
      ${reste}
      ${paiement}
      <div style="margin:28px 0 0;">${(p.boutons || []).map(b => bouton(b.href, b.texte, b.fort)).join('')}</div>
      <div style="font-size:12.5px;color:#8A8F9A;margin-top:20px;line-height:1.55;">${esc(p.mention || 'Vous pouvez annuler jusqu’à 24 h avant le rendez-vous. L’acompte réglé n’est pas remboursé en cas d’absence.')}</div>
    </td></tr>
  </table>
  <div style="font-family:${SANS};font-size:12px;color:#8A8F9A;margin-top:16px;">Envoyé via Mirrio, la réservation en ligne sans commission.</div>
</td></tr></table></body></html>`;
}
