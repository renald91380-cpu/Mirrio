# CLAUDE.md — Contexte du projet Cadence

Ce fichier est chargé automatiquement par Claude Code à chaque session ouverte dans ce dossier. Il remplace le besoin de réexpliquer le projet à chaque fois.

---

## 1. Identité

**Cadence** — logiciel de gestion pour indépendants à clientèle récurrente (photographes, coachs sportifs, formateurs, consultants, professeurs particuliers...).

**Promesse :** remplacer le tableur, les relances manuelles et les devis épars par un seul outil : fiches clients, agenda, devis & factures, suivi de la récurrence.

**Positionnement :** France/Belgique/Suisse en priorité. Ton direct, chiffré, sans superlatif marketing creux (voir `Asset/cadence-brand-guidelines.md` pour le détail complet de la charte : couleurs, typographies, voix).

**Tarifs actuels affichés (non encore facturés réellement, pas de Stripe branché) :**
- Indépendant — 15€/mois — jusqu'à 25 clients actifs (valeur interne `plan = 'solo'`)
- Salon — 29€/mois — clients illimités, multi-collaborateurs (valeur interne `plan = 'studio'`)

*Seuls les libellés affichés ont changé : les valeurs `solo`/`studio` restent les clés en base, dans les URLs (`signup.html?plan=studio`) et dans le code.*

---

## 2. Structure du dossier

```
Cadence/
├── CLAUDE.md                          ce fichier
├── Asset/                             brief d'origine (accès restreint)
│   ├── cadence-brand-guidelines.md    charte complète : couleurs, polices, ton, iconographie
│   └── cadence-landing.html           mockup initial (base de la landing actuelle)
├── db/
│   ├── schema.sql                          schéma de base (v1)
│   ├── schema-v2-personnalisation.sql      migration : personnalisation & connexions agenda
│   ├── schema-v3-espaces-et-relances.sql   migration : espaces partagés & suivi des relances
│   ├── schema-v4-admin.sql                 migration : rôle admin & back-office exploitant
│   └── schema-v5-envoi-document.sql        migration : jeton de partage pour l'envoi par email
├── api/                               fonctions serverless Vercel
│   ├── agenda.js                      flux iCalendar par utilisateur (GET /api/agenda?t=…)
│   ├── relances.js                    relance email des factures en retard (cron quotidien, voir vercel.json)
│   ├── envoyer-document.js            envoi d'un devis/facture par email (POST, authentifié)
│   └── document-public.js             lecture publique d'un devis/facture par jeton (GET /api/document-public?t=…)
└── site/                              LE CODE — servi tel quel par Vercel (voir vercel.json)
    ├── index.html                     landing page
    ├── login.html, signup.html        authentification (mot de passe + Google), gèrent les liens d'invitation, la vérification MFA et le retour de récupération
    ├── nouveau-mot-de-passe.html       lien reçu par email pour choisir un nouveau mot de passe (mot de passe oublié)
    ├── dashboard.html                 tableau de bord (CA, clients actifs, renouvellement, retards) — Studio
    ├── clients.html                   fiches clients (CRUD)
    ├── agenda.html                    rendez-vous, avec récurrence
    ├── devis-factures.html            devis & factures, numérotation auto, export comptable CSV, envoi par email
    ├── voir-document.html             lecture publique d'un devis/facture (lien envoyé au client, sans compte)
    ├── parametres.html                identité, apparence, modèle de documents, prestations, agenda, équipe
    ├── admin.html                     back-office exploitant Cadence (réservé à `profiles.is_admin`)
    ├── ma-page.html                   éditeur de la vitrine publique (photos, style, sections, équipe) avec aperçu en direct
    ├── pro.html                       vitrine publique d'un praticien/salon (lecture seule, pilotée par ma-page.html)
    ├── maquettes-clients.html         comparatif interne de 4 pistes visuelles pour clients.html, non lié dans la nav, `noindex` — voir §3.14
    ├── supabase-config.js             clés Supabase
    ├── theme.js                       thème, vocabulaire métier & résolution d'espace, partagés par les écrans
    ├── document-render.js             rendu d'un devis/facture (aperçu ET impression)
    └── google-calendar.js             poussée des rendez-vous vers Google Calendar
```

`db/` est volontairement hors de `site/` : Vercel ne sert que `site/` (voir `vercel.json`), donc le schéma de base de données n'est jamais exposé publiquement. `api/` est en revanche à la racine, où Vercel détecte les fonctions serverless indépendamment de `outputDirectory`.

---

## 3. Choix techniques (à respecter pour rester cohérent)

