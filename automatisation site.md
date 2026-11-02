# Contexte projet — Système d'agents autonomes pour Cadence

> Ce fichier résume les décisions et l'état d'avancement du système d'agents IA
> construit pour Cadence (app de gestion pour consultants indépendants à clients
> récurrents : photographes, retoucheurs, coachs). Il a été préparé suite à une
> session de conception avec Claude (claude.ai) pour donner à Claude Code tout
> le contexte nécessaire.

## Contexte général

Renald Gautier (fondateur de Dima Artistry SARL, Casablanca) développe **Cadence**,
un SaaS de gestion de pratique pour indépendants avec clients récurrents. L'objectif
de cette phase : ajouter un **système d'agents IA autonomes** qui automatisent des
tâches métier (relances de factures, planification, qualification de prospects,
rétention, facturation), avec un principe de sécurité central : **aucune action
n'est envoyée sans validation humaine au départ** (mode "supervision"), avec
passage progressif vers plus d'autonomie une fois la confiance établie.

## Projet Supabase

- **Project ref** : `uymqmbvhneijboszcwsf`
- **Nom** : `supabase-lime-engine`
- **Région** : eu-central-2
- Tables existantes de Cadence (ne pas recréer) : `profiles`, `clients`,
  `rendez_vous`, `documents`, `document_lignes`, `document_counters`,
  `parametres_facturation`, `prestations`, `calendar_feeds`,
  `calendar_connections`, `workspace_members`, `admin_config`,
  `parametres_reservation`

## Ce qui a été construit (état actuel)

### 1. Schéma de données agents (migration appliquée)

Deux nouvelles tables, RLS activé, policy `owner_id = auth.uid()` :

- **`agent_config`** — un enregistrement par owner + type d'agent
  - `owner_id`, `agent_type` (enum : `relance_facture`, `planification`,
    `qualification_prospect`, `retention`, `facturation`), `actif` (bool),
    `mode` (`supervision` | `autonome`), `parametres` (jsonb)
- **`agent_actions`** — journal de toutes les actions proposées/exécutées
  - `owner_id`, `agent_type`, `cible_type`, `cible_id`, `statut`
    (`proposee` → `validee`/`rejetee` → `executee`/`echouee`), `titre`,
    `payload` (jsonb — contient le brouillon d'email, montant, etc.),
    `resultat` (jsonb), `created_at`, `traitee_at`

### 2. Edge Function `agent-relance`

Rôle : scanne les factures en retard (`documents` où `type='facture'`,
statut envoyé, `date_echeance` dépassée), respecte le délai configuré dans
`parametres_facturation.relance_delai_jours`, génère un brouillon d'email
via l'API Claude (`claude-sonnet-4-6`) avec un ton qui s'adapte au nombre de
relances déjà envoyées, et crée une `agent_action` en statut `proposee`.

**Sécurité intégrée** : si l'appel à l'API Claude échoue (ex: crédits API
insuffisants), un texte de fallback générique est utilisé — le pipeline ne
plante jamais, il dégrade proprement.

**Secrets requis** (Supabase → Edge Functions → Secrets) :
- `ANTHROPIC_API_KEY` — ⚠️ nom exact requis, un piège précédent : le secret
  avait été nommé différemment ("Cadence key"), ce qui le rendait invisible
  pour `Deno.env.get()`

**Statut de test** : pipeline testé de bout en bout avec des données factices
(client + facture de test, ids `00000000-0000-0000-0000-000000000001` et
`...002`, à nettoyer avant la mise en prod réelle). Le flux data fonctionne
(200 OK, action créée). **Le texte généré est encore le fallback générique** :
les crédits API Anthropic (console.anthropic.com → Billing) n'étaient pas
encore actifs au moment du dernier test — **à revalider dès que les crédits
sont chargés**.

### 3. Cron quotidien

`pg_cron` + `pg_net` activés sur le projet. Job `agent-relance-quotidien`,
tous les jours à **9h00 UTC** (10h Maroc), appelle l'Edge Function via
`net.http_post` avec la clé "anon" en Authorization Bearer.

### 4. Dashboard de supervision — déplacé sur le domaine Cadence (résolu 2026-08-24)

L'Edge Function Supabase `agent-dashboard` (servie sur `*.supabase.co`)
s'affichait en **code source brut** sur le téléphone de Renald (réseau
Orange/SFR), même en navigation privée et même avec une fonction de test
minimale (`test-html`) — Google fonctionnait normalement. Hypothèse
retenue : filtrage réseau opérateur qui intercepte le domaine
`supabase.co`, pas un bug côté code (déjà durci avec plusieurs variantes
de headers, sans effet).

