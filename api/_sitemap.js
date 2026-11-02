// Mirrio — plan du site pour les moteurs de recherche.
//
//   GET /sitemap.xml   (réécriture vercel.json → /api/reservation-disponibilites?action=sitemap)
//
// Pages publiques fixes + une entrée par salon qui a choisi d'apparaître dans l'annuaire (`visible_annuaire`, opt-in strict, voir
// CLAUDE.md §3.15). Les écrans de l'application connectée, les démos et les pages de paiement n'y figurent jamais (ils sont en noindex).
// Variables : SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, et SITE_URL (adresse publique définitive, sans slash final).

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
// À remplacer par le nom de domaine définitif dès qu'il existe (ou poser SITE_URL sur Vercel).
const BASE = (process.env.SITE_URL || 'https://cadence-site-cadence-65cc.vercel.app').replace(/\/$/, '');

const PAGES = [
  ['/', 'weekly', '1.0'],
  ['/bouche.html', 'weekly', '0.8'],
  ['/mariage.html', 'weekly', '0.8'],
  ['/caisse-logiciel.html', 'weekly', '0.8'],
  ['/explorer.html', 'daily', '0.8'],
  ['/signup.html', 'monthly', '0.6'],
  ['/cgu.html', 'yearly', '0.2'],
  ['/confidentialite.html', 'yearly', '0.2']
];

const x = s => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

export default async function handler(req, res){
  let salons = [];
  try{
    if(SUPABASE_URL && SERVICE_KEY){
      const r = await fetch(`${SUPABASE_URL}/rest/v1/parametres_reservation?activee=eq.true&visible_annuaire=eq.true&slug=not.is.null&select=slug&limit=5000`,
        { headers: { apikey: SERVICE_KEY, Authorization: `Bearer ${SERVICE_KEY}` } });
      if(r.ok) salons = (await r.json()).map(l => l.slug).filter(s => /^[a-z0-9-]{3,40}$/.test(s) && !s.startsWith('demo-'));
    }
  }catch(e){ /* plan du site partiel plutôt qu'une erreur : les pages fixes suffisent */ }

  const aujourdhui = new Date().toISOString().slice(0, 10);
  const urls = [
    ...PAGES.map(([chemin, freq, prio]) => `<url><loc>${x(BASE + chemin)}</loc><changefreq>${freq}</changefreq><priority>${prio}</priority></url>`),
    ...salons.map(s => `<url><loc>${x(`${BASE}/pro.html?p=${encodeURIComponent(s)}`)}</loc><lastmod>${aujourdhui}</lastmod><changefreq>weekly</changefreq><priority>0.7</priority></url>`)
  ];
  res.statusCode = 200;
  res.setHeader('Content-Type', 'application/xml; charset=utf-8');
  res.setHeader('Cache-Control', 'public, s-maxage=3600, stale-while-revalidate=86400');
  res.end(`<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${urls.join('\n')}\n</urlset>\n`);
}
