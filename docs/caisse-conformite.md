# Mirrio Caisse : dossier de conformité (loi anti-fraude à la TVA, NF525)

Document à remettre à un expert-comptable ou à un organisme de certification. Il décrit ce que le code fait réellement et ce qui reste à faire.
**Mirrio Caisse n'est pas certifiée aujourd'hui.** Elle est conçue pour pouvoir l'être. Rien dans ce dossier ne dispense de la démarche ci-dessous.

## 1. Cadre

Source officielle : [economie.gouv.fr, « Ce qu'il faut savoir sur la certification des logiciels de caisse »](https://www.economie.gouv.fr/entreprises/gerer-son-entreprise-au-quotidien/gerer-sa-comptabilite-et-ses-demarches/ce-quil-faut-savoir-sur-la-certification-des-logiciels-de-caisse) (page écrite le 24/02/2026). À relire avant toute annonce, la règle a changé plusieurs fois.

Depuis le 1er janvier 2018, les professionnels **assujettis à la TVA** qui ont des **particuliers** parmi leurs clients et enregistrent les paiements avec un logiciel ou système de caisse doivent utiliser un matériel **sécurisé** (art. 286 I 3° bis du CGI) : inaltérabilité, sécurisation, conservation (données cumulatives et récapitulatives intègres dans des clôtures journalière, mensuelle et annuelle) et archivage (périodicité choisie, annuelle au maximum, avec **date certaine** et dispositif garantissant l'intégrité dans le temps).

- **Preuve** : un certificat d'un organisme accrédité (LNE, Infocert, AFNOR Certification, norme NF 525) **ou une attestation individuelle de l'éditeur** : la loi de finances pour 2026, adoptée le 19 février 2026, a **rétabli** cette seconde voie (la fin de l'auto-certification prévue en 2025 puis repoussée est annulée).
- **C'est à l'éditeur** de faire la démarche et de **remettre le document** aux professionnels, qui peuvent le réclamer : Mirrio doit donc pouvoir remettre une attestation signée à chaque salon (modèle à produire, voir §3).
- **Périmètre** : pour un logiciel multifonction (agenda, comptabilité, caisse), seules les **fonctions de caisse et d'encaissement** sont à certifier ou à attester : ici l'écran `caisse.html` et les fonctions SQL `caisse_*` avec leurs tables, pas l'agenda ni la page du salon.
- **Exceptions** : activité exclusivement B2B ou exonérée de TVA, **franchise en base de TVA** (micro-entrepreneurs), remboursement forfaitaire agricole, et professionnels dont **tous** les paiements sont intermédiés par un établissement bancaire de l'Union européenne.
- **Sanction** : 7 500 € par logiciel concerné, renouvelable si la régularisation dépasse 30 jours, et régularisation des recettes (art. 1770 duodecies du CGI).

Hors de France : Belgique (système de caisse certifié seulement pour l'horeca), Suisse (pas d'obligation équivalente) : à vérifier au cas par cas. Les textes et montants sont à faire confirmer par l'expert-comptable avant toute communication commerciale.

## 2. Exigences et réponses techniques (`db/schema-v43-caisse-certifiable.sql`)

| Exigence | Réponse dans Mirrio Caisse |
|---|---|
| **Inaltérabilité** des données de vente | `caisse_journal`, `caisse_tickets` et `caisse_paiements` refusent tout `UPDATE`, `DELETE` et `TRUNCATE` (triggers). Aucune policy d'écriture pour les navigateurs : tout passe par des fonctions SQL `security definer`. La facture miroir (`documents`) d'une vente de caisse est verrouillée de la même façon. |
| Pas de correction d'une vente | Une erreur se corrige par un **avoir** (`caisse_avoir`), partiel ou total, plafonné à ce qui reste remboursable, avec motif obligatoire. Le ticket d'origine n'est jamais touché. |
| **Chaînage** | Chaque entrée du journal contient l'empreinte SHA-256 de la précédente : toute suppression ou modification casse la chaîne. |
| **Signature** | Chaque entrée porte une signature HMAC-SHA256 avec une clé propre à l'espace, stockée dans `caisse_secrets` (aucune policy : illisible par un navigateur). |
| **Numérotation continue** | Compteurs verrouillés (`caisse_chaine`) : tickets `T-AAAA-000001`, avoirs `AV-…`, Z `Z-…`, formation `FORM-…`. La vérification détecte un trou. |
| **Grands totaux** | Perpétuel (somme signée des ventes et avoirs) et absolu (somme des valeurs absolues), jamais remis à zéro, recopiés dans chaque entrée et sur chaque Z. |
| **Traçabilité des événements** | Ouverture, vente, avoir, duplicata, Z, clôtures mensuelle et annuelle, archives et mode formation sont journalisés avec l'auteur et l'heure du serveur. |
| **Duplicata** | Toute réimpression passe par `caisse_duplicata` : journalisée, numérotée, et imprimée avec la mention « DUPLICATA n°N ». |
| **Mode formation** | Tickets `FORM-…` hors chiffre d'affaires, hors grand total, sans facture, imprimés « TICKET DE FORMATION ». |
| **Clôtures** | Z journalier (calculé par le serveur, pas par le navigateur), clôture mensuelle et annuelle (une seule fois par période, session ouverte refusée). |
| **Archivage, date certaine** | `caisse_archiver` produit un JSON (journal, tickets, sessions, résultat de la vérification, empreinte globale), à télécharger et à conserver. **L'empreinte du fichier est scellée dans le journal chaîné** : sa date est celle du journal, et toute modification ultérieure du fichier se détecte en recalculant l'empreinte. |
| **Contrôle d'intégrité** | `caisse_verifier` recalcule toute la chaîne, les signatures, les grands totaux, la continuité des numéros et le lien ticket-journal. Bouton « Conformité » dans la caisse. |
| Calculs | Le serveur recalcule la TVA par taux et le total : le navigateur ne peut pas imposer un montant. Le total des paiements doit égaler le total du ticket. |

Tests : la chaîne, les refus (paiement insuffisant, sur-remboursement, modification, suppression, troncature) et la détection d'une falsification
ont été exécutés sur un Postgres embarqué (PGlite) avec le fichier SQL tel quel. Ce n'est pas un audit.

## 3. Ce qui reste à faire pour certifier

1. **Choisir la voie** : certificat NF 525 (audit du code, de la documentation et du processus de livraison, coût et délai à demander à l'organisme) ou attestation individuelle de l'éditeur (rétablie par la loi de finances 2026). L'attestation engage le représentant légal de l'éditeur (Dima Artistry) : à ne signer qu'après revue par l'expert-comptable. Le modèle existe (`site/attestation-caisse.html`, identité de l'éditeur dans `site/attestation-config.js`) mais reste **désactivé** tant que l'éditeur n'a pas complété son identité et décidé de signer. Audit technique : `docs/audit-isca.md` et `scripts/audit-isca.mjs`.
2. **Gestion des clés** : la clé HMAC vit dans la même base que le journal. Un administrateur de la base pourrait théoriquement tout recalculer. Pour l'audit, déplacer la signature hors base (secret serveur dans Vercel, fonction de signature, ou KMS) et conserver l'empreinte quotidienne chez un tiers (e-mail au comptable, stockage objet en écriture seule).
3. **Conservation 6 ans** (art. L102 B du LPF) : fixer la politique de sauvegarde Supabase, interdire la suppression d'un compte qui a des ventes (le trigger de verrouillage la bloque déjà), prévoir l'export d'archive à la résiliation.
4. **Horloge** : l'heure vient du serveur Postgres ; documenter la synchronisation.
5. **Clôtures automatiques** : faites (tâche de nuit `api/relances.js?tache=clotures`, fonction `caisse_cloturer_auto`) : journée oubliée fermée avec la mention « espèces à recompter », mois et années révolus clôturés ; rien n'est clôturé deux fois. Vérifier après déploiement que la tâche planifiée tourne (journal Vercel).
6. **Documentation éditeur** : version du logiciel, journal des changements, procédure de mise à jour (une mise à jour ne doit pas modifier l'historique), contact support.
7. **Impression et affichage** : faire relire les tickets (mentions, TVA, signature) et le Z par l'expert-comptable ; ajouter si besoin la version du logiciel sur le ticket.
8. **Limites actuelles** : paiement par carte : relié à un terminal SumUp Solo (référence de transaction sur le ticket, preuve d'encaissement), sinon simplement enregistré ; remboursement d'un paiement terminal à faire dans le compte SumUp ; pas de stock ni de codes-barres ; pas de pourboires ; pas de comptes vendeurs distincts (l'auteur est le compte connecté) ; ce n'est pas un FEC.

## 4. Dossier de demande

La préparation d'une demande de certificat (pièces, plan, modèle de message aux organismes) est dans `docs/dossier-certification.md`.

## 5. Pour l'expert-comptable

- Exports : `export-comptable.html` (CSV et rapport) ; les ventes de caisse y figurent comme factures payées, les avoirs comme factures à lignes négatives.
- Lien en lecture seule pour le comptable : voir CLAUDE.md §3.38.
- Pour contrôler : bouton « Conformité » de la caisse (intégrité, grands totaux), puis « Télécharger l'archive ».
