// Test hors ligne des cartes wallet (api/_wallet.js) : archive .pkpass, signature PKCS#7 vérifiée par OpenSSL, JWT Google Wallet.
//   node scripts/test-wallet.mjs      (nécessite openssl et unzip ; fabrique des certificats de test jetables, rien de réel)
import { execSync } from 'node:child_process';
import fs from 'node:fs'; import os from 'node:os'; import path from 'node:path'; import crypto from 'node:crypto';
import { construirePkpass, lienGoogleWallet, contenuPass, zipper } from '../api/_wallet.js';
import { decoderPng, encoderPng, creer } from '../api/_png.js';

const d = fs.mkdtempSync(path.join(os.tmpdir(), 'wallet-')); const sh = c => execSync(c, { cwd: d, stdio: 'pipe' }).toString();
sh(`openssl req -x509 -newkey rsa:2048 -nodes -keyout wwdr.key -out wwdr.pem -subj "/CN=Test WWDR" -days 2 2>/dev/null`);
sh(`openssl req -newkey rsa:2048 -nodes -keyout pass.key -out pass.csr -subj "/CN=Pass Type ID: pass.test/OU=TEAMID1234/O=Test" 2>/dev/null`);
sh(`openssl x509 -req -in pass.csr -CA wwdr.pem -CAkey wwdr.key -CAcreateserial -out pass.pem -days 2 2>/dev/null`);
const lire = f => fs.readFileSync(path.join(d, f), 'utf8');
let ko = 0; const ok = (n, c, x) => { if(!c) ko++; console.log((c ? 'PASS' : 'FAIL') + '  ' + n + (c ? '' : '  ' + x)); };

const carte = { token: 'a'.repeat(48), owner_id: '11111111-1111-1111-1111-111111111111', salon: 'Maison Éloïse', prenom: 'Camille', points: 42, seuil: 100, mode: 'euro', points_par_euro: 1, points_par_visite: 1,
  recompense_type: 'remise_pct', recompense_pct: 10, recompense_libelle: '', couleur: '#E2A63D', logo: null, image: null, couleur_fond: '#000000', couleur_texte: null, niveau: 'Bronze', visites: 1, code: 'FT-B2244B5F' };
