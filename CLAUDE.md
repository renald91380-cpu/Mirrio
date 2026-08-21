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
│   ├── schema.sql                     schéma de base (v1)
│   └── schema-v2-personnalisation.sql migration : personnalisation & connexions agenda
├── api/                               fonctions serverless Vercel
│   └── agenda.js                      flux iCalendar par utilisateur (GET /api/agenda?t=…)
└── site/                              LE CODE — servi tel quel par Vercel (voir vercel.json)
    ├── index.html                     landing page
    ├── login.html, signup.html        authentification (mot de passe + Google)
    ├── clients.html                   fiches clients (CRUD)
    ├── agenda.html                    rendez-vous, avec récurrence
    ├── devis-factures.html            devis & factures, numérotation auto
    ├── parametres.html                identité, apparence, modèle de documents, prestations, agenda
    ├── supabase-config.js             clés Supabase
    ├── theme.js                       thème + vocabulaire métier, partagés par les écrans
    ├── document-render.js             rendu d'un devis/facture (aperçu ET impression)
    └── google-calendar.js             poussée des rendez-vous vers Google Calendar
```

`db/` est volontairement hors de `site/` : Vercel ne sert que `site/` (voir `vercel.json`), donc le schéma de base de données n'est jamais exposé publiquement. `api/` est en revanche à la racine, où Vercel détecte les fonctions serverless indépendamment de `outputDirectory`.

---

## 3. Choix techniques (à respecter pour rester cohérent)

- **Aucun framework, aucun build.** HTML/CSS/JS vanille, un fichier autonome par écran (styles et scripts inline). Pas de `npm install`, pas d'étape de compilation.
- **Exception assumée : quatre modules ES partagés** (`supabase-config.js`, `theme.js`, `document-render.js`, `google-calendar.js`). Ce sont les seules choses transversales par nature : les dupliquer dans cinq fichiers garantirait qu'ils divergent. Toute autre logique reste dans son écran.
- **Supabase** pour l'authentification, la base (Postgres) et le stockage. Chargé côté client via `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'`.
- **Sécurité par Row Level Security (RLS)** : chaque table est scopée par `owner_id = auth.uid()`. Ne jamais désactiver RLS ni écrire une requête qui suppose que l'application filtre elle-même par utilisateur — c'est la base de données qui doit garantir l'isolation.
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

---

## 4. État actuel

**Supabase configuré** (2026-08-21). Projet `supabase-lime-engine` (org Vercel Marketplace « Cadence »), URL et clé publishable dans `site/supabase-config.js`.

**Déployé sur Vercel** — projet `cadence-site` (équipe Vercel « Cadence »), relié au repo GitHub `renald91380-cpu/Cadence`, branche `main`. `vercel.json` pointe `outputDirectory` vers `site/`.

**Reste à faire pour activer la personnalisation :**
1. Exécuter `db/schema-v2-personnalisation.sql` dans le SQL Editor Supabase.
2. Déclarer sur Vercel la variable d'environnement `SUPABASE_SERVICE_ROLE_KEY` (nécessaire au flux iCalendar). `SUPABASE_URL` est normalement déjà posée par l'intégration.
3. Pour la connexion Google : activer le fournisseur Google dans Supabase → Authentication → Providers, avec des identifiants OAuth Google Cloud et l'URL de rappel `https://uymqmbvhneijboszcwsf.supabase.co/auth/v1/callback`, en demandant l'autorisation `calendar.events`.

**Pas encore construit :**
- Tableau de bord (CA du mois, taux de renouvellement)
- Sélection d'une prestation du catalogue depuis les écrans Agenda et Devis (le catalogue existe, le raccourci de saisie non)
- Import d'un agenda externe vers Cadence (le sens entrant)
- Relances automatiques par email (nécessite un service transactionnel type Resend/Postmark)
- Encaissement Stripe des abonnements Cadence elle-même
- Pages CGU / politique de confidentialité (liens encore inertes sur `signup.html`)

---

*Toute règle commune se modifie ici, et nulle part ailleurs.*
