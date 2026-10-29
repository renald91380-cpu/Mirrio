// Mirrio Caisse : mise en page du rapport d'audit technique ISCA (Inaltérabilité, Sécurisation, Conservation, Archivage) renvoyé par
// la fonction SQL caisse_audit_isca(). Partagé par l'écran de caisse (rapport imprimable) et la page d'attestation (annexe).
const esc = v => String(v == null ? '' : v).replace(/[&<>"']/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;', "'":'&#39;' }[c]));
export const CRITERES = { I:'Inaltérabilité', S:'Sécurisation', C:'Conservation', A:'Archivage' };
const jour = d => new Date(d).toLocaleString('fr-FR', { day:'2-digit', month:'2-digit', year:'numeric', hour:'2-digit', minute:'2-digit' });

export function htmlRapport(audit, nomSalon){
  const r = audit.resume || {};
  const groupes = Object.keys(CRITERES).map(k => {
    const l = (audit.controles || []).filter(c => c.critere === k);
    return `<h3>${CRITERES[k]} <small>(${l.filter(c => c.ok === true).length} conforme${l.filter(c => c.ok === true).length > 1 ? 's' : ''} sur ${l.length})</small></h3>
      <table>${l.map(c => `<tr><td class="e ${c.ok === true ? 'ok' : c.ok === false ? 'ko' : 'av'}">${c.ok === true ? 'Conforme' : c.ok === false ? 'ANOMALIE' : 'À vérifier'}</td><td><b>${esc(c.code)}</b> ${esc(c.libelle)}<br><span>${esc(c.detail)}</span></td></tr>`).join('')}</table>`;
  }).join('');
  return `<h1>Rapport d'audit technique ISCA</h1>
    <p>${esc(audit.logiciel)} version ${esc(audit.version)} · salon : ${esc(nomSalon || '')} · généré le ${esc(jour(audit.genere_le))}</p>
    <p class="r"><b>${r.conformes || 0}</b> contrôle(s) conforme(s) · <b class="${r.anomalies ? 'ko' : ''}">${r.anomalies || 0}</b> anomalie(s) · <b>${r.a_verifier || 0}</b> à vérifier hors du logiciel</p>
    ${groupes}
    <p class="note">Autocontrôle réalisé par le logiciel sur les données réelles du salon. Il ne remplace pas l'audit d'un organisme accrédité ; il établit l'état des quatre critères (inaltérabilité, sécurisation, conservation, archivage) à la date indiquée.</p>`;
}

export const STYLE_RAPPORT = `body{ font:14px/1.5 system-ui,-apple-system,'Segoe UI',sans-serif; color:#101216; margin:0; padding:28px; max-width:820px; }
  h1{ font-size:24px; margin:0 0 4px; } h3{ font-size:17px; margin:22px 0 6px; border-bottom:2px solid #101216; padding-bottom:4px; } h3 small{ font-weight:400; color:#555; }
  table{ width:100%; border-collapse:collapse; } td{ padding:6px 8px; border-bottom:1px solid #ddd; vertical-align:top; } td span{ color:#555; font-size:12.5px; }
  td.e{ width:92px; font-weight:700; font-size:12px; text-transform:uppercase; } td.ok{ color:#1F6B49; } td.ko{ color:#B3402A; } td.av{ color:#8A6431; } b.ko{ color:#B3402A; }
  .r{ background:#F5F5F3; padding:10px 14px; border-radius:10px; } .note{ color:#555; font-size:12.5px; margin-top:22px; }
  @media print{ body{ padding:0; } }`;
