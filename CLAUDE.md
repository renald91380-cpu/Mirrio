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
│   └── schema.sql                     schéma base de données complet, cumulatif
└── site/                              LE CODE — déployé tel quel sur Vercel (voir vercel.json)
    ├── index.html                     landing page
    ├── login.html, signup.html        authentification
    ├── clients.html                   fiches clients (CRUD)
    ├── agenda.html                    rendez-vous, avec récurrence
    ├── devis-factures.html            devis & factures, numérotation auto
    └── supabase-config.js             clés Supabase (à renseigner, voir §4)
```

`db/schema.sql` est volontairement hors de `site/` : Vercel ne sert que `site/` (voir `vercel.json`), donc le schéma de base de données n'est jamais exposé publiquement sur le déploiement.

---

## 3. Choix techniques (à respecter pour rester cohérent)

- **Aucun framework, aucun build.** HTML/CSS/JS vanille, un fichier autonome par écran (styles et scripts inline). Déployable tel quel sur n'importe quel hébergeur statique — pas de `npm install`, pas d'étape de compilation.
- **Supabase** pour l'authentification et la base de données (Postgres). Chargé côté client via `import { createClient } from 'https://esm.sh/@supabase/supabase-js@2'` — pas de SDK installé localement.
- **Sécurité par Row Level Security (RLS)** : chaque table est scopée par `owner_id = auth.uid()`. Ne jamais désactiver RLS ni écrire une requête qui suppose que l'application filtre elle-même par utilisateur — c'est la base de données qui doit garantir l'isolation.
- **Devis & factures** : un seul modèle `documents` (`type = 'devis' | 'facture'`) + `document_lignes`, pas deux tables séparées. Convertir un devis en facture duplique les lignes et pose `converted_from` vers le devis d'origine.
- **Agenda récurrent** : chaque occurrence d'un rendez-vous récurrent est une ligne à part en base (générées toutes en une fois à la création), reliées par `recurring_group_id` — pas de règle RRULE recalculée à la volée.
- **Numérotation** devis/factures (`DEV-2026-001`...) générée automatiquement par trigger SQL, remise à zéro chaque année.
- **PDF** = impression navigateur (`window.print()` + CSS `@media print`) pour l'instant, pas de génération PDF serveur.
- **Conventions d'écran applicatif** (clients/agenda/devis-factures) : en-tête sombre avec nav Clients / Agenda / Devis & factures, garde de session qui redirige vers `login.html` si non connecté, modal + formulaire avec validation au blur (pas à chaque frappe), résumé d'erreurs accessible en haut du formulaire si plusieurs champs invalides, toast de confirmation en bas d'écran. Réutiliser ces patterns plutôt qu'en inventer de nouveaux.

---

## 4. État actuel — ce qui bloque

**Supabase n'est pas encore configuré.** `supabase-config.js` contient des valeurs placeholder (`YOUR-PROJECT-REF`, `YOUR-ANON-PUBLIC-KEY`). Tant que ce n'est pas fait, les écrans applicatifs affichent un message "Supabase non configuré" — c'est le comportement voulu, pas un bug à corriger.

Pour l'activer :
1. Créer un projet gratuit sur supabase.com
2. Copier l'URL du projet et la clé "anon public" dans `site/supabase-config.js`
3. Exécuter tout `db/schema.sql` dans l'éditeur SQL Supabase (sûr à rejouer en entier, toutes les commandes utilisent `if not exists` / `or replace`)

**Pas encore construit :**
- Tableau de bord (CA du mois, taux de renouvellement)
- Relances automatiques par email (nécessite un service transactionnel type Resend/Postmark, Supabase Auth n'envoie que ses propres emails)
- Encaissement Stripe des abonnements Cadence elle-même

---

*Toute règle commune se modifie ici, et nulle part ailleurs.*
