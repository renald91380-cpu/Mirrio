// Clé Google Maps (JavaScript API) de Mirrio. Laisser vide = carte OpenStreetMap (Leaflet), qui fonctionne sans clé.
//
// Pour activer Google Maps sur la recherche de salons (explorer.html) :
//   1. console.cloud.google.com → créer ou choisir un projet → activer la facturation (Google offre un crédit mensuel, mais la carte est facturable au-delà).
//   2. APIs et services → Bibliothèque → activer « Maps JavaScript API ».
//   3. Identifiants → Créer une clé API → RESTRICTIONS : « Sites web (référents HTTP) » avec l'adresse du site
//      (ex. https://votre-domaine.com/* et https://cadence-site-cadence-65cc.vercel.app/*), et limiter la clé à « Maps JavaScript API ».
//      Une clé de ce type est publique par conception : c'est la restriction par référent qui la protège, pas le secret.
//   4. Coller la clé ci-dessous, puis commiter et déployer.
// Si la clé est refusée par Google (référent non autorisé, API non activée, facturation absente), la page retombe seule sur OpenStreetMap.
window.MIRRIO_GOOGLE_MAPS_KEY = '';
