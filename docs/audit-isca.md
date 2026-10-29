# Audit technique ISCA de Mirrio Caisse

Les quatre critères de l'article 286, I, 3° bis du CGI : **I**naltérabilité, **S**écurisation, **C**onservation, **A**rchivage. Ce document explique comment
chacun est vérifié et comment rejouer la vérification. Il prépare l'audit d'un organisme accrédité (certificat NF 525) ou l'attestation individuelle de
l'éditeur (voir `docs/caisse-conformite.md`). **Ce n'est pas un audit indépendant : c'est un autocontrôle rejouable, à remettre à l'auditeur.**

Périmètre : les fonctions de caisse et d'encaissement (`site/caisse.html`, fonctions SQL `caisse_*`, tables `caisse_*`, factures miroirs), version **1.0**.
Hors périmètre : agenda, réservation, pages publiques.

## 1. Deux niveaux de contrôle

1. **Script d'audit** `scripts/audit-isca.mjs` : monte une base Postgres embarquée (PGlite), charge les migrations réelles du dépôt, joue des ventes, avoirs, paiements
   par terminal, encaissements de rendez-vous, clôtures (dont automatiques) et archives, puis **tente de les falsifier** (modification, suppression, troncature,
   acompte forgé, paiement réutilisé, sur-remboursement, contenu d'une entrée changé, entrée supprimée). Chaque contrôle affiche PASS ou FAIL, code de sortie 1 au moindre échec.
2. **Audit intégré** `caisse_audit_isca()` (bouton « Lancer l'audit » du menu Conformité, rapport imprimable) : refait les contrôles de structure et d'intégrité
   **sur les données réelles du salon** : triggers actifs, policies, droits d'exécution, empreinte de chaque ticket, numérotation, chaîne et signatures, clôtures, archives.
   Il alimente l'annexe de l'attestation.

Rejouer le script :

```
mkdir -p /tmp/audit && cd /tmp/audit && npm init -y && npm i @electric-sql/pglite
cp <dépôt>/scripts/audit-isca.mjs . && ROOT=<dépôt> node audit-isca.mjs
```

## 2. Matrice critère, mécanisme, contrôle

| Critère | Exigence | Mécanisme | Contrôles |
|---|---|---|---|
| **I** Inaltérabilité | Aucune donnée de règlement modifiable ou supprimable sans trace | Triggers `update`, `delete` et `truncate` refusés sur `caisse_journal`, `caisse_tickets`, `caisse_paiements` ; aucune policy d'écriture pour un navigateur ; factures miroirs verrouillées ; correction par avoir seulement | Script : 9 tentatives de modification/suppression refusées, document hors caisse resté modifiable. Audit intégré I1 à I5 |
| **I** | Calculs fiables | Totaux, TVA par taux et acompte recalculés par le serveur ; paiements = total ; empreinte du ticket scellée au journal | Script : totaux, paiements insuffisants, acompte forgé, sur-remboursement, terminal réutilisé. I4 (empreinte de chaque ticket) |
| **S** Sécurisation | Les données d'origine et leurs modifications sont protégées | Chaînage SHA-256 de chaque entrée, signature HMAC-SHA256 par clé propre au salon (illisible), grands totaux perpétuel et absolu | Script : falsification d'une entrée détectée, entrée supprimée détectée, chaîne restaurée valide. S1 |
| **S** | Accès | RLS sur les 8 tables de caisse, fonctions internes non exécutables par un navigateur, aucun accès anonyme | S2 à S5 |
| **C** Conservation | Données cumulatives et récapitulatives intègres dans des clôtures journalière, mensuelle et annuelle | Z numéroté et signé calculé par le serveur ; clôtures mensuelle et annuelle ; **clôtures automatiques de nuit** (journée oubliée, mois et années révolus) ; grands totaux | Script : Z, clôtures automatiques et leur non-répétition, période déjà clôturée refusée. C1 à C6 |
| **A** Archivage | Données figées à périodicité choisie, date certaine, intégrité dans le temps | Archive JSON signée (journal, tickets, sessions, vérification) dont **l'empreinte est scellée dans le journal chaîné** | Script : empreinte égale à celle du journal. A1, A2 ; A3 (conservation 6 ans) reste « à vérifier hors du logiciel » |

## 3. Résultat du dernier passage du script

Exécuté le 2026-10-29 sur la version 1.0 : **61 contrôles réussis, 0 échec** (Inaltérabilité 29, Sécurisation 12, Conservation 15, Archivage 5).
Le script a révélé et fait corriger, avant toute mise en production : un verrou de factures qui bloquait toute modification de la table `documents`, deux ambiguïtés de variables
dans les clôtures de période, une archive non scellée dans le journal.

## 4. Ce que l'audit ne couvre pas (à traiter avec l'auditeur)

- **Hors base** : sauvegardes Supabase, conservation des archives pendant 6 ans (A3), synchronisation de l'horloge, gestion des accès à l'administration de la base.
- **Clé de signature** : stockée dans la même base que le journal. Un administrateur de la base pourrait recalculer toute la chaîne. Avant un audit, sortir la clé (secret serveur ou KMS)
  et ancrer l'empreinte quotidienne chez un tiers.
- **Code client** : l'écran de caisse n'est pas audité ligne à ligne ; la sécurité repose sur le fait que le serveur recalcule et valide tout.
- **Environnement de test** : PGlite reproduit PostgreSQL mais pas Supabase (rôles, API REST, `auth.uid()` réel). Les mêmes scénarios doivent être rejoués une fois sur un projet Supabase de test.
- **Terminal et lien de paiement** : les appels à SumUp et à Stripe n'ont pas été testés contre les vrais services.
- **Droit** : la qualification juridique (périmètre, texte de l'attestation, éditeur établi hors de France) est à faire valider par l'expert-comptable ou un avocat.

## 5. Attestation individuelle

`site/attestation-caisse.html` produit l'attestation d'un salon (identité de l'éditeur lue dans `site/attestation-config.js`, version et rapport d'audit lus sur la base du salon).
Elle reste **désactivée** (`active: false`) : tant que l'éditeur n'a pas relu ce dossier, complété son identité et décidé de signer, un salon qui ouvre la page voit « attestation pas encore délivrée ».
Elle refuse aussi de s'éditer si un champ de l'éditeur est à compléter ou si l'audit du salon relève une anomalie. Chaque impression est inscrite au journal chaîné du salon (type `attestation`).
