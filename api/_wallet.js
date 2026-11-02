// Mirrio — cartes de fidélité pour Apple Wallet (.pkpass) et Google Wallet, sans dépendance npm.
//
//   lienGoogleWallet(carte, site)   -> https://pay.google.com/gp/v/save/<jwt>       (JWT RS256 signé avec le compte de service Google)
//   majGoogleWallet(carte, site)    -> met à jour le solde d'un pass déjà ajouté (meilleur effort)
//   construirePkpass(carte, site)   -> Buffer .pkpass (zip + manifeste SHA-1 + signature PKCS#7 détachée)
//   walletConfigure()               -> { google, apple }
//
// Variables d'environnement (sans elles, les boutons « Ajouter au Wallet » sont masqués et l'API répond 501) :
//   Google : GOOGLE_WALLET_ISSUER_ID, GOOGLE_WALLET_SA_EMAIL, GOOGLE_WALLET_SA_KEY (clé privée PEM du compte de service ; les « \n » littéraux sont acceptés)
//   Apple  : APPLE_PASS_TYPE_ID (ex. pass.fr.mirrio.fidelite), APPLE_TEAM_ID, APPLE_PASS_CERT (certificat Pass Type ID, PEM),
//            APPLE_PASS_KEY (sa clé privée, PEM), APPLE_WWDR_CERT (certificat intermédiaire Apple WWDR, PEM)
//
// Le contenu d'une carte (prénom, solde, QR) vient toujours de la base (fidelite_publique), jamais du navigateur.
// La signature PKCS#7 est écrite à la main (DER) : Node n'a pas d'API CMS. Vérifiée avec `openssl smime -verify` (voir scripts/test-wallet.mjs) ;
// PAS testée sur un iPhone ni sur un compte Apple réel (il faut un compte développeur payant et un certificat Pass Type ID).

import crypto from 'node:crypto';
import { IMAGES } from './_wallet-assets.js';

const E = process.env;
const pem = v => String(v || '').replace(/\\n/g, '\n').trim();
export function walletConfigure(){
  return {
    google: !!(E.GOOGLE_WALLET_ISSUER_ID && E.GOOGLE_WALLET_SA_EMAIL && E.GOOGLE_WALLET_SA_KEY),
    apple: !!(E.APPLE_PASS_TYPE_ID && E.APPLE_TEAM_ID && E.APPLE_PASS_CERT && E.APPLE_PASS_KEY && E.APPLE_WWDR_CERT)
  };
}

const COULEUR_DEFAUT = '#101216';
const hexOk = c => /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : COULEUR_DEFAUT;
const rgb = c => { const h = hexOk(c).slice(1); return [0, 2, 4].map(i => parseInt(h.slice(i, i + 2), 16)); };
const clair = c => { const [r, g, b] = rgb(c); return (0.299 * r + 0.587 * g + 0.114 * b) > 150; };
const unite = c => c.mode === 'visite' ? 'tampons' : 'points';
const texteRecompense = c => c.recompense_type === 'remise_pct' ? `${c.recompense_pct} % de remise` : (c.recompense_libelle || 'Une récompense');
export const urlCarte = (c, site) => `${site}/fidelite.html?t=${c.token}`;

// ------------------------------------------------------------------------------------------------ Google Wallet
const b64u = b => Buffer.from(b).toString('base64url');
function jwtRs256(charge){
  const tete = b64u(JSON.stringify({ alg:'RS256', typ:'JWT' })), corps = b64u(JSON.stringify(charge));
  const sig = crypto.createSign('RSA-SHA256').update(`${tete}.${corps}`).sign(pem(E.GOOGLE_WALLET_SA_KEY)).toString('base64url');
  return `${tete}.${corps}.${sig}`;
}
const classeId = c => `${E.GOOGLE_WALLET_ISSUER_ID}.mirrio_${String(c.owner_id).replace(/-/g, '')}`;
const objetId = c => `${E.GOOGLE_WALLET_ISSUER_ID}.${c.token}`;

