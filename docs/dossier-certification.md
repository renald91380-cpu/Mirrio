# Dossier de demande de certification de Mirrio Caisse (NF 525)

À remettre à un organisme accrédité (LNE, Infocert, AFNOR Certification ou autre organisme accrédité pour la norme NF 525) avec la demande de devis, et à relire avec l'expert-comptable.
**Ce document prépare la demande ; il ne vaut ni certificat ni attestation.** La décision de certifier, d'attester ou de renoncer appartient à l'éditeur (Dima Artistry).

## 1. Deux voies, à choisir

| | Certificat d'un organisme accrédité | Attestation individuelle de l'éditeur |
|---|---|---|
| Statut | Rétabli et maintenu par la loi de finances 2026 | **Rétablie** par la loi de finances 2026 (adoptée le 19 février 2026) d'après [economie.gouv.fr](https://www.economie.gouv.fr/entreprises/gerer-son-entreprise-au-quotidien/gerer-sa-comptabilite-et-ses-demarches/ce-quil-faut-savoir-sur-la-certification-des-logiciels-de-caisse) |
| Coût et délai | À demander à l'organisme (audit du code, de la documentation, du processus de livraison) | Aucun audit externe ; engage le représentant légal pour chaque salon |
| Valeur commerciale | Forte : c'est ce que les salons recherchent | Valable en droit, moins rassurante ; à faire valider par l'expert-comptable |
| Dans le dépôt | Ce dossier | `site/attestation-caisse.html`, désactivée (`site/attestation-config.js`) |

Recommandation : attestation en attendant, certificat dès que les premiers salons assujettis à la TVA paient l'abonnement.

## 2. Présentation du logiciel

- **Nom, version** : Mirrio Caisse, version 1.0 (`caisse__version()` dans `db/schema-v43-caisse-certifiable.sql`, à incrémenter à chaque évolution de la caisse).
- **Éditeur** : Dima Artistry SARL (Maroc). Établissement à l'étranger : question à poser à l'organisme et à l'expert-comptable.
- **Périmètre** : fonctions de caisse et d'encaissement : écran `site/caisse.html`, fonctions SQL `caisse_*`, tables `caisse_*`, factures miroirs, produits et stock liés aux ventes. Hors périmètre : agenda, réservation en ligne, pages publiques, comptabilité hors caisse.
- **Architecture** : application web (HTML et JavaScript, sans framework), base PostgreSQL hébergée par Supabase (région Zurich), fonctions serveur Vercel pour le terminal de paiement et les tâches de nuit. Toute écriture de caisse passe par des fonctions SQL `security definer` ; le navigateur n'a aucun droit d'écriture direct.
- **Utilisateurs** : salons de coiffure, barbiers, instituts ; rôles propriétaire, gestionnaire, responsable, collaborateur, vendeur.
- **Moyens de paiement enregistrés** : espèces, carte (saisie ou terminal SumUp, lien de paiement Stripe), chèque, virement, autre, acompte versé en ligne.

## 3. Réponses aux quatre critères

Le détail (mécanisme, contrôle, résultat) est dans `docs/audit-isca.md` ; la liste des exigences et ce qui reste à faire est dans `docs/caisse-conformite.md`. En une phrase par critère :

- **Inaltérabilité** : triggers qui refusent toute modification, suppression ou troncature du journal, des tickets et des paiements ; correction par avoir ; factures miroirs verrouillées ; totaux recalculés par le serveur.
- **Sécurisation** : chaînage SHA-256 de chaque entrée, signature HMAC-SHA256 par clé propre au salon, empreinte de chaque ticket scellée au journal, grands totaux perpétuel et absolu, numérotation sans trou, droits par rôle.
- **Conservation** : clôtures journalière (Z), mensuelle et annuelle, avec clôtures automatiques de nuit ; données cumulatives recoupées par une vérification complète.
- **Archivage** : archive JSON signée (journal, tickets, sessions, résultat de vérification) dont l'empreinte est scellée dans le journal, ce qui donne une date certaine.

## 4. Pièces à fournir à l'organisme

| Pièce | Où la trouver ou la produire |
|---|---|
| Code source de la caisse et des migrations | Dépôt GitHub (`site/caisse.html`, `db/schema-v43` à `v48`, `api/`) |
| Dossier technique | `docs/caisse-conformite.md` |
| Rapport d'audit ISCA rejouable et son dernier résultat | `docs/audit-isca.md`, `scripts/audit-isca.mjs` (82 contrôles, 0 échec au 2026-10-29) |
| Rapport d'audit sur une base réelle | Bouton « Lancer l'audit » (menu Conformité) sur un projet Supabase de test |
| Jeu de données de démonstration | `caisse.html?demo=1` |
| Manuel utilisateur | **À rédiger** : ouverture, vente, avoir, duplicata, formation, clôtures, archive, vérification |
| Procédure de livraison et de mise à jour | **À rédiger** : une mise à jour ne modifie jamais l'historique ; gel de version ; journal des changements |
| Politique de sauvegarde et de conservation 6 ans | **À définir** (sauvegardes Supabase, copie des archives) |
| Gestion de la clé de signature | **À traiter avant l'audit** : sortir la clé HMAC de la base (secret serveur ou KMS), ancrer une empreinte quotidienne chez un tiers |
| Identité de l'éditeur et justificatif d'immatriculation | À compléter dans `site/attestation-config.js` et à joindre |

## 5. Plan de préparation (dans l'ordre)

1. Exécuter toutes les migrations sur un projet Supabase de test et rejouer `scripts/audit-isca.mjs` ainsi que l'audit intégré : les résultats doivent être identiques.
2. Sortir la clé de signature de la base (voir §4) et documenter l'horloge et les sauvegardes.
3. Geler la version 1.0 (étiquette Git), rédiger le manuel et la procédure de mise à jour.
4. Faire relire `docs/caisse-conformite.md` et `docs/audit-isca.md` par l'expert-comptable ; trancher la voie (§1).
5. Demander des devis à au moins deux organismes avec le message ci-dessous.

## 6. Modèle de message de demande de devis

> Bonjour,
>
> Nous éditons un logiciel de caisse en ligne pour salons de coiffure et de beauté (Mirrio Caisse), destiné à des assujettis à la TVA qui encaissent des particuliers en France. Nous souhaitons obtenir la certification NF 525 de ses fonctions de caisse et d'encaissement (périmètre limité à la caisse : l'agenda et les pages publiques sont exclus).
>
> Le logiciel est une application web reposant sur PostgreSQL ; les écritures de caisse passent par des fonctions serveur qui chaînent et signent un journal. Nous disposons d'un dossier technique, d'un rapport d'audit automatisé rejouable sur les quatre critères (inaltérabilité, sécurisation, conservation, archivage) et d'un environnement de démonstration.
>
> Pourriez-vous nous indiquer : la procédure et les pièces attendues, le délai, le coût de l'audit initial et du suivi annuel, les conséquences d'une montée de version, et si un éditeur établi hors de l'Union européenne peut déposer la demande ?
>
> Cordialement,

## 7. Ce que ce dossier ne garantit pas

L'organisme peut exiger des changements que nous n'avons pas anticipés (gestion des clés, durée de conservation, mentions sur les tickets, journalisation de connexions). Les chiffres de coût et de délai ne sont pas connus : aucun n'a été avancé ici.
