# Test de sécurité de Mirrio : 29 octobre 2026

Test boîte grise (lecture du code et sondes non destructives sur le site de production et la base, avec la clé publique du site). Réalisé par l'assistant de développement ; **ce n'est pas un test d'intrusion par un professionnel** et il ne couvre pas la charge, l'ingénierie sociale ni les comptes réels.

## Ce qui a été vérifié et tient
- **Isolation des données (RLS)** : avec la seule clé publique, aucune ligne de `clients`, `documents`, `rendez_vous`, `profiles`, `parametres_*`, `calendar_*`, `workspace_members`, `gateaux_commandes`… n'est lisible ; `parametres_paiement` (clés Stripe/PayPal) est refusée en bloc. Les fonctions d'administration répondent « Réservé aux administrateurs ».
- **Stockage** : écriture anonyme refusée (type MIME restreint) ; liste vide.
- **Secrets** : aucune clé secrète dans les fichiers suivis par Git ; seeds de comptes de test ignorés ; `.git`, `.env`, `db/`, `docs/`, `CLAUDE.md`, scripts non servis (404).
- **Fonctions `security definer`** : aucune sans `search_path` fixé.
- **Webhook Stripe** : signature HMAC vérifiée en temps constant avec tolérance de temps.
- **XSS** : les pages publiques échappent les données ; ni `eval` ni `document.write` ; les `postMessage` vérifient l'origine ; liens `_blank` avec `noopener`.
- **CSRF** : les API s'authentifient par jeton Bearer, pas par cookie.
- **Redirections ouvertes** : aucune trouvée.

## Constats et correctifs (commités, pas encore déployés)
| Gravité | Constat | Correctif |
|---|---|---|
| Moyenne | Les tâches planifiées (`relances`, `rappels`, `clotures`, `paiement-nettoyer`) ne demandaient aucun jeton si `CRON_SECRET` n'était pas défini : n'importe qui aurait pu déclencher l'envoi d'e-mails et de SMS | Fermées par défaut en production sans `CRON_SECRET` (401) |
| Moyenne | Aucune protection contre l'inclusion du site dans le cadre d'un autre site (clickjacking) ; pas d'en-tête CSP | `frame-ancestors 'self'` partout, `frame-ancestors *` seulement pour `reservation.html` (le widget doit pouvoir être intégré) ; COOP |
| Basse | Messages d'erreur internes renvoyés au navigateur (`detail`) sur sept réponses 502 | Retirés |
| Basse | Secret du webhook SumUp comparé en temps non constant | `timingSafeEqual` |
| Basse | `new_feed_token()` et `rotate_calendar_feed_token()` exécutables par un anonyme (aucune donnée exposée) | `db/schema-v50-durcissement.sql` |

## Restes à traiter (non corrigés ici)
1. **Aucune limitation de débit** sur les endpoints publics (réservation, lien « Mes rendez-vous », avis, revendication, mariage). Un script peut générer des réservations ou des e-mails en masse. À poser dans le pare-feu de Vercel (règles de limitation par IP) ; seul le formulaire de commande de gâteaux a un champ-piège.
2. **Pas de CSP de scripts** : les écrans embarquent des scripts en ligne et chargent des bibliothèques depuis esm.sh, unpkg, jsDelivr et cdnjs **sans intégrité (SRI)**. Une compromission d'un de ces CDN exécuterait du code dans l'application. Piste : héberger soi-même `supabase-js`, Phosphor, ZXing, qrcode et Leaflet, puis une CSP stricte.
3. **Droits par rôle** : seuls les clés de paiement, les fonctions sensibles de la caisse, les absences, les statistiques d'équipe et les fiches techniques sont verrouillés en base ; la comptabilité, les clients et le tableau de bord ne sont masqués qu'à l'écran pour un vendeur.
4. **Inscription ouverte** (normal) : prévoir un anti-robot (CAPTCHA Supabase) avant une communication large.
5. **Ce qui n'a pas pu être testé** : connexion réelle (MFA, récupération de mot de passe), webhooks Stripe et SumUp réels, photos privées des clients, comportement des rôles avec de vrais comptes, et toutes les migrations v35 à v50 (non exécutées en production au moment du test : plusieurs tables sont absentes).
6. **Configuration serveur manquante en production** : les routes `/api/*` répondent 500 (« Serveur non configuré ») tant que `SUPABASE_URL`, `SUPABASE_SERVICE_ROLE_KEY` et `CRON_SECRET` ne sont pas posés dans Vercel.