**Fix** : plutôt que de continuer à chasser le filtrage opérateur, le
dashboard est maintenant servi comme une page normale du site Cadence —
même domaine que login/agenda/etc., qui fonctionne déjà sans souci sur ce
même téléphone.

- `site/agent-dashboard.html` — page responsive (grille `auto-fill`, une
  colonne sur mobile, plusieurs sur tablette/desktop), charte graphique
  Cadence (Fraunces/Inter, couleurs ink/parchment/teal/brick). Liste les
  actions `proposee`, boutons Valider/Rejeter.
- `api/agent-actions.js` — nouvelle fonction serverless Vercel, même
  schéma que `api/document-public.js` : lit/écrit `agent_actions` avec la
  clé `service_role`, contrôle d'accès par comparaison du secret
  `DASHBOARD_SECRET` (query param `?key=...`), pas de policy RLS.
- L'Edge Function Supabase `agent-dashboard` (et `test-html`, purement
  diagnostique) peuvent être supprimées une fois ce nouveau dashboard
  validé en usage réel — laissées en place pour l'instant par prudence.
- Accès : `https://<domaine-cadence>/agent-dashboard.html?key=<DASHBOARD_SECRET>`.

**Reste à faire pour que ce soit opérationnel** :
1. Déclarer sur Vercel les variables d'environnement `SUPABASE_URL`,
   `SUPABASE_SERVICE_ROLE_KEY` et `DASHBOARD_SECRET` (la même valeur que
   le secret Supabase déjà utilisé par l'ancienne Edge Function) si ce
   n'est pas déjà fait.
2. `git push` (fait à la main par Renald — le sandbox `device_bash` n'a
   pas accès réseau pour `git push`) puis vérifier que Vercel redéploie.
3. Tester l'affichage sur le téléphone (réseau mobile ET Wi-Fi) pour
   confirmer que le filtrage opérateur ne touche pas le domaine Cadence.

**Important, inchangé** : cliquer "Valider" ne fait toujours que passer
le statut en base à `validee` — **aucun email n'est réellement envoyé**.
L'intégration Gmail réelle reste à construire (voir prochaines étapes).

## Prochaines étapes (dans l'ordre logique)

1. ~~Débloquer l'affichage du dashboard~~ — fait le 2026-08-24 en déplaçant
   le dashboard sur le domaine Cadence (voir §4 ci-dessus). Reste juste à
   déployer (env vars Vercel + `git push`) et confirmer sur le terrain.
2. **Confirmer les crédits Anthropic actifs** et revalider que
   `agent-relance` génère un vrai brouillon (pas le fallback)
3. **Brancher l'envoi réel de l'email** quand une action est validée —
   options envisagées : intégration Gmail API (OAuth2) directement dans une
   Edge Function, ou webhook vers un service qui a accès au connecteur Gmail
4. **Nettoyer les données de test** (client + facture test, préfixe id
   `00000000-...`) avant mise en prod
5. **Deuxième agent** — candidat naturel selon la conversation initiale :
   Planification ou Facturation (à reconfirmer avec Renald selon priorité
   business)
6. **Orchestrateur** — logique de routage/priorisation entre agents une fois
   plusieurs agents actifs
7. **Autonomie progressive** — basculer `agent_config.mode` de `supervision`
   à `autonome` sur les actions à faible risque, une fois la confiance
   établie

## Notes de sécurité à respecter

- Ne jamais coller de clé API en clair dans une conversation — toujours
  passer par les secrets Supabase directement (une clé exposée dans ce
  projet a déjà été révoquée suite à un incident au fil de la construction)
- Tout nouvel agent doit démarrer en mode `supervision` par défaut, jamais
  `autonome` d'emblée
- Les policies RLS (`owner_id = auth.uid()`) doivent être répliquées sur
  toute nouvelle table liée aux agents