const site = 'https://exemple.vercel.app';
const buf = construirePkpass(carte, site, new Date(), { cert: lire('pass.pem'), cle: lire('pass.key'), wwdr: lire('wwdr.pem'), type: 'pass.test', equipe: 'TEAMID1234' });
fs.writeFileSync(path.join(d, 'carte.pkpass'), buf);
fs.mkdirSync(path.join(d, 'x')); sh(`unzip -q carte.pkpass -d x`);
ok('archive valide (unzip -t)', /No errors/.test(sh('unzip -t carte.pkpass')));
const fichiers = fs.readdirSync(path.join(d, 'x')).sort();
ok('fichiers du pass présents', ['icon.png', 'icon@2x.png', 'logo.png', 'manifest.json', 'pass.json', 'signature'].every(f => fichiers.includes(f)), fichiers.join(','));
const man = JSON.parse(lire('x/manifest.json'));
ok('manifeste : empreintes SHA-1 exactes', Object.entries(man).every(([n, h]) => crypto.createHash('sha1').update(fs.readFileSync(path.join(d, 'x', n))).digest('hex') === h) && !('signature' in man));
let verif = ''; try { verif = sh(`openssl smime -verify -inform DER -in x/signature -content x/manifest.json -binary -noverify -out /dev/null 2>&1`); } catch(e){ verif = String(e.stderr || e.message); }
ok('signature PKCS#7 détachée vérifiée par OpenSSL', /Verification successful/i.test(verif) || verif === '', verif);
try { sh(`echo falsifie >> x/manifest.json`); verif = sh(`openssl smime -verify -inform DER -in x/signature -content x/manifest.json -binary -noverify -out /dev/null 2>&1`); ok('manifeste falsifié : signature refusée', false, 'acceptée'); } catch(e){ ok('manifeste falsifié : signature refusée', true); }
const certs = sh(`openssl pkcs7 -inform DER -in x/signature -print_certs -noout 2>&1 || true`);
ok('signature : certificat du pass et WWDR inclus', (certs.match(/subject=/g) || []).length === 2, certs);
const pj = JSON.parse(lire('x/pass.json'));
ok('pass.json : QR, identifiants, couleurs', pj.barcodes[0].format === 'PKBarcodeFormatQR' && pj.barcodes[0].message === `${site}/fidelite.html?t=${carte.token}` && pj.serialNumber === carte.token && pj.passTypeIdentifier === 'pass.test' && pj.teamIdentifier === 'TEAMID1234' && /^rgb\(/.test(pj.backgroundColor));
ok('pass.json : fond noir, texte blanc (réglages du salon)', pj.backgroundColor === 'rgb(0,0,0)' && pj.foregroundColor === 'rgb(255,255,255)');
ok('pass.json : STATUT en en-tête, MEMBRE / POINTS / VISITES, code court sous le QR', pj.storeCard.headerFields[0].value === 'Bronze' && pj.storeCard.secondaryFields.map(f => f.label).join() === 'MEMBRE,POINTS,VISITES' && pj.storeCard.secondaryFields[1].value === '42 / 100' && pj.barcodes[0].altText === 'FT-B2244B5F');
const strip2 = decoderPng(fs.readFileSync(path.join(d, 'x/strip@2x.png'))), strip1 = decoderPng(fs.readFileSync(path.join(d, 'x/strip.png')));
ok('bandeau : PNG valides 750x246 (@2x) et 375x123 (@1x), 10 pastilles dessinées', strip2.w === 750 && strip2.h === 246 && strip1.w === 375 && strip1.h === 123 && strip2.d[((246 - 38) * 750 + 60) * 4] > 200, strip2.w + 'x' + strip2.h);
const rond = creer(40, 20, [200, 30, 30, 255]); const rt = decoderPng(encoderPng(rond));
ok('PNG : aller-retour sans perte', rt.w === 40 && rt.h === 20 && rt.d[0] === 200 && rt.d[1] === 30 && rt.d[3] === 255);
ok('zip : crc32 correct sur contenu quelconque', (() => { const z = zipper({ 'a.txt': Buffer.from('bonjour') }); fs.writeFileSync(path.join(d, 'z.zip'), z); return /No errors/.test(sh('unzip -t z.zip')); })());

// Google Wallet : JWT RS256 vérifiable avec la clé publique
sh(`openssl genrsa -out sa.key 2048 2>/dev/null`); sh(`openssl rsa -in sa.key -pubout -out sa.pub 2>/dev/null`);
process.env.GOOGLE_WALLET_ISSUER_ID = '3388000000000000001'; process.env.GOOGLE_WALLET_SA_EMAIL = 'wallet@projet.iam.gserviceaccount.com'; process.env.GOOGLE_WALLET_SA_KEY = lire('sa.key').replace(/\n/g, '\\n');
const wallet = await import('../api/_wallet.js?g');
const lien = wallet.lienGoogleWallet(carte, site); const jwt = lien.split('/save/')[1]; const [h, p, s] = jwt.split('.');
ok('Google : JWT RS256 vérifié avec la clé publique', crypto.createVerify('RSA-SHA256').update(`${h}.${p}`).verify(lire('sa.pub'), Buffer.from(s, 'base64url')));
const ch = JSON.parse(Buffer.from(p, 'base64url').toString());
ok('Google : charge utile (classe, objet, QR, solde, origine)', ch.aud === 'google' && ch.typ === 'savetowallet' && ch.origins[0] === site && ch.payload.loyaltyObjects[0].loyaltyPoints.balance.int === 42 && ch.payload.loyaltyObjects[0].barcode.type === 'QR_CODE' && ch.payload.loyaltyObjects[0].classId === ch.payload.loyaltyClasses[0].id && ch.payload.loyaltyClasses[0].hexBackgroundColor === '#000000');
ok('Google : lien d\'ajout', lien.startsWith('https://pay.google.com/gp/v/save/'));
console.log(ko ? `\n${ko} échec(s).` : '\nTout est passé.'); process.exit(ko ? 1 : 0);