- **Aucun framework, aucun build.** HTML/CSS/JS vanille, un fichier autonome par écran (styles et scripts inline). Pas de `npm install`, pas d'étape de compilation.
- **Exception assumée : quatre modules ES partagés** (`supabase-config.js`, `theme.js`, `document-render.js`, `google-calendar.js`). Ce sont les seules choses transversales par nature : les dupliquer dans cinq fichiers garantirait qu'ils divergent. Toute autre logique reste dans son écran.
- **Supabase** pour l'authentification, la base (Postgres) et le stockage. Chargé côté client via `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'`.
- **Sécurité par Row Level Security (RLS)** : chaque table est scopée par `owner_id = current_workspace_id()` (voir §3.3 — un compte solo reste, comme avant, son propre espace). Ne jamais désactiver RLS ni écrire une requête qui suppose que l'application filtre elle-même par utilisateur — c'est la base de données qui doit garantir l'isolation.
- **Un insert doit toujours poser `owner_id` explicitement**, jamais compter sur un défaut de colonne : la valeur à poser est l'espace actif (`idEspaceActif(supabase)` dans `theme.js`), pas forcément `auth.uid()` du compte connecté. Voir §3.3 — c'est le piège n°1 en travaillant sur un nouvel écran.
- **Devis & factures** : un seul modèle `documents` (`type = 'devis' | 'facture'`) + `document_lignes`, pas deux tables séparées. Convertir un devis en facture duplique les lignes et pose `converted_from` vers le devis d'origine.
- **TVA** : le taux vit sur `document_lignes.tva_taux`, pas sur le document — une facture peut légalement mélanger plusieurs taux. Défaut `0`. Un émetteur non assujetti déclenche la mention « TVA non applicable, art. 293 B du CGI ».
- **Agenda récurrent** : chaque occurrence est une ligne à part en base (générées toutes en une fois à la création), reliées par `recurring_group_id` — pas de règle RRULE recalculée à la volée.
- **Numérotation** devis/factures générée par trigger SQL, remise à zéro chaque année. Le préfixe est réglable par l'utilisateur (`DEV`/`FAC` par défaut).
- **PDF** = impression navigateur (`window.print()` + CSS `@media print`), pas de génération PDF serveur.
- **Conventions d'écran applicatif** : en-tête sombre avec nav Clients / Agenda / Devis & factures / Paramètres, garde de session qui redirige vers `login.html` si non connecté, modal + formulaire avec validation au blur (pas à chaque frappe), résumé d'erreurs accessible en haut du formulaire si plusieurs champs invalides, toast de confirmation en bas d'écran. Réutiliser ces patterns plutôt qu'en inventer de nouveaux.

### 3.1 Personnalisation par l'utilisateur

- **Accents : liste fermée de six, jamais un color picker libre.** Chacun a été vérifié par calcul pour porter un texte à un contraste ≥ 4.5:1, rester à ΔE ≥ 15 (OKLab ×100) de la Sarcelle — qui signifie « payé / argent qui rentre » — et ≥ 13 de la Brique — qui signifie « alerte ». Un choix libre laisserait quelqu'un prendre un vert qui rendrait ses pastilles « Payé » indéchiffrables. **Ne pas ajouter un accent sans repasser cette vérification.** Les valeurs vivent dans `ACCENTS`, dans `theme.js`.
- **`theme.js` réassigne `--amber`** plutôt que d'introduire une variable concurrente : tous les écrans la référencent déjà, ils se thémisent donc sans modification de leur CSS. `--accent-text` porte la couleur du libellé, qui bascule encre/parchemin selon la clarté de l'accent.
- **Vocabulaire métier** : un photographe lit « shootings » là où un coach lit « séances ». `vocabulaire(brand)` résout le terme, son pluriel, son genre et les accords (`Nouveau`/`Nouvelle`, `Aucun`/`Aucune`). Ne pas écrire « rendez-vous » en dur dans un écran applicatif.
- **Le nom commercial de l'utilisateur remplace « Cadence » dans l'en-tête applicatif** — l'outil s'efface derrière le travail du praticien (charte §2). Cadence ne se signe qu'en pied de document, et de façon désactivable.
- **`document-render.js` est le seul rendu d'un devis/facture.** L'aperçu des Paramètres et la vue imprimée passent par lui. S'ils étaient deux bouts de code distincts, ce que l'utilisateur règle finirait par ne plus être ce que son client reçoit.

### 3.2 Connexion agenda

Deux canaux, volontairement :

1. **Abonnement iCalendar** (`api/agenda.js`) — une URL secrète par utilisateur, à laquelle Google Agenda, Apple Calendrier et Outlook savent tous s'abonner. Aucun OAuth, marche partout, y compris sur mobile. Sens unique, et le rafraîchissement est à la main du client d'agenda (Google compte souvent plusieurs heures). Le jeton est une URL-capacité, régénérable via la fonction SQL `rotate_calendar_feed_token()`.
2. **Google Calendar** (`google-calendar.js`) — poussée immédiate via le `provider_token` de la session Supabase, obtenu quand l'utilisateur se connecte avec Google en accordant `calendar.events`. Le jeton est de courte durée : la poussée s'arrête proprement à l'expiration, et l'abonnement iCalendar reste le canal de secours.

**Règle :** une synchronisation qui échoue ne doit jamais empêcher d'enregistrer un rendez-vous. La base de Cadence fait foi ; Google n'en est qu'un reflet.

### 3.3 Espaces partagés (offre Studio)

- **Un « espace » n'est pas une entité à part : c'est le compte de son propriétaire.** `workspace_id` vaut toujours l'`id` du profil qui l'a créé. Un compte solo reste, sans le savoir, un espace à un seul membre — aucune donnée n'a eu besoin d'être réécrite en migrant vers ce modèle (`schema-v3-espaces-et-relances.sql`).
- **`current_workspace_id()`** (fonction SQL, `security definer`) revalide l'appartenance à chaque appel plutôt que de faire confiance à `profiles.espace_actif_id` : un membre révoqué entre-temps retombe silencieusement sur son propre espace. C'est elle qui pilote désormais les policies RLS de `clients`, `rendez_vous`, `documents`, `document_lignes`, `prestations`, `parametres_facturation`.
- **`theme.js` expose `idEspaceActif(supabase)`** (appel RPC vers `current_workspace_id()`, mis en cache en mémoire pour la page) — c'est la valeur à poser sur `owner_id` à CHAQUE insert dans un de ces écrans. `initTheme()` l'appelle déjà pour résoudre la marque affichée ; un nouvel écran qui insère doit l'appeler lui-même (voir `clients.html`/`agenda.html`/`devis-factures.html` pour le patron).
- **`chargerBrand(supabase, espaceId)`** lit le profil de l'ESPACE, pas forcément celui du compte connecté : un collaborateur imprime et voit le nom commercial, le logo et le vocabulaire du propriétaire, jamais les siens (souvent vierges). Une policy RLS additive sur `profiles` («&nbsp;Un membre voit le profil de l'espace&nbsp;») autorise cette lecture sans toucher à la policy d'origine.
- **`calendar_feeds` / `calendar_connections` restent personnels**, volontairement non réécrits en `current_workspace_id()` : l'agenda de chaque collaborateur reste le sien, même quand les clients sont partagés.
- **Onglet Équipe (`parametres.html`)** : invitation par email (`inviter_collaborateur`, réservée au propriétaire et à la formule Studio), acceptation (`accepter_invitation`), révocation (`revoquer_collaborateur`), bascule entre espaces (`basculer_espace`). Un lien d'invitation prend la forme `parametres.html?invite=<jeton>`.
- **Rattachement à l'inscription** : deux chemins selon que la personne invitée a déjà un compte ou non.
  1. **Compte à créer** : `signup.html` transmet le jeton en métadonnées de `signUp()` (`invite_token`) ; `handle_new_user()` referme la boucle côté SQL, avant même la confirmation de l'email — aucun aller-retour supplémentaire du navigateur.
  2. **Compte existant, déconnecté** : le jeton ne survivrait pas à l'aller-retour Google en simple paramètre d'URL, donc `login.html`/`signup.html` le posent en `sessionStorage` avant de rediriger vers la connexion, et `parametres.html` l'accepte au chargement via `accepter_invitation()` (RPC, idempotente — un second appel sur un jeton déjà consommé échoue silencieusement, sans toast d'erreur).

### 3.4 Tableau de bord

`dashboard.html`, réservé à la formule Studio (l'entitlement suit le plan du PROPRIÉTAIRE de l'espace, pas du compte connecté — un collaborateur d'un espace Studio en profite). CA du mois calculé en HT (le TTC inclut la TVA collectée pour le compte de l'État, ce n'est pas du chiffre d'affaires), sur les factures au statut « payé ». « Client actif » = au moins un rendez-vous dans les 90 derniers jours ; le taux de renouvellement compare les clients actifs actuels à ceux qui l'étaient déjà 90 à 180 jours plus tôt. Les totaux réutilisent la même alerte de cohérence que le reste du produit : jamais recalculés à la main sans passer par `calculerTotaux()`.

### 3.5 Export comptable

Bouton dans `devis-factures.html`, CSV généré côté client (aucun aller-retour serveur). Uniquement les factures — un devis n'est pas du chiffre d'affaires. Conventions Excel françaises : séparateur `;`, décimales à la virgule, BOM UTF-8 en tête. Réutilise `calculerTotaux()` : les montants exportés ne peuvent jamais diverger de ce qui s'affiche ou s'imprime.

### 3.6 Relances automatiques

`api/relances.js`, appelée quotidiennement par Vercel Cron (`vercel.json` → `crons`, 7h). Zéro dépendance npm, même parti pris que `agenda.js`. Cible les factures envoyées et non réglées dont l'échéance est dépassée, en respectant trois garde-fous réglables depuis Paramètres → Devis & factures : l'interrupteur `relances_activees`, le délai entre deux rappels `relance_delai_jours`, et un plafond de 3 relances par facture au-delà duquel le cron n'insiste plus (`MAX_RELANCES`, en dur — un désaccord qui dépasse ce seuil se traite à la main, pas par un email de plus). L'email part d'une adresse Cadence (`RESEND_FROM`) avec `reply_to` posé sur l'adresse réelle du praticien — la réponse d'un client lui arrive donc directement. Sans `RESEND_API_KEY` configurée, la tâche répond `200` sans envoyer : ce n'est pas un échec, juste un expéditeur pas encore branché.

### 3.7 Back-office exploitant (`admin.html`)

Écran séparé, réservé à Renald — pas un niveau de permission au sein d'une équipe (voir §3.3), mais une vue sur Cadence elle-même en tant que produit.

- **`profiles.is_admin`, verrouillé par trigger.** La policy d'update existante sur `profiles` (« Un utilisateur modifie son propre profil ») n'a pas de `WITH CHECK` : sans garde-fou, n'importe quel compte pourrait s'auto-promouvoir admin par un simple update PostgREST. Le trigger `lock_is_admin` réécrit `is_admin` à sa valeur précédente sauf quand `current_user` est `postgres`/`supabase_admin` (donc seulement depuis le SQL Editor) — y compris pour les appels faits avec la clé `service_role`, qui n'a pas besoin de toucher cette colonne. Le premier admin est posé à la fin de `schema-v4-admin.sql` ; ajouter un second passe par la même ligne SQL, pas par l'app.
- **Définition d'« un client » : un espace, pas un compte.** Un collaborateur actuellement actif ailleurs (`workspace_members.statut = 'actif'` sur un `workspace_id` différent du sien) n'est pas compté une deuxième fois — sinon un Studio à 4 collaborateurs compterait pour 5 clients. La sous-requête `not exists (... m2.workspace_id <> p.id ...)` porte cette règle et se répète dans chaque fonction `admin_*()` plutôt que d'être factorisée en vue : ce sont des fonctions `security definer` indépendantes, pas des requêtes composées côté client.
- **Fonctions `admin_stats()` / `admin_liste_clients()` / `admin_definir_seuil()`** — chacune revérifie `admin_est_admin()` en première ligne (pas de `grant`/`revoke` explicite : même parti pris que le reste du projet, voir `inviter_collaborateur`). Elles renvoient des agrégats par espace (compteurs, métier, CA encaissé, nb de devis/factures/collaborateurs) — jamais le contenu d'un devis ou d'une facture individuelle, qui reste privé à son espace (choix déterminé par le besoin réel : oversight, pas support niveau 2).
- **Capacité affichée = estimation, pas une mesure.** L'app ne peut pas lire l'usage réel de Supabase (taille de base, egress) ni de Vercel sans un jeton d'API séparé — la jauge compare simplement le nombre de clients à un seuil réglable (`admin_config.seuil_alerte_clients`, éditable depuis l'écran) et projette un délai avant de l'atteindre à partir des inscriptions des 30 derniers jours. Les paliers Supabase/Vercel affichés à côté (chiffres août 2026, sourcés dans l'écran) servent à décider, pas à mesurer — le dashboard Supabase/Vercel reste la source de vérité sur la conso réelle.

### 3.8 Mot de passe oublié & authentification à deux facteurs (MFA)

Tout repose sur l'API Auth de Supabase — aucune table ni fonction SQL ajoutée, contrairement aux migrations précédentes.

- **Récupération de mot de passe** : `login.html` → « Mot de passe oublié ? » ouvre un panneau inline (pas une page séparée) qui appelle `resetPasswordForEmail()`. Le message de confirmation est **toujours le même**, que l'adresse corresponde à un compte ou non — ne jamais laisser deviner quels emails sont inscrits. Le lien reçu pointe vers `nouveau-mot-de-passe.html`, qui écoute l'événement `PASSWORD_RECOVERY` (supabase-js consomme lui-même les jetons du fragment d'URL), fait poser un nouveau mot de passe via `updateUser({password})`, puis renvoie vers `login.html` — jamais directement vers `clients.html` : c'est `login.html` qui décide de la suite (voir point suivant), y compris quand le compte a la vérification en deux étapes activée.
- **MFA (TOTP) — un seul point de passage.** `login.html` est le SEUL endroit qui vérifie le niveau d'authentification (`getAuthenticatorAssuranceLevel()`) et fait passer l'étape de code si besoin (`apresConnexion()`), quel que soit le chemin qui a amené la session : mot de passe, retour Google (`redirectTo` pointe désormais vers `login.html` lui-même, jamais vers la destination finale), ou retour de `nouveau-mot-de-passe.html`. Une fois la vérification passée, l'AAL2 reste attaché à la session tant qu'elle vit (rafraîchie sans repasser par un login complet) — les autres écrans n'ont donc rien à vérifier eux-mêmes, même philosophie que `current_workspace_id()` : un seul endroit fait autorité, pas une vérification dupliquée dans chaque écran.
- **Activation** : `parametres.html` → onglet Sécurité → `mfa.enroll({factorType:'totp'})` affiche le QR code et la clé secrète renvoyés par Supabase (rien de généré côté Cadence), confirmés par `mfa.challenge()` + `mfa.verify()`. Les facteurs `unverified` abandonnés (QR affiché puis onglet fermé) sont désenrôlés avant d'en recréer un, pour ne jamais buter sur la limite de facteurs par compte. Désactivation = `mfa.unenroll()` sur le facteur vérifié, après confirmation.
- **Ne dépend pas du mode de connexion** : un compte inscrit uniquement via Google peut activer le MFA (il s'ajoute au premier facteur, quel qu'il soit) et se voir proposer d'ajouter un mot de passe depuis Sécurité — les deux chemins restent indépendants.
- **Préalable côté Supabase** : le facteur TOTP doit être activé dans le dashboard (Authentication → Providers → Multi-Factor Authentication). Sans ça, `mfa.enroll()` échoue et l'écran l'indique dans son toast plutôt que d'échouer silencieusement.

### 3.9 Envoi d'un devis/facture par email

`devis-factures.html` (bouton « enveloppe » sur chaque ligne) → `api/envoyer-document.js` → email via Resend, dans le même style que `api/relances.js`.

- **Toujours pas de génération PDF côté serveur** (choix constant du projet, voir §3). L'email contient un bouton qui pointe vers `site/voir-document.html?t=<jeton>`, une page PUBLIQUE (aucun compte requis) qui réutilise `rendreDocument()`/`stylesDocument()` de `document-render.js` — le client imprime/enregistre en PDF depuis son propre navigateur, exactement comme le praticien le fait déjà. Un devis/une facture n'a donc jamais qu'un seul rendu, même livré à quelqu'un d'extérieur à l'app.
- **`documents.partage_token`** est une URL-capacité, généré par `public.new_feed_token()` (déjà utilisée par `calendar_feeds.token` — pas une nouvelle fonction). Posé une seule fois à l'envoi, puis réutilisé : renvoyer le même document redonne le même lien plutôt que d'en invalider un déjà transmis au client.
- **`api/document-public.js`** lit avec la clé `service_role` et vérifie le jeton dans le code, pas par une policy RLS (même schéma que `api/agenda.js`) — ne renvoie que ce qu'il faut pour reconstituer l'affichage (jamais la liste des documents de l'émetteur).
- **`api/envoyer-document.js`** est authentifié (contrairement aux deux fonctions ci-dessus) : il vérifie le jeton d'accès Supabase de l'appelant via `/auth/v1/user`, puis reproduit `current_workspace_id()` côté serveur pour s'assurer que le document appartient bien à l'espace de l'appelant avant d'envoyer quoi que ce soit — un collaborateur peut envoyer un document créé par le propriétaire, personne d'autre.
- **Effet de bord assumé** : un document encore « brouillon » passe à « envoyé » dès l'envoi réussi — jamais l'inverse, un statut déjà avancé (accepté, payé…) n'est jamais reculé.
- **Mêmes variables d'environnement que les relances** (`RESEND_API_KEY`, `RESEND_FROM`) : sans `RESEND_API_KEY`, le bouton répond poliment que l'expéditeur n'est pas encore configuré, ce n'est pas un échec.

### 3.10 Réservation en ligne (widget public)

`site/reservation.html` (+ `site/reservation-widget.js`) : une page publique, utilisable telle quelle comme lien partageable OU posée en `<iframe>` sur le site du praticien, qui laisse un prospect choisir une prestation puis un créneau libre et laisser ses coordonnées. `api/reservation-disponibilites.js` (GET) et `api/reservation-publique.js` (POST) sont les deux routes publiques associées ; `parametres.html` → onglet Réservation configure tout ça (`parametres_reservation`, schema-v6).

- **Modèle de confiance : un slug, pas un jeton-capacité.** À la différence de `calendar_feeds.token` ou `documents.partage_token` (chaînes opaques générées par `new_feed_token()`, qui FONT l'autorisation à elles seules), le `slug` de `parametres_reservation` est un identifiant choisi par le praticien, pensé pour être diffusé publiquement — comme un nom d'utilisateur. Ne jamais le confondre avec un jeton-capacité dans une future fonctionnalité : un slug n'a aucune vocation à rester secret.
- **`statut='en_attente'`** est la troisième valeur du champ libre `rendez_vous.statut` (avec `null`/absent = confirmé, et `'annule'`) — posée uniquement par `api/reservation-publique.js`. Un rendez-vous en attente n'a pas de fiche client (`client_id` reste `null` ; les coordonnées transitent par `prospect_nom`/`prospect_email`/`prospect_telephone`). C'est `site/agenda.html` qui referme la boucle : « Confirmer » crée la fiche client depuis ces colonnes puis les remplace par `client_id`, « Refuser » réutilise simplement `statut='annule'` — aucun nouveau statut pour le refus.
- **Aucune fiche client n'est jamais créée automatiquement** — décision produit assumée, pas un oubli : c'est toujours le praticien qui confirme.
- **Pas de contrainte anti-chevauchement en base.** Le projet n'a jamais empêché deux `rendez_vous` de se chevaucher ; l'imposer rétroactivement (`EXCLUDE`/`btree_gist`) risquerait de casser sur des données existantes jamais auditées. La protection reste applicative : `api/reservation-disponibilites.js` ne propose que des créneaux déjà libres, et `api/reservation-publique.js` re-vérifie l'absence de chevauchement juste avant d'insérer (fenêtre de course résiduelle, acceptée en v1).
- **Un seul horaire hebdomadaire récurrent** (`jours_ouvres`, `heure_debut`/`heure_fin`) — pas de fermetures ponctuelles (vacances, jour férié) pour l'instant ; désactiver `activee` bloque tout.
- **Conversion Europe/Paris ↔ UTC sans librairie**, dans les deux routes API (dupliquée à dessein, comme le reste des petits utilitaires de `api/`) : le décalage réel (CET/CEST) est lu via `Intl.DateTimeFormat` plutôt que supposé fixe, pour rester correct autour des changements d'heure de mars/octobre.
- **Emails best-effort** (confirmation au prospect + notification au praticien sur `parametres_facturation.emetteur_email`), même parti pris que `api/envoyer-document.js` : sans `RESEND_API_KEY`, on n'envoie simplement rien, la réservation elle-même n'échoue jamais pour ça.

### 3.11 Statut d'activité et localisation dans le back-office admin

Extension de `admin.html` (§3.7), posée par `schema-v7-admin-activite-geo.sql` : `admin_liste_clients()` et `admin_stats()` renvoient désormais aussi la dernière connexion, un statut actif/arrêté calculé, et une localisation déclarée — pour répondre au besoin exploitant de voir qui a arrêté d'utiliser Cadence et où sont les clients.

- **Pas de vrai statut d'abonnement — Cadence n'a aucune intégration de paiement.** `plan` (solo/studio) reste la seule notion de formule (voir §3.7, « Encaissement Stripe » toujours dans « Pas encore construit » plus bas) : il n'y a donc rien à lire côté résiliation d'abonnement. Le proxy retenu pour « une personne qui a arrêté » est l'**inactivité de connexion** : `statut_activite` vaut `'inactif'` quand `auth.users.last_sign_in_at` est `null` ou plus vieux que `admin_config.seuil_inactivite_jours` (réglable depuis l'écran, même patron que `seuil_alerte_clients`), `'actif'` sinon. Affiché explicitement comme tel dans l'UI (pastille + note en bas de la table) pour ne jamais laisser croire à une vraie donnée de facturation.
- **Localisation = adresse professionnelle déclarée, pas de géolocalisation IP.** Ville/pays viennent de `parametres_facturation.emetteur_ville`/`emetteur_pays` (que le praticien remplit lui-même dans Paramètres → Devis & factures) — vide tant qu'il ne l'a pas fait, jamais déduit d'autre chose. `emetteur_pays` vaut `'France'` par défaut pour tout nouveau compte (colonne par défaut posée dès schema-v2), donc quasiment tous les comptes ont au moins un pays ; la ville reste souvent vide.
- **`admin_liste_clients()` a dû être `drop`-ée avant d'être recréée** (pas un simple `create or replace`) : Postgres refuse de changer la liste de colonnes renvoyées par une fonction existante autrement.
- **Nouvelle carte « Répartition géographique »** dans `admin.html`, même style de légende à barres que le camembert métiers (§3.7) mais sans donut — un pays peut avoir zéro coordonnées géographiques utilisables pour un vrai tracé, une simple liste triée suffit.
- **`admin.html` n'a jamais été lié depuis la nav principale** — un admin devait connaître l'URL par cœur. Corrigé en même temps que cette migration : `theme.js` → `monterEntete(brand, actif, estAdmin)` prend un 3ᵉ paramètre et ajoute un lien « Back-office » à la nav commune (`ONGLETS`) uniquement quand `estAdmin` est vrai ; `initTheme()` calcule ce booléen via une requête séparée sur `profiles.is_admin` filtrée par **le compte connecté** (`auth.getUser()`), jamais par `espaceId` — `chargerBrand()` lit la marque de l'espace actif (qui peut appartenir à un tiers pour un collaborateur), alors que `is_admin` est un attribut du compte, pas de l'espace. `parametres.html` (qui n'utilise pas `initTheme()`, mais appelle `monterEntete()` directement à 6 endroits) calcule son propre `estAdmin` à partir du `profiles.select('*')` déjà chargé au démarrage. Ce lien n'est qu'une question de découvrabilité : `admin.html` revérifie lui-même l'accès côté serveur (`admin_est_admin()`), donc son absence n'était jamais un trou de sécurité — seulement un compte admin qui ne savait pas où cliquer.

### 3.12 Sélection d'une prestation du catalogue (agenda, devis & factures)

Le catalogue (`prestations`, réglé depuis Paramètres) existait déjà en base et servait uniquement de référence ; `agenda.html` et `devis-factures.html` proposent désormais de piocher dedans plutôt que de tout ressaisir à la main. Seules les prestations `actif = true` sont proposées — une prestation désactivée reste lisible sur les rendez-vous/lignes existants, mais ne doit plus être choisie pour en créer un nouveau.

- **Un menu qui préremplit, jamais qui pilote la ligne.** Dans `devis-factures.html`, choisir une prestation dans le menu déroulant d'une ligne recopie libellé/prix/TVA dans les champs classiques puis le menu se réinitialise (`e.target.value = ''`) : la ligne reste ensuite une simple ligne éditable, sans lien vivant vers la prestation d'origine. Même logique dans `agenda.html` : la prestation préremplit le titre et l'heure de fin, mais le champ titre reste modifiable sans que le menu ne le corrige après coup.
- **`agenda.html` recalcule l'heure de fin à partir de `prestations.duree_minutes`**, et continue de le faire si l'heure de début est modifiée ensuite — tant qu'une prestation reste sélectionnée. Sans prestation choisie, la saisie manuelle des heures n'est jamais recalculée.
- **`rendez_vous.prestation_id` existait déjà en base** (migration antérieure) mais n'était jusqu'ici jamais renseigné depuis l'interface — c'est fait dans ce commit, y compris pour les occurrences générées par la récurrence.
- **Angle mort corrigé au passage dans `devis-factures.html`** : le formulaire n'envoyait jamais `tva_taux` à l'enregistrement, qui restait donc à la valeur par défaut de la colonne (`0`). Les lignes saisies manuellement gardent ce comportement par défaut ; seule une ligne remplie via une prestation porte le taux de TVA de cette prestation.

### 3.13 Pages CGU / politique de confidentialité

Deux pages statiques autonomes, `site/cgu.html` et `site/confidentialite.html` — pas de connexion Supabase, pas de logique JS, juste la charte visuelle de `signup.html` (mêmes variables CSS, mêmes polices Fraunces/Inter/IBM Plex Mono) réutilisée pour un gabarit d'article long (`<article>` avec `h2`/`p`/`ul`, tableaux pour la politique de confidentialité).

- **Statut juridique retenu** : Renald Gautier, entrepreneur individuel (auto-entrepreneur) — confirmé par l'exploitant. Le SIRET et l'adresse physique ne sont pas connus du code ; ils sont marqués `[À COMPLÉTER]` (classe `.fill`, mise en évidence ambre) plutôt qu'inventés — à remplacer dès que l'exploitant les fournit, dans les deux fichiers.
- **Adresse de contact** : `renald91380@gmail.com`, reprise partout où un contact légal/RGPD est mentionné — c'est l'adresse déjà utilisée comme contact réel du compte ailleurs dans l'app, retenue par défaut faute d'une autre adresse dédiée.
- **Contenu rédigé pour refléter l'infrastructure réelle**, pas un gabarit générique : hébergement Supabase (Zurich, AWS eu-central-2), Vercel (États-Unis), Resend (e-mails transactionnels), Google OAuth (connexion + synchronisation agenda, sur consentement explicite) sont listés nommément comme sous-traitants dans la politique de confidentialité. Le texte est explicite sur l'absence de facturation Stripe réelle (§5 des CGU) pour ne jamais laisser croire à un prélèvement automatique qui n'existe pas, et sur l'absence de cookies non essentiels (donc pas de bandeau de consentement).
- **Liens câblés** : la case à cocher CGU/confidentialité de `signup.html` (auparavant `href="#"` ×2) pointe maintenant vers ces deux pages (`target="_blank"`, pour ne pas perdre la saisie du formulaire) ; le lien « Confidentialité » du pied de page de `index.html` (auparavant `href="#"`) pointe vers `confidentialite.html`.
- Ces pages sont aussi le prérequis documenté pour faire passer l'app Google OAuth de « Test » à « Production » (voir §4) — elles ne suffisent pas à elles seules à déclencher ce passage, qui reste une démarche manuelle à faire côté console Google.

### 3.14 Exploration visuelle pour clients.html (pas encore décidée)

`site/maquettes-clients.html` — page de comparaison autonome (aucun lien avec le vrai `site/clients.html`, aucune dépendance Supabase) présentant 4 identités visuelles possibles pour l'écran Clients, sélectionnables via un switcher en haut de page : **Atelier** (identité Cadence actuelle, nav horizontale — le plus proche de zéro changement), **Nocturne** (sidebar sombre + accent violet, la direction la plus radicale), **Clair** (minimal, un seul accent, aucune barre latérale), **Repère** (identité Cadence actuelle mais réorganisée en menu latéral à libellés texte + cartes KPI au lieu des éléments flottants — la disposition la plus « SaaS classique »).

- **Rien de tout ça n'est implémenté dans le vrai `clients.html`.** C'est un support de décision, pas une fonctionnalité livrée — voir BACKLOG.md.
- **Servie par Vercel comme une page normale, mais volontairement pas dans le produit.** D'abord publiée comme artifact Claude externe (lien claude.ai) et liée depuis Paramètres → Apparence — retour terrain : la page demandait une connexion claude.ai et renvoyait « Page not found » pour un visiteur non authentifié sur ce compte, inutilisable en pratique. Corrigé en rapatriant le fichier tel quel dans `site/` (document HTML complet cette fois — doctype/head/body, absents de la version artifact qui compte sur l'enveloppe posée à la publication) : accessible sans connexion, comme n'importe quelle page du site. `<meta name="robots" content="noindex, nofollow">` et aucun lien dans `ONGLETS`/la nav : seul le bouton « Voir les 4 maquettes » de Paramètres → Apparence y mène.
- Les éléments décoratifs (bulle d'assistance, carte flottante) sur Atelier/Nocturne/Clair ne correspondent à aucune fonctionnalité existante de Cadence ; **Repère** les omet volontairement.
- Même charte typographique que le reste du site (Fraunces/Inter/IBM Plex Mono), mais chaque concept a sa propre palette figée pour la comparaison — ce fichier ne s'adapte pas au thème choisi par l'utilisateur dans Paramètres, contrairement au reste de l'app (voir §3.1).
- **À supprimer une fois la décision prise** : que le choix retenu soit implémenté dans `clients.html` ou non, cette page de comparaison n'a plus de raison d'exister ensuite — ne pas la laisser traîner indéfiniment dans `site/`.

> **Limite Vercel Hobby : 12 fonctions serverless par déploiement** (dépassée = « Deploying outputs » échoue sans message clair). `api/` contient déjà 12 routes ; `/api/annuaire`, `/api/avis`, `/api/vitrine` et `/api/rendez-vous-ics` sont des modules `_annuaire.js`/`_avis.js`/`_vitrine.js`/`_rdv-ics.js` servis par `reservation-disponibilites.js` via des réécritures `vercel.json` (`?action=`). Tout nouvel endpoint doit suivre ce patron (ou fusionner deux routes existantes).

### 3.15 Annuaire public (explorer.html) et modèle de commission

`site/explorer.html` + `api/_annuaire.js` (GET public, servi via `/api/annuaire`) : recherche par nom, ville et catégorie, fiches avec prix d'appel et bouton « Réserver » vers `reservation.html?p=<slug>`. Migration `db/schema-v14-annuaire.sql` : `parametres_reservation.visible_annuaire` (faux par défaut) et `description_annuaire` (≤ 300 car.), réglables dans Paramètres → Réservation.

- **Opt-in strict** : une fiche n'est listée que si `activee` ET `visible_annuaire` ET `slug` ET au moins une prestation active. L'API ne renvoie jamais email, téléphone ni adresse précise — la ville vient de `parametres_facturation.emetteur_ville`.
- **Commission : aucune, volontairement.** Planity fonctionne par abonnement fixe sans commission sur les rendez-vous (source : comparatif FrenchWeb, juillet 2026) ; Treatwell prélève ~25 % sur le premier rendez-vous des nouveaux clients apportés (35 % au Royaume-Uni). Cadence reste sur l'abonnement Solo/Studio (§1). Les paiements Stripe/PayPal vont directement sur le compte du praticien (clés propres, pas de Stripe Connect), donc prélever une commission exigerait Stripe Connect avec `application_fee_amount` — non construit.

- **Photos, localisation, avis (`schema-v15-annuaire-avis-photos-carte.sql`).** `parametres_reservation` gagne `photos` (≤ 6 URL https, saisies à la main — pas d'upload de fichiers), `adresse_annuaire` et `latitude`/`longitude` (géocodées à la demande depuis Paramètres via Nominatim/OpenStreetMap, bouton « Localiser »). Carte Leaflet + tuiles OSM dans `explorer.html` (vue Carte) et `pro.html` (fiche détaillée : galerie, prestations, avis, bouton Réserver). Le paiement en ligne n'est pas dupliqué : « Réserver » mène à `reservation.html`, qui gère déjà Stripe/PayPal.
- **Avis vérifiés uniquement.** `rendez_vous.avis_token` (jeton-capacité, même générateur que `partage_token`) → `avis.html?t=…` → `api/avis.js`. Un avis = un rendez-vous terminé, ni annulé ni en attente, une seule fois. Le praticien copie le lien depuis la fiche du rendez-vous dans l'agenda ; il peut passer `avis.masque` à vrai (trigger `avis_lock_colonnes` : seule cette colonne est modifiable, aucune policy de delete). **Limite connue :** l'agenda ne charge que les rendez-vous à partir d'aujourd'hui, donc le lien n'est proposé que pour ceux terminés aujourd'hui ; pas d'envoi automatique par email, pas encore d'écran pour masquer un avis.

### 3.16 PWA et invitation calendrier (.ics)

- **PWA** : `site/manifest.webmanifest`, `site/sw.js`, `site/pwa.js`, `site/offline.html`, `site/icons/` (192, 512, maskable, apple-touch — générées, une lettre « C » ambre sur encre) et les balises `<head>` dans toutes les pages sauf `maquettes-clients.html` et `agent-dashboard.html`. `vercel.json` sert `sw.js` en `no-cache`. **Le service worker ne met jamais en cache les données** (`/api/*`, Supabase, CDN : réseau seul) — seulement la coquille statique ; pages en « réseau d'abord » avec repli sur `offline.html`. Pour déployer une nouvelle version de la coquille, changer `VERSION` dans `sw.js`. `pwa.js` propose l'installation (invite native Android/Chrome ; message explicatif sur iOS Safari) et n'insiste pas une fois fermé.
- **Invitation .ics** : `api/_ics.js` (module partagé, préfixe `_` = pas une route) génère un VEVENT dont l'UID `<id>@cadence` est le même que celui du flux d'abonnement `api/agenda.js` (aucun doublon chez un praticien abonné). Joint en pièce jointe aux emails de réservation, côté client ET praticien (réservation gratuite, webhook Stripe, capture PayPal), et téléchargeable via `api/rendez-vous-ics?t=<rendez_vous.avis_token>` — même jeton-capacité que l'avis (§3.15). `STATUS:TENTATIVE` tant que la demande est `en_attente`. `api/reservation-publique.js` renvoie `ics_url`, affiché en bouton « Ajouter à mon agenda » sur la page de réservation. Génération best-effort : un `.ics` manquant ne bloque jamais une réservation.
- **Limite connue** : un rendez-vous confirmé plus tard à la main (« Confirmer » dans l'agenda) n'envoie pas de nouveau `.ics` ; le client garde l'événement « provisoire » reçu à la demande.

### 3.17 Agenda « Jour · Équipe » (colonnes par membre)

`site/agenda.html` a une bascule **Liste | Jour · Équipe**. La vue Équipe affiche une journée en grille horaire (7h–21h, 1 px/minute), une colonne par membre actif de l'espace (propriétaire en premier, puis `workspace_members.statut = 'actif'`), des blocs « HH:MM - HH:MM + titre », un trait « maintenant », la navigation jour précédent/suivant/aujourd'hui. Cliquer un bloc ouvre la fiche ; cliquer un créneau vide ouvre un nouveau rendez-vous pré-rempli (date, heure arrondie au quart d'heure, collaborateur). Le choix de vue est mémorisé en `localStorage`.

- **`rendez_vous.collaborateur_id`** (`db/schema-v16-rendez-vous-collaborateur.sql`) : `null` = non attribué = colonne du propriétaire — donc tous les rendez-vous existants et toutes les réservations en ligne atterrissent chez le propriétaire. Les policies RLS ne changent pas (l'isolation reste `owner_id`).
- Le champ « Assuré par » de la fiche n'apparaît que s'il y a au moins un collaborateur. Le nom d'une colonne vient de `profiles.full_name` si la RLS le permet, sinon du préfixe de l'email d'invitation.
- **Limite connue :** la réservation en ligne publique ne choisit pas de collaborateur et ne tient pas compte des disponibilités individuelles — un seul horaire hebdomadaire par espace (§3.10).

### 3.18 Vertical beauté (coiffure, barbier, esthétique, onglerie, massage)

Cadence se positionne aussi comme logiciel de salon, façon Planity — **sans commission** (voir §3.15). Vitrine : `site/beaute.html` (liée depuis `index.html` et l'annuaire ; le comparatif Planity/Treatwell y est sourcé « FrenchWeb, juillet 2026 » et daté — à revérifier avant de le republier).

- **Migration `db/schema-v17-beaute.sql`** : (1) corrige `profiles_metier_check`, qui refusait `coiffure`/`esthetique`/`onglerie` pourtant proposés dans l'interface, et ajoute `barbier` et `massage` ; (2) `prestations.public_cible` (`mixte`/`femme`/`homme`) ; (3) `prestations.categorie` (texte libre ≤ 40 car.). **À exécuter avant d'utiliser l'éditeur de prestations** : il envoie désormais ces deux colonnes. Les lectures publiques (`reservation-disponibilites`, `_annuaire`) retombent sur l'ancien `select` si la migration manque, pour ne jamais casser la réservation.
- **Catalogues types** (`CATALOGUES` dans `parametres.html`, onglet Prestations) : importés en un clic selon `profiles.metier` (coiffure, barbier, esthétique, onglerie, massage ; `therapeute` réutilise massage). Prix TTC indicatifs France, TVA posée au taux par défaut si l'émetteur est assujetti. L'import ne duplique pas un libellé déjà présent.
- **Femme / Homme** : onglets sur `reservation.html` et `pro.html` (affichés seulement si le catalogue sert les deux publics ; `mixte` apparaît dans les deux), regroupement par catégorie, filtre « Pour qui » dans `explorer.html` (`/api/annuaire?public=femme|homme`, calculé depuis les prestations — `publics`).
- Vocabulaire : `barbier` → « rendez-vous », `massage` → « massage(s) » dans `theme.js` ; `admin.html` connaît les deux nouveaux métiers.
- **Pas construit** : liste d'attente, rappels SMS, fiches client beauté (allergies, couleur…), horaires par collaborateur, choix du coiffeur à la réservation, produits/vente en boutique.

### 3.19 Vitrine publique personnalisable (« Ma page »)

Chaque praticien/salon a une page publique `site/pro.html?p=<slug>` (servie par `api/_vitrine.js` via `/api/vitrine`) et un éditeur `site/ma-page.html` (onglet « Ma page » de la nav, `theme.js` → `ONGLETS`), avec **aperçu en direct** : l'éditeur charge `pro.html?preview=1` dans une iframe et lui envoie les données par `postMessage` (même origine uniquement, des deux côtés) — la page publique et l'aperçu passent par la même fonction `rendre()`, donc ce que le pro voit est ce que voit son client (même principe que `document-render.js`, §3.1).

- **Migration `db/schema-v18-vitrine.sql`** : tables `vitrine` (une ligne par espace : accroche, à propos, couverture, galerie ≤ 12, mise en page classique/immersif/minimal, police, couleur libre `#RRGGBB`, fond clair/crème/sombre, forme des boutons, texte du bouton, sections activables + ordre, réseaux, contact public, bandeau d'annonce) et `vitrine_equipe` (nom, rôle, mot, photo, position), toutes deux sous RLS `current_workspace_id()`. Contraintes SQL sur les énumérations, longueurs et format de couleur.
- **Photos : bucket Supabase Storage public `vitrines`** (JPEG/PNG/WebP ≤ 5 Mo). Écriture réservée au dossier `<workspace_id>/…` par policy sur `storage.objects` (`(storage.foldername(name))[1] = current_workspace_id()::text`). Les images sont redimensionnées et recompressées côté navigateur (couverture 2000 px, galerie 1600 px, portrait 600 px, JPEG 82 %) avant envoi. Retirer une photo supprime aussi le fichier.
- **Couleur libre assumée ici**, contrairement à l'interface applicative (§3.1, liste fermée) : la vitrine n'utilise ni la Sarcelle « payé » ni la Brique « alerte ». Le contraste est garanti autrement — la couleur du texte des boutons est calculée sur la luminance de la couleur choisie (`texteSur()` dans `pro.html`).
- **Sécurité de l'affichage** : tout texte est échappé, toute URL d'image doit être en `https://`, les liens de réseaux sont normalisés (`@pseudo` → URL) ; l'API ne renvoie jamais d'email de facturation ni de clé de paiement. La page n'existe que si `parametres_reservation.activee` et `slug` sont posés ET qu'il y a au moins une prestation active ; l'annuaire (`visible_annuaire`) reste un choix séparé.
- **Tolérance** : sans migration v18, `/api/vitrine` renvoie quand même la page avec le style par défaut, et l'éditeur affiche un message clair au lieu d'échouer en silence.
- **Pas construit** : domaine personnalisé, thèmes enregistrés/dupliqués, brouillon vs publié (un « Enregistrer » publie tout de suite), éditeur de la page de réservation elle-même (`reservation.html` reprend seulement logo + accent), espace client connecté (historique, favoris).

### 3.20 Identité visuelle des pages publiques (« ultra moderne »)

`beaute.html`, `explorer.html` et `pro.html` ont leur propre langage visuel, **distinct de l'application connectée** (qui garde l'identité « Atelier » de §3.1 : Fraunces, parchemin, ambre). Ne pas y reporter les règles de §3.1, et inversement.

- **Typographie** : Bricolage Grotesque (titres, tracking serré) + Geist (texte). Pas de serif par défaut ; Fraunces reste un choix proposé au pro dans « Ma page » mais n'est plus le défaut (`police = 'moderne'`, aussi dans `schema-v18` et `ma-page.html`).
- **Palette** : neutres froids (`#F5F5F3` / `#101216`, jamais de blanc ni de noir purs) et **un seul accent, l'ambre de Cadence** (`#E2A63D`, texte d'encre dessus). Pas de parchemin/beige, pas de dégradé de texte (contraste insuffisant sur fond clair : on surligne avec un trait ambre). **Clair/sombre automatique** (`prefers-color-scheme`), un seul thème par page.
- **Formes** : une règle, boutons/champs/puces en pilule (`999px`), conteneurs à `22px`. Navigation flottante en verre dépoli (repli opaque sous `prefers-reduced-transparency`), une seule ligne, 64 px.
- **Mouvement** : `IntersectionObserver` pour l'apparition au scroll (jamais d'écouteur `scroll`), survol/appui tactiles sur les boutons, tout coupé sous `prefers-reduced-motion` et sans JavaScript (`@media (scripting: none)`).
- **Icônes** : Phosphor (`@phosphor-icons/web@2.1.1` depuis unpkg), jamais de SVG dessiné à la main.
- **Aucun tiret long (`—`, `–`) dans le texte visible** : trait d'union simple ou deux phrases. Titres de page avec `|`.
- **Pas de fausse capture d'écran** : le héros de `beaute.html` montre la vraie `pro.html?preview=1` dans un cadre de téléphone, alimentée par un salon d'exemple (Maison Éloïse) via le même `postMessage` que l'éditeur « Ma page ».
- **Photos : à fournir.** Aucun outil de génération d'image n'a été utilisé ; les visuels sont des halos et dégradés d'ambre. Emplacements prévus : une photo par métier dans le rail de `beaute.html` (commentaire `TODO photo`), et les couvertures des salons dans l'annuaire (issues de « Ma page », avec repli en dégradé).
- **Accessibilité et interaction (checklist du skill ui-ux-pro-max, vérifiée sur ces trois pages)** : lien d'évitement et `<main>` identifié ; anneau de focus 3 px visible ; icônes décoratives en `aria-hidden="true"` et couleur d'icône assombrie en mode clair (`--icone`, l'ambre seul n'atteint pas 3:1 sur fond clair) ; cibles tactiles ≥ 44 px ; onglets Femme/Homme en vrais `tablist` (flèches gauche/droite, `tabindex` itinérant) ; rail des métiers avec boutons précédent/suivant (le glissement n'est jamais le seul moyen) ; visionneuse photo en dialogue modal (bouton Fermer, Échap, flèches, focus rendu à la vignette) ; états vide et erreur avec action (« Effacer les filtres », « Réessayer ») ; recherche de l'annuaire instantanée avec délai de 350 ms ; `scroll-padding` pour que les barres fixes ne masquent pas le focus. Le style retenu est celui que le skill nomme « Soft UI Evolution » (ombres douces à deux couches `--ombre`), mais **pas sa palette rose/lavande + Playfair** : elle contredirait l'identité ambre de Cadence et la personnalisation par salon.
- **Page de réservation (`reservation.html` + `reservation-widget.js`)** : refondue dans ce langage, mais **elle prolonge la vitrine du salon** : `api/_*`/`reservation-disponibilites.js` renvoie `style` (couleur, fond, police, boutons issus de `vitrine`, schema-v18) et `stylesSalon()` pose les mêmes variables que `pro.html` (couleur de texte des boutons calculée par luminance). Parcours en 3 étapes avec progression (`aria-current="step"`), récapitulatif sticky à droite sur ordinateur (avec le bouton « Continuer » de l'étape 1) et barre fixe en bas sur mobile, créneaux regroupés Matin/Après-midi/Soir, focus déplacé sur le titre à chaque étape, résumé d'erreurs focalisable avec liens vers les champs, validation à la sortie du champ, `autocomplete`/`inputmode`. **Toute la logique (multi-prestations, paiement Stripe, 409 créneau pris, `ics_url`) est inchangée.** Piège connu : en français `Intl` écrit l'heure seule « 09 h » ; `heureParis()` passe par `formatToParts`.
- **Pas encore refait dans ce style** : `login.html`/`signup.html`, `index.html` et tout le back-office.

---

## 4. État actuel

**Supabase configuré** (2026-08-21). Projet `supabase-lime-engine` (org Vercel Marketplace « Cadence »), URL et clé publishable dans `site/supabase-config.js`.

**Déployé sur Vercel** — projet `cadence-site` (équipe Vercel « Cadence »), relié au repo GitHub `renald91380-cpu/Cadence`, branche `main`. `vercel.json` pointe `outputDirectory` vers `site/`.

**Connexion Google activée** (2026-08-21). Projet Google Cloud dédié « Cadence », fournisseur Google activé dans Supabase → Authentication → Providers avec l'URL de rappel `https://uymqmbvhneijboszcwsf.supabase.co/auth/v1/callback`, scope `calendar.events` demandé. L'app reste en statut **Test** côté Google (limite : 100 utilisateurs listés manuellement, `renald91380@gmail.com` déjà ajouté) — passer en production lèvera cette limite. Les pages CGU/confidentialité (voir §3.13) sont maintenant en place ; il reste à faire la démarche manuelle de passage en production dans la console Google, ce qui déclenchera l'écran « application non validée » tant que la vérification Google n'est pas faite.

**Reste à faire pour activer la personnalisation :**
1. Exécuter dans l'ordre, dans le SQL Editor Supabase : `db/schema-v2-personnalisation.sql`, `db/schema-v3-espaces-et-relances.sql`, `db/schema-v4-admin.sql`, `db/schema-v5-envoi-document.sql`, `db/schema-v6-reservation-en-ligne.sql`, `db/schema-v7-admin-activite-geo.sql` (chacune dépend de la précédente). Vérifier que l'email dans la dernière ligne de `schema-v4-admin.sql` correspond bien au compte qui doit devenir admin avant de la rejouer.
2. Déclarer sur Vercel la variable d'environnement `SUPABASE_SERVICE_ROLE_KEY` (nécessaire au flux iCalendar et aux relances). `SUPABASE_URL` est normalement déjà posée par l'intégration.
3. Pour les relances automatiques : déclarer `CRON_SECRET` (jeton arbitraire, à reporter nulle part ailleurs — Vercel s'en sert pour signer ses propres appels), `RESEND_API_KEY` et `RESEND_FROM` (ex. `Cadence <relances@votre-domaine.fr>`, avec SPF/DKIM posés sur ce domaine — voir `emails/README.md` pour la même démarche). Sans `RESEND_API_KEY`, le cron tourne mais n'envoie rien.

**Pas encore construit :**
- Import d'un agenda externe vers Cadence (le sens entrant)
- Encaissement Stripe des abonnements Cadence elle-même
- Rôles au sein d'une équipe autres que propriétaire/collaborateur (pas de permissions fines par membre)
- Mesure réelle de l'usage Supabase/Vercel dans le back-office admin (`admin.html` estime la capacité à partir du nombre de clients, pas d'un appel aux API d'usage — voir §3.7)
- Fermetures ponctuelles (vacances, jour férié) sur la réservation en ligne — seul un horaire hebdomadaire récurrent existe (voir §3.10)

---

*Toute règle commune se modifie ici, et nulle part ailleurs.*
