# BACKLOG.md — Ce qu'il reste à faire sur Cadence

Suivi de session en session. On coche au fur et à mesure ; une ligne cochée reste dans le fichier (comme trace), elle ne se supprime pas.

Dernière mise à jour : 22 août 2026.

---

## Fonctionnalités non construites

- [ ] **Import d'un agenda externe vers Cadence (le sens entrant).** Cadence pousse déjà vers Google Calendar (`site/google-calendar.js`), rien ne fait le sens inverse (récupérer les événements d'un agenda externe dans Cadence).
- [ ] **Encaissement Stripe des abonnements Cadence elle-même.** `profiles.plan` (solo/studio) est purement déclaratif aujourd'hui — aucun prélèvement réel, pas d'intégration Stripe.
- [ ] **Rôles au sein d'une équipe autres que propriétaire/collaborateur.** Pas de permissions fines par membre pour l'instant (voir CLAUDE.md §3.3).
- [ ] **Mesure réelle de l'usage Supabase/Vercel dans le back-office admin.** `admin.html` estime la capacité à partir du nombre de clients, pas d'un appel aux API d'usage réelles (voir CLAUDE.md §3.7).
- [ ] **Fermetures ponctuelles (vacances, jour férié) sur la réservation en ligne.** Seul un horaire hebdomadaire récurrent existe aujourd'hui ; désactiver la réservation bloque tout le calendrier, pas juste un jour (voir CLAUDE.md §3.10).

## Décision en attente côté toi

- [ ] **Choisir une direction visuelle pour la refonte de `clients.html`.** 4 maquettes livrées (Atelier / Nocturne / Clair / Repère) dans `site/maquettes-clients.html` — accessible depuis Paramètres → Apparence, bouton « Voir les 4 maquettes » (le lien externe vers l'artifact Claude a été abandonné : il exigeait une connexion claude.ai et affichait « Page not found » en pratique). Rien n'est implémenté dans le vrai `clients.html` tant que tu n'as pas choisi une direction. Une fois le choix fait, penser à supprimer `site/maquettes-clients.html` (voir CLAUDE.md §3.14).

## Configuration / infra à vérifier ou finaliser

- [ ] **Renseigner le SIRET et l'adresse physique** dans `site/cgu.html` et `site/confidentialite.html` — actuellement marqués `[À COMPLÉTER]` en ambre, volontairement pas inventés.
- [ ] **Passer l'app Google OAuth de « Test » à « Production »** dans la console Google Cloud. Les pages CGU/confidentialité existent maintenant (seul prérequis documenté côté Cadence) ; le passage lui-même reste une démarche manuelle côté console Google, qui déclenchera l'écran « application non validée » tant que Google n'a pas fait sa propre vérification.
- [ ] **Vérifier/déclarer sur Vercel `RESEND_API_KEY` et `RESEND_FROM`.** Sans ça, les relances de factures en retard et les emails de confirmation de réservation en ligne ne partent tout simplement jamais — silencieusement, sans bloquer le reste.
- [ ] **Vérifier que `SUPABASE_SERVICE_ROLE_KEY` et `CRON_SECRET` sont bien déclarés sur Vercel** — nécessaires au flux iCalendar, aux relances automatiques et aux routes publiques de réservation en ligne.
- [ ] **Clarifier les deux projets Vercel « cadence »/« cadence-site » repérés en double.** *Mise à jour 13 oct. 2026 : `cadence` est protégé par l'authentification Vercel (302 vers vercel.com), `cadence-site` est public (200). Désactiver la protection de `cadence` ou le supprimer ; ne partager que l'adresse de `cadence-site`.* — — vérifier lequel est réellement branché sur le domaine de prod, supprimer l'autre si c'est bien un doublon inutile. (Pas pu vérifier moi-même cette session : le connecteur Vercel MCP ne remonte aucun projet pour l'équipe « Cadence », probablement un compte/scope différent de celui utilisé côté dashboard web.)

## Fait / vérifié cette session (22 août 2026)

- [x] Réservation en ligne (widget public) — `schema-v6-reservation-en-ligne.sql`, routes API, agenda, onglet réglages.
- [x] Statut d'activité + localisation dans le back-office admin — `schema-v7-admin-activite-geo.sql`.
- [x] Lien « Back-office » dans la nav pour les comptes admin (`theme.js`).
- [x] Devis → facture : vérifié déjà fonctionnel de bout en bout, aucun changement de code nécessaire.
- [x] Pages CGU / politique de confidentialité (`cgu.html`, `confidentialite.html`) + liens câblés dans `signup.html` et `index.html`.
- [x] Sélection d'une prestation du catalogue (agenda + devis/factures) — fait directement pendant que je travaillais sur autre chose.

## Limites connues et assumées (pas un TODO — pour mémoire, à ne pas re-signaler comme un bug)

- Pas de contrainte anti-chevauchement en base sur les rendez-vous (jamais eu, pas ajoutée rétroactivement).
- Fenêtre de course résiduelle sur la réservation en ligne entre lecture des créneaux et écriture (mitigée côté serveur, pas éliminée).
- `admin.html` : « Formule » et « Statut » ne reflètent pas une vraie facturation/résiliation — seulement une déclaration de plan et un proxy d'inactivité de connexion.
