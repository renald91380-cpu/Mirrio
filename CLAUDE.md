# CLAUDE.md — Contexte du projet Cadence

Ce fichier est chargé automatiquement par Claude Code à chaque session ouverte dans ce dossier. Il remplace le besoin de réexpliquer le projet à chaque fois.

---

## 1. Identité

**Cadence** — logiciel de gestion pour indépendants à clientèle récurrente (photographes, coachs sportifs, formateurs, consultants, professeurs particuliers...).

**Promesse :** remplacer le tableur, les relances manuelles et les devis épars par un seul outil : fiches clients, agenda, devis & factures, suivi de la récurrence.

**Positionnement :** France/Belgique/Suisse en priorité. Ton direct, chiffré, sans superlatif marketing creux (voir `Asset/cadence-brand-guidelines.md` pour le détail complet de la charte : couleurs, typographies, voix).

**Tarifs actuels affichés (non encore facturés réellement, pas de Stripe branché) :**
- Solo — 15€/mois — jusqu'à 25 clients actifs
- Studio — 29€/mois — clients illimités, multi-collaborateurs

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
