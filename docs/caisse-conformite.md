# Mirrio Caisse : dossier de conformité (loi anti-fraude à la TVA, NF525)

Document à remettre à un expert-comptable ou à un organisme de certification. Il décrit ce que le code fait réellement et ce qui reste à faire.
**Mirrio Caisse n'est pas certifiée aujourd'hui.** Elle est conçue pour pouvoir l'être. Rien dans ce dossier ne dispense de la démarche ci-dessous.

## 1. Cadre

En France, un assujetti à la TVA qui enregistre des paiements de particuliers avec un logiciel ou un système de caisse doit utiliser un logiciel
**sécurisé et inaltérable** (art. 286 I 3° bis du CGI). Il le justifie par :
- un **certificat** délivré par un organisme accrédité (LNE, Infocert, AFNOR Certification) selon la norme NF 525 ; ou
- une **attestation individuelle de l'éditeur** (modèle de l'administration fiscale, BOI-TVA-DECLA-30-10-30), signée par un représentant légal.

L'amende prévue est de 7 500 € par logiciel non conforme. Un salon en **franchise en base de TVA** n'est pas concerné. Hors de France :
Belgique (système de caisse certifié seulement pour l'horeca), Suisse (pas d'obligation équivalente) : à vérifier au cas par cas.
Les textes et le montant sont à faire confirmer par l'expert-comptable avant toute communication commerciale.

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
| **Sécurisation de l'archive** | `caisse_archiver` produit un JSON (journal, tickets, sessions, résultat de la vérification, empreinte globale), à télécharger et à conserver. |
| **Contrôle d'intégrité** | `caisse_verifier` recalcule toute la chaîne, les signatures, les grands totaux, la continuité des numéros et le lien ticket-journal. Bouton « Conformité » dans la caisse. |
| Calculs | Le serveur recalcule la TVA par taux et le total : le navigateur ne peut pas imposer un montant. Le total des paiements doit égaler le total du ticket. |

Tests : la chaîne, les refus (paiement insuffisant, sur-remboursement, modification, suppression, troncature) et la détection d'une falsification
ont été exécutés sur un Postgres embarqué (PGlite) avec le fichier SQL tel quel. Ce n'est pas un audit.

## 3. Ce qui reste à faire pour certifier

1. **Choisir la voie** : certificat NF 525 (audit du code, de la documentation et du processus de livraison, coût et délai à demander à l'organisme) ou attestation individuelle de l'éditeur. L'attestation engage le représentant légal de l'éditeur (Dima Artistry) : à ne signer qu'après revue par l'expert-comptable.
2. **Gestion des clés** : la clé HMAC vit dans la même base que le journal. Un administrateur de la base pourrait théoriquement tout recalculer. Pour l'audit, déplacer la signature hors base (secret serveur dans Vercel, fonction de signature, ou KMS) et conserver l'empreinte quotidienne chez un tiers (e-mail au comptable, stockage objet en écriture seule).
3. **Conservation 6 ans** (art. L102 B du LPF) : fixer la politique de sauvegarde Supabase, interdire la suppression d'un compte qui a des ventes (le trigger de verrouillage la bloque déjà), prévoir l'export d'archive à la résiliation.
4. **Horloge** : l'heure vient du serveur Postgres ; documenter la synchronisation.
5. **Documentation éditeur** : version du logiciel, journal des changements, procédure de mise à jour (une mise à jour ne doit pas modifier l'historique), contact support.
6. **Impression et affichage** : faire relire les tickets (mentions, TVA, signature) et le Z par l'expert-comptable ; ajouter si besoin la version du logiciel sur le ticket.
7. **Limites actuelles** : paiement par carte : relié à un terminal SumUp Solo (référence de transaction sur le ticket, preuve d'encaissement), sinon simplement enregistré ; remboursement d'un paiement terminal à faire dans le compte SumUp ; pas de stock ni de codes-barres ; pas de pourboires ; pas de comptes vendeurs distincts (l'auteur est le compte connecté) ; ce n'est pas un FEC.

## 4. Pour l'expert-comptable

- Exports : `export-comptable.html` (CSV et rapport) ; les ventes de caisse y figurent comme factures payées, les avoirs comme factures à lignes négatives.
- Lien en lecture seule pour le comptable : voir CLAUDE.md §3.38.
- Pour contrôler : bouton « Conformité » de la caisse (intégrité, grands totaux), puis « Télécharger l'archive ».