function classeGoogle(c, site){
  return {
    id: classeId(c), issuerName: c.salon, programName: `Fidélité ${c.salon}`.slice(0, 60),
    programLogo: { sourceUri: { uri: /^https:\/\//.test(c.logo || '') ? c.logo : `${site}/icons/icon-512.png` }, contentDescription: { defaultValue: { language:'fr', value:c.salon } } },
    hexBackgroundColor: hexOk(c.couleur), reviewStatus: 'UNDER_REVIEW', countryCode: 'FR'
  };
}
function objetGoogle(c, site){
  return {
    id: objetId(c), classId: classeId(c), state: 'ACTIVE', accountId: c.token.slice(0, 16), accountName: c.prenom || 'Client',
    loyaltyPoints: { label: c.mode === 'visite' ? 'Tampons' : 'Points', balance: { int: c.points } },
    secondaryLoyaltyPoints: { label: 'Récompense à', balance: { string: `${c.seuil} ${unite(c)}` } },
    barcode: { type: 'QR_CODE', value: urlCarte(c, site), alternateText: 'Carte de fidélité' },
    textModulesData: [{ id: 'recompense', header: 'Récompense', body: texteRecompense(c) }],
    linksModuleData: { uris: [{ uri: urlCarte(c, site), description: 'Ma carte en ligne', id: 'carte' }] }
  };
}
export function lienGoogleWallet(c, site){
  const origine = new URL(site).origin;
  const jwt = jwtRs256({ iss: E.GOOGLE_WALLET_SA_EMAIL, aud: 'google', typ: 'savetowallet', iat: Math.floor(Date.now() / 1000), origins: [origine],
    payload: { loyaltyClasses: [classeGoogle(c, site)], loyaltyObjects: [objetGoogle(c, site)] } });
  return `https://pay.google.com/gp/v/save/${jwt}`;
}
// Le pass déjà ajouté ne se met pas à jour tout seul : on pousse le nouveau solde via l'API Wallet (meilleur effort, jamais bloquant).
export async function majGoogleWallet(c, site){
  const now = Math.floor(Date.now() / 1000);
  const assertion = jwtRs256({ iss: E.GOOGLE_WALLET_SA_EMAIL, scope: 'https://www.googleapis.com/auth/wallet_object.issuer', aud: 'https://oauth2.googleapis.com/token', iat: now, exp: now + 3000 });
  const t = await fetch('https://oauth2.googleapis.com/token', { method:'POST', headers:{ 'Content-Type':'application/x-www-form-urlencoded' },
    body: new URLSearchParams({ grant_type:'urn:ietf:params:oauth:grant-type:jwt-bearer', assertion }) });
  if(!t.ok) return false;
  const { access_token } = await t.json();
  const r = await fetch(`https://walletobjects.googleapis.com/walletobjects/v1/loyaltyObject/${encodeURIComponent(objetId(c))}`, {
    method:'PATCH', headers:{ Authorization:`Bearer ${access_token}`, 'Content-Type':'application/json' },
    body: JSON.stringify({ loyaltyPoints: { label:'Points', balance:{ int: c.points } } }) });
  return r.ok;   // 404 : la personne n'a pas (encore) ajouté la carte à son Wallet
}

// ------------------------------------------------------------------------------------------------ Apple Wallet (.pkpass)
// DER minimal
const lon = n => n < 128 ? Buffer.from([n]) : n < 256 ? Buffer.from([0x81, n]) : Buffer.from([0x82, n >> 8, n & 255]);
const tlv = (tag, ...parts) => { const corps = Buffer.concat(parts); return Buffer.concat([Buffer.from([tag]), lon(corps.length), corps]); };
const seq = (...p) => tlv(0x30, ...p), set = (...p) => tlv(0x31, ...p);
const oid = s => { const n = s.split('.').map(Number); const o = [n[0] * 40 + n[1]]; for(const v of n.slice(2)){ const b = [v & 127]; let x = v >> 7; while(x){ b.unshift((x & 127) | 128); x >>= 7; } o.push(...b); } return tlv(0x06, Buffer.from(o)); };
const octets = b => tlv(0x04, b), nul = () => Buffer.from([5, 0]), entier1 = () => tlv(2, Buffer.from([1]));
const OID = { data:'1.2.840.113549.1.7.1', signedData:'1.2.840.113549.1.7.2', contentType:'1.2.840.113549.1.9.3', messageDigest:'1.2.840.113549.1.9.4', signingTime:'1.2.840.113549.1.9.5', sha1:'1.3.14.3.2.26', rsa:'1.2.840.113549.1.1.1' };
// Lit un élément DER à la position p : { tag, debut, fin (exclue), contenu }
function lire(buf, p){ const tag = buf[p]; let l = buf[p + 1], q = p + 2; if(l & 128){ const n = l & 127; l = 0; for(let i = 0; i < n; i++) l = l * 256 + buf[q++]; } return { tag, debut:p, contenu:q, fin:q + l }; }
// Émetteur et numéro de série d'un certificat X.509 (DER brut, réutilisé tel quel dans la signature).
function emetteurEtSerie(der){
  const cert = lire(der, 0), tbs = lire(der, cert.contenu); let p = tbs.contenu;
  let e = lire(der, p); if(e.tag === 0xA0){ p = e.fin; e = lire(der, p); }   // [0] version
  const serie = e; p = serie.fin; const algo = lire(der, p); p = algo.fin; const emetteur = lire(der, p);
  return { serie: der.subarray(serie.debut, serie.fin), emetteur: der.subarray(emetteur.debut, emetteur.fin) };
}
const sha1 = b => crypto.createHash('sha1').update(b).digest();
const utcTime = d => { const p = n => String(n).padStart(2, '0'); return tlv(0x17, Buffer.from(`${String(d.getUTCFullYear()).slice(2)}${p(d.getUTCMonth() + 1)}${p(d.getUTCDate())}${p(d.getUTCHours())}${p(d.getUTCMinutes())}${p(d.getUTCSeconds())}Z`)); };

// Signature PKCS#7 (CMS SignedData) détachée de `contenu`, avec la chaîne [certificat du pass, certificat WWDR].
export function signerPkcs7(contenu, certPem, clePem, wwdrPem, maintenant = new Date()){
  const cert = new crypto.X509Certificate(certPem), wwdr = new crypto.X509Certificate(wwdrPem);
  const { serie, emetteur } = emetteurEtSerie(cert.raw);
  const attr = (o, valeur) => seq(oid(o), set(valeur));
  const attributs = [attr(OID.contentType, oid(OID.data)), attr(OID.signingTime, utcTime(maintenant)), attr(OID.messageDigest, octets(sha1(contenu)))]
    .sort(Buffer.compare);   // DER : les éléments d'un SET sont triés
  const aSigner = tlv(0x31, ...attributs);
  const signature = crypto.createSign('RSA-SHA1').update(aSigner).sign(clePem);
  const algoSha1 = seq(oid(OID.sha1), nul());
  const signataire = seq(entier1(), seq(emetteur, serie), algoSha1, tlv(0xA0, ...attributs), seq(oid(OID.rsa), nul()), octets(signature));
  const signedData = seq(entier1(), set(algoSha1), seq(oid(OID.data)), tlv(0xA0, cert.raw, wwdr.raw), set(signataire));
  return seq(oid(OID.signedData), tlv(0xA0, signedData));
}

// ZIP sans compression (méthode « stored »), suffisant pour un .pkpass.
const TABLE_CRC = (() => { const t = []; for(let n = 0; n < 256; n++){ let c = n; for(let k = 0; k < 8; k++) c = c & 1 ? 0xEDB88320 ^ (c >>> 1) : c >>> 1; t.push(c >>> 0); } return t; })();
const crc32 = b => { let c = 0xFFFFFFFF; for(let i = 0; i < b.length; i++) c = TABLE_CRC[(c ^ b[i]) & 255] ^ (c >>> 8); return (c ^ 0xFFFFFFFF) >>> 0; };
export function zipper(fichiers){
  const locaux = [], centraux = []; let decalage = 0;
  const d = new Date(), heure = (d.getHours() << 11) | (d.getMinutes() << 5) | (d.getSeconds() >> 1), jour = ((d.getFullYear() - 1980) << 9) | ((d.getMonth() + 1) << 5) | d.getDate();
  for(const [nom, contenu] of Object.entries(fichiers)){
    const n = Buffer.from(nom), crc = crc32(contenu), h = Buffer.alloc(30);
    h.writeUInt32LE(0x04034b50, 0); h.writeUInt16LE(20, 4); h.writeUInt16LE(0x0800, 6); h.writeUInt16LE(0, 8); h.writeUInt16LE(heure, 10); h.writeUInt16LE(jour, 12);
    h.writeUInt32LE(crc, 14); h.writeUInt32LE(contenu.length, 18); h.writeUInt32LE(contenu.length, 22); h.writeUInt16LE(n.length, 26);
    const c = Buffer.alloc(46);
    c.writeUInt32LE(0x02014b50, 0); c.writeUInt16LE(20, 4); c.writeUInt16LE(20, 6); c.writeUInt16LE(0x0800, 8); c.writeUInt16LE(heure, 12); c.writeUInt16LE(jour, 14);
    c.writeUInt32LE(crc, 16); c.writeUInt32LE(contenu.length, 20); c.writeUInt32LE(contenu.length, 24); c.writeUInt16LE(n.length, 28); c.writeUInt32LE(decalage, 42);
    locaux.push(h, n, contenu); centraux.push(c, n); decalage += 30 + n.length + contenu.length;
  }
  const centre = Buffer.concat(centraux), fin = Buffer.alloc(22);
  fin.writeUInt32LE(0x06054b50, 0); fin.writeUInt16LE(centraux.length / 2, 8); fin.writeUInt16LE(centraux.length / 2, 10); fin.writeUInt32LE(centre.length, 12); fin.writeUInt32LE(decalage, 16);
  return Buffer.concat([...locaux, centre, fin]);
}

export function contenuPass(c, site, ids){
  const fond = hexOk(c.couleur), texte = clair(fond) ? [16, 18, 22] : [255, 255, 255], f = a => `rgb(${a.join(',')})`;
  return {
    formatVersion: 1, passTypeIdentifier: ids.type, teamIdentifier: ids.equipe, serialNumber: c.token, organizationName: c.salon, description: `Carte de fidélité ${c.salon}`, logoText: c.salon,
    backgroundColor: f(rgb(fond)), foregroundColor: f(texte), labelColor: f(texte),
    barcodes: [{ format: 'PKBarcodeFormatQR', message: urlCarte(c, site), messageEncoding: 'iso-8859-1', altText: 'Carte de fidélité' }],
    barcode: { format: 'PKBarcodeFormatQR', message: urlCarte(c, site), messageEncoding: 'iso-8859-1' },
    storeCard: {
      primaryFields: [{ key: 'points', label: c.mode === 'visite' ? 'TAMPONS' : 'POINTS', value: c.points }],
      secondaryFields: [{ key: 'membre', label: 'MEMBRE', value: c.prenom || 'Client' }, { key: 'recompense', label: c.mode === 'visite' ? `RÉCOMPENSE À ${c.seuil} TAMPONS` : `RÉCOMPENSE À ${c.seuil} PTS`, value: texteRecompense(c) }],
      backFields: [
        { key: 'lien', label: 'Mon solde à jour', value: urlCarte(c, site), attributedValue: `<a href="${urlCarte(c, site)}">Ouvrir ma carte en ligne</a>` },
        { key: 'regle', label: 'Comment ça marche', value: c.mode === 'visite' ? `Un tampon à chaque passage. Après ${c.seuil} passages : ${texteRecompense(c)} sur le passage suivant.` : `${c.points_par_euro} point par euro dépensé. À ${c.seuil} points : ${texteRecompense(c)}.` },
        { key: 'info', label: 'À savoir', value: 'Le solde affiché sur ce pass est celui du jour où vous l\'avez ajouté. Le solde à jour se consulte sur la carte en ligne.' }
      ]
    }
  };
}

export function construirePkpass(c, site, maintenant = new Date(), cfg = null){
  const ids = { type: E.APPLE_PASS_TYPE_ID, equipe: E.APPLE_TEAM_ID };
  const certPem = cfg ? cfg.cert : pem(E.APPLE_PASS_CERT), clePem = cfg ? cfg.cle : pem(E.APPLE_PASS_KEY), wwdrPem = cfg ? cfg.wwdr : pem(E.APPLE_WWDR_CERT);
  if(cfg){ ids.type = cfg.type; ids.equipe = cfg.equipe; }
  const fichiers = { 'pass.json': Buffer.from(JSON.stringify(contenuPass(c, site, ids))) };
  for(const [nom, b64] of Object.entries(IMAGES)) fichiers[nom] = Buffer.from(b64, 'base64');
  const manifeste = Buffer.from(JSON.stringify(Object.fromEntries(Object.entries(fichiers).map(([n, b]) => [n, sha1(b).toString('hex')]))));
  fichiers['manifest.json'] = manifeste;
  fichiers['signature'] = signerPkcs7(manifeste, certPem, clePem, wwdrPem, maintenant);
  return zipper(fichiers);
}
