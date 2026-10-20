#!/usr/bin/env node
// Mirrio - importe les salons d'une ville depuis OpenStreetMap comme fiches « non revendiquées » (voir db/schema-v25).
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/importer-fiches.mjs --ville "Chilly-Mazarin" [--dry]
//
//   --ville   nom de la commune (celui d'OpenStreetMap)
//   --dry     affiche ce qui serait importé, sans rien écrire
//   --cp      code postal à appliquer aux fiches qui n'en ont pas dans OpenStreetMap
//   --sortie  écrit les fiches dans un fichier JSON (sans clé Supabase), pour les importer autrement
//
// Données © contributeurs OpenStreetMap, licence ODbL : la mention est affichée dans l'annuaire. Seules des données d'établissements
// professionnels publiques sont gardées (nom, adresse, position, site, Instagram s'il est renseigné dans OSM), jamais de donnée de
// particulier. Aucune écriture ne remplace une fiche déjà revendiquée : un import rejoué ignore les fiches existantes.
// Requiert Node 18+ (fetch intégré), aucune dépendance.

// Serveurs publics Overpass : on essaie le suivant quand l'un est saturé (502, 504, 429).
const ENDPOINTS = ['https://overpass-api.de/api/interpreter', 'https://overpass.kumi.systems/api/interpreter', 'https://overpass.private.coffee/api/interpreter'];

// OSM -> métier Mirrio
export function metierDe(tags){
  const nom = String(tags.name || '');
  if(/barb(ier|er)/i.test(nom) || tags['hairdresser'] === 'barber') return 'barbier';
  if(tags.beauty === 'nails' || /ongle|nail/i.test(nom)) return 'onglerie';
  if(tags.beauty === 'massage' || tags.shop === 'massage') return 'massage';
  if(tags.shop === 'hairdresser' || tags.craft === 'hairdresser') return 'coiffure';
  if(tags.shop === 'beauty' || tags.beauty) return 'esthetique';
  return 'autre';
}

const handleInsta = v => {
  const m = String(v || '').match(/(?:instagram\.com\/)?@?([A-Za-z0-9._]{2,30})\/?$/);
  return m ? m[1] : null;
};

// Un élément Overpass -> une ligne de fiches_externes (null si inexploitable).
export function convertir(el, villeParDefaut, cpParDefaut = null){
  const t = el.tags || {};
  const nom = String(t.name || '').trim();
  if(!nom) return null;
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  const cp = t['addr:postcode'] || cpParDefaut;
  const rue = [t['addr:housenumber'], t['addr:street']].filter(Boolean).join(' ') || null;
  return {
    source: 'osm', source_id: `${el.type}/${el.id}`,
    nom: nom.slice(0, 120), metier: metierDe(t),
    adresse: rue, code_postal: cp, ville: t['addr:city'] || villeParDefaut, departement: cp ? String(cp).slice(0, 2) : null,
    latitude: lat ?? null, longitude: lon ?? null,
    site_web: (t.website || t['contact:website'] || '').slice(0, 200) || null,
    instagram: handleInsta(t['contact:instagram'] || t.instagram)
  };
}

export function requete(ville){
  const v = ville.replace(/["\\]/g, '');
  return `[out:json][timeout:60];
area["name"="${v}"]["boundary"="administrative"]["admin_level"="8"]->.a;
(
  nwr["shop"~"^(hairdresser|beauty|massage)$"](area.a);
  nwr["craft"="hairdresser"](area.a);
  nwr["amenity"="barber"](area.a);
);
out center tags;`;
}

async function principal(){
  const args = process.argv.slice(2);
  const val = n => { const i = args.indexOf(n); return i >= 0 ? args[i + 1] : null; };
  const cpDefaut = val('--cp'), ville = val('--ville'), dry = args.includes('--dry'), sortie = val('--sortie');
  if(!ville){ console.error('Indiquez --ville "Nom de la commune".'); process.exit(1); }
  const url = process.env.SUPABASE_URL, cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!dry && !sortie && (!url || !cle)){ console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (ou utilisez --dry).'); process.exit(1); }

  console.log(`Recherche des salons de « ${ville} » dans OpenStreetMap…`);
  let r = null;
  for(let essai = 0; essai < 6 && !(r && r.ok); essai++){
    const ep = ENDPOINTS[essai % ENDPOINTS.length];
    try{ r = await fetch(ep, { method: 'POST', headers: { 'User-Agent': 'Mirrio-import/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(requete(ville)) }); }
    catch(e){ r = null; }
    if(!(r && r.ok)){ console.log(`  ${ep} : ${r ? r.status : 'injoignable'}, nouvel essai…`); await new Promise(res => setTimeout(res, 4000)); }
  }
  if(!(r && r.ok)){ console.error('Aucun serveur Overpass ne répond pour le moment, réessayez dans quelques minutes.'); process.exit(1); }
  const { elements } = await r.json();
  const lignes = elements.map(e => convertir(e, ville, cpDefaut)).filter(Boolean);
  const parMetier = lignes.reduce((a, l) => (a[l.metier] = (a[l.metier] || 0) + 1, a), {});
  console.log(`${elements.length} éléments, ${lignes.length} fiches exploitables :`, parMetier);
  if(sortie){ (await import('node:fs')).writeFileSync(sortie, JSON.stringify(lignes, null, 1)); console.log(`${lignes.length} fiches écrites dans ${sortie}.`); return; }
  if(dry){ console.table(lignes.slice(0, 15).map(l => ({ nom: l.nom, metier: l.metier, adresse: l.adresse, cp: l.code_postal, instagram: l.instagram }))); return; }

  let envoyees = 0;
  for(let i = 0; i < lignes.length; i += 200){
    const lot = lignes.slice(i, i + 200);
    const w = await fetch(`${url}/rest/v1/fiches_externes?on_conflict=source,source_id`, {
      method: 'POST', headers: { apikey: cle, Authorization: `Bearer ${cle}`, 'Content-Type': 'application/json', Prefer: 'resolution=ignore-duplicates,return=minimal' }, body: JSON.stringify(lot)
    });
    if(!w.ok){ console.error('Écriture refusée :', w.status, await w.text()); process.exit(1); }
    envoyees += lot.length;
  }
  console.log(`${envoyees} fiches traitées (les doublons déjà présents sont ignorés).`);
}

if(import.meta.url === `file://${process.argv[1]}`) principal();
