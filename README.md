# Cadence

**Le rythme administratif de votre activité, réglé une fois pour toutes.**

Logiciel de gestion pour indépendants à clientèle récurrente (photographes, coachs sportifs, formateurs, consultants, professeurs particuliers...). Cadence remplace le tableur, les relances manuelles et les devis épars par un seul outil : fiches clients, agenda, devis & factures, suivi de la récurrence.

Positionnement : France / Belgique / Suisse en priorité. Voir `Asset/cadence-brand-guidelines.md` pour la charte complète (couleurs, typographies, voix).

> **Statut : en construction.** Le site n'est pas encore en ligne publiquement. Voir [État actuel](#état-actuel--ce-qui-reste-à-faire) ci-dessous.

---

## Stack technique

- **Aucun framework, aucun build.** HTML/CSS/JS vanille, un fichier autonome par écran. Déployable tel quel sur n'importe quel hébergeur statique.
- **Supabase** pour l'authentification et la base de données (Postgres), chargé côté client via `esm.sh` — pas de SDK installé localement.
- **Sécurité par Row Level Security (RLS)** : chaque table est scopée par `owner_id = auth.uid()`. L'isolation entre utilisateurs est garantie par la base de données, pas par l'application.
- **PDF** : impression navigateur (`window.print()` + CSS `@media print`) pour l'instant.

## Structure du repo

```
Cadence/
├── README.md
├── CLAUDE.md                          contexte projet pour Claude Code
├── vercel.json                        config déploiement (sert site/ comme racine)
├── .gitignore
├── Asset/                             brief d'origine (accès restreint)
│   ├── cadence-brand-guidelines.md    charte complète : couleurs, polices, ton, iconographie
│   └── cadence-landing.html           mockup initial (base de la landing actuelle)
├── db/
│   └── schema.sql                     schéma base de données complet, cumulatif
└── site/                              LE CODE — tout le site réel, déployé sur Vercel
    ├── index.html                     landing page
    ├── login.html, signup.html        authentification
    ├── clients.html                   fiches clients (CRUD)
    ├── agenda.html                    rendez-vous, avec récurrence
    ├── devis-factures.html            devis & factures, numérotation auto
    └── supabase-config.js             clés Supabase (à renseigner, voir ci-dessous)
```

`db/schema.sql` est volontairement séparé de `site/` : Vercel ne sert que le contenu de `site/`, donc le schéma de base de données n'est jamais exposé publiquement.

## Mise en route

1. Créer un projet gratuit sur [supabase.com](https://supabase.com).
2. Dans *Project Settings → API*, copier l'URL du projet et la clé "anon public" dans `site/supabase-config.js` (elle remplace les valeurs `YOUR-PROJECT-REF` / `YOUR-ANON-PUBLIC-KEY`).
3. Exécuter tout `db/schema.sql` dans l'éditeur SQL de Supabase (sûr à rejouer en entier, toutes les commandes utilisent `if not exists` / `or replace`).

Tant que Supabase n'est pas configuré, les écrans applicatifs affichent "Supabase non configuré" — c'est le comportement voulu.

Pour prévisualiser en local, servir le dossier `site/` avec n'importe quel serveur statique (ex. `npx serve site`) — aucune étape de build n'est nécessaire.

## Déploiement sur Vercel

Le fichier `vercel.json` pointe déjà `outputDirectory` vers `site/` : aucune configuration supplémentaire n'est nécessaire côté Vercel (pas de *build command*, pas de framework à sélectionner — laisser "Other").

1. Importer ce repo GitHub dans Vercel ([vercel.com/new](https://vercel.com/new)).
2. Laisser *Framework Preset* sur "Other" et *Build Command* vide — `vercel.json` s'occupe du reste.
3. Déployer. Les clés Supabase sont dans `site/supabase-config.js` (clé publique anonyme, pas un secret serveur) donc aucune variable d'environnement Vercel n'est requise pour l'instant.

## État actuel — ce qui reste à faire

- Tableau de bord (CA du mois, taux de renouvellement)
- Relances automatiques par email (nécessite un service transactionnel type Resend/Postmark)
- Encaissement Stripe des abonnements Cadence elle-même

**Tarifs actuellement affichés** (pas encore facturés réellement, pas de Stripe branché) :
- Solo — 15€/mois — jusqu'à 25 clients actifs
- Studio — 29€/mois — clients illimités, multi-collaborateurs

## Licence

Projet privé — tous droits réservés.
