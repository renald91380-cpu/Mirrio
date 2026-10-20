#!/usr/bin/env node
// Mirrio - importe les salons d'une ville depuis OpenStreetMap comme fiches « non revendiquées » (voir db/schema-v25).
//
//   SUPABASE_URL=https://xxx.supabase.co SUPABASE_SERVICE_ROLE_KEY=... \
//     node scripts/importer-fiches.mjs --ville "Chilly-Mazarin" [--dry]
//
//   --ville   nom de la commune (celui d'OpenStreetMap)
//   --dry     affiche ce qui serait importé, sans rien écrire
//
// Données © contributeurs OpenStreetMap, licence ODbL : la mention est affichée dans l'annuaire. Seules des données d'établissements
// professionnels publiques sont gardées (nom, adresse, position, site, Instagram s'il est renseigné dans OSM), jamais de donnée de
// particulier. Aucune écriture ne remplace une fiche déjà revendiquée : un import rejoué ignore les fiches existantes.
// Requiert Node 18+ (fetch intégré), aucune dépendance.

const ENDPOINT = 'https://overpass-api.de/api/interpreter';

// OSM -> métier Mirrio
export function metierDe(tags){
  const nom = String(tags.name || '');
  if(/barb(ier|er)/i.test(nom) || tags['hairdresser'] === 'barber') return 'barbier';
  if(tags.beauty === 'nails') return 'onglerie';
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
export function convertir(el, villeParDefaut){
  const t = el.tags || {};
  const nom = String(t.name || '').trim();
  if(!nom) return null;
  const lat = el.lat ?? el.center?.lat, lon = el.lon ?? el.center?.lon;
  const cp = t['addr:postcode'] || null;
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
  const ville = val('--ville'), dry = args.includes('--dry');
  if(!ville){ console.error('Indiquez --ville "Nom de la commune".'); process.exit(1); }
  const url = process.env.SUPABASE_URL, cle = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!dry && (!url || !cle)){ console.error('SUPABASE_URL et SUPABASE_SERVICE_ROLE_KEY sont requis (ou utilisez --dry).'); process.exit(1); }

  console.log(`Recherche des salons de « ${ville} » dans OpenStreetMap…`);
  const r = await fetch(ENDPOINT, { method: 'POST', headers: { 'User-Agent': 'Mirrio-import/1.0', 'Content-Type': 'application/x-www-form-urlencoded' }, body: 'data=' + encodeURIComponent(requete(ville)) });
  if(!r.ok){ console.error(`Overpass a répondu ${r.status}.`); process.exit(1); }
  const { elements } = await r.json();
  const lignes = elements.map(e => convertir(e, ville)).filter(Boolean);
  const parMetier = lignes.reduce((a, l) => (a[l.metier] = (a[l.metier] || 0) + 1, a), {});
  console.log(`${elements.length} éléments, ${lignes.length} fiches exploitables :`, parMetier);
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
