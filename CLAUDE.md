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
│   └── schema-v4-admin.sql                 migration : rôle admin & back-office exploitant
├── api/                               fonctions serverless Vercel
│   ├── agenda.js                      flux iCalendar par utilisateur (GET /api/agenda?t=…)
│   └── relances.js                    relance email des factures en retard (cron quotidien, voir vercel.json)
└── site/                              LE CODE — servi tel quel par Vercel (voir vercel.json)
    ├── index.html                     landing page
    ├── login.html, signup.html        authentification (mot de passe + Google), gèrent les liens d'invitation
    ├── dashboard.html                 tableau de bord (CA, clients actifs, renouvellement, retards) — Studio
    ├── clients.html                   fiches clients (CRUD)
    ├── agenda.html                    rendez-vous, avec récurrence
    ├── devis-factures.html            devis & factures, numérotation auto, export comptable CSV
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

---

## 4. État actuel

**Supabase configuré** (2026-08-21). Projet `supabase-lime-engine` (org Vercel Marketplace « Cadence »), URL et clé publishable dans `site/supabase-config.js`.

**Déployé sur Vercel** — projet `cadence-site` (équipe Vercel « Cadence »), relié au repo GitHub `renald91380-cpu/Cadence`, branche `main`. `vercel.json` pointe `outputDirectory` vers `site/`.

**Connexion Google activée** (2026-08-21). Projet Google Cloud dédié « Cadence », fournisseur Google activé dans Supabase → Authentication → Providers avec l'URL de rappel `https://uymqmbvhneijboszcwsf.supabase.co/auth/v1/callback`, scope `calendar.events` demandé. L'app reste en statut **Test** côté Google (limite : 100 utilisateurs listés manuellement, `renald91380@gmail.com` déjà ajouté) — passer en production lèvera cette limite mais nécessite les pages CGU/confidentialité (voir plus bas) et déclenchera l'écran « application non validée » de Google tant que la vérification n'est pas faite.

**Reste à faire pour activer la personnalisation :**
1. Exécuter `db/schema-v2-personnalisation.sql`, puis `db/schema-v3-espaces-et-relances.sql`, puis `db/schema-v4-admin.sql` dans le SQL Editor Supabase (dans cet ordre — chacune dépend de la précédente). Vérifier que l'email dans la dernière ligne de `schema-v4-admin.sql` correspond bien au compte qui doit devenir admin avant de la rejouer.
2. Déclarer sur Vercel la variable d'environnement `SUPABASE_SERVICE_ROLE_KEY` (nécessaire au flux iCalendar et aux relances). `SUPABASE_URL` est normalement déjà posée par l'intégration.
3. Pour les relances automatiques : déclarer `CRON_SECRET` (jeton arbitraire, à reporter nulle part ailleurs — Vercel s'en sert pour signer ses propres appels), `RESEND_API_KEY` et `RESEND_FROM` (ex. `Cadence <relances@votre-domaine.fr>`, avec SPF/DKIM posés sur ce domaine — voir `emails/README.md` pour la même démarche). Sans `RESEND_API_KEY`, le cron tourne mais n'envoie rien.

**Pas encore construit :**
- Sélection d'une prestation du catalogue depuis les écrans Agenda et Devis (le catalogue existe, le raccourci de saisie non)
- Import d'un agenda externe vers Cadence (le sens entrant)
- Encaissement Stripe des abonnements Cadence elle-même
- Pages CGU / politique de confidentialité (liens encore inertes sur `signup.html` — bloquent aussi le passage de l'app Google en production)
- Rôles au sein d'une équipe autres que propriétaire/collaborateur (pas de permissions fines par membre)
- Mesure réelle de l'usage Supabase/Vercel dans le back-office admin (`admin.html` estime la capacité à partir du nombre de clients, pas d'un appel aux API d'usage — voir §3.7)

---

*Toute règle commune se modifie ici, et nulle part ailleurs.*
