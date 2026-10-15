# Emails d'authentification Mirrio

Gabarits HTML pour les emails envoyés par Supabase Auth, en français et à la charte Mirrio.

---

## 1. Poser les gabarits

Supabase → **Authentication** → **Emails** → **Templates**. Pour chaque modèle, coller le contenu du fichier dans le champ *Message body* et renseigner l'objet.

| Modèle Supabase | Fichier | Objet à saisir |
|---|---|---|
| Confirm signup | `confirmation-inscription.html` | `Plus qu'un clic pour lancer Mirrio` |
| Magic Link | `lien-magique.html` | `Votre lien de connexion Mirrio` |
| Reset Password | `reinitialisation-mot-de-passe.html` | `Choisissez un nouveau mot de passe` |
| Change Email Address | `changement-email.html` | `Confirmez votre nouvelle adresse` |

Les gabarits utilisent la variable `{{ .ConfirmationURL }}`, la seule nécessaire ici. Supabase en expose d'autres si besoin : `{{ .Token }}` (code à 6 chiffres), `{{ .Email }}`, `{{ .SiteURL }}`.

---

## 2. Changer l'expéditeur — l'étape qui compte vraiment

Tel quel, l'email part de **`Supabase Auth <noreply@mail.app.supabase.io>`**. Aucun gabarit ne change ça : le nom et l'adresse d'expédition viennent du serveur d'envoi, pas du contenu. Un joli message expédié par `mail.app.supabase.io` reste un message qui n'a pas l'air de venir de vous.

Il faut donc brancher un SMTP personnalisé : **Authentication** → **Emails** → **SMTP Settings**.

Deux raisons de le faire, pas une :

1. **La crédibilité.** L'expéditeur devient `Mirrio <bonjour@votre-domaine.fr>`.
2. **Le volume.** Le service d'envoi intégré de Supabase est bridé à quelques emails par heure et explicitement réservé aux tests. En production, les inscriptions passeraient à la trappe sans prévenir.

Fournisseurs qui conviennent, tous avec une offre gratuite suffisante au démarrage : **Resend**, **Brevo**, **Postmark**, **Mailgun**.

La marche à suivre est la même partout :

1. Créer un compte, y ajouter votre domaine.
2. Publier les enregistrements DNS demandés — **SPF**, **DKIM**, et idéalement **DMARC**. Sans eux, Gmail classe en spam ou refuse.
3. Récupérer l'hôte SMTP, le port (587), l'utilisateur et le mot de passe.
4. Les saisir dans Supabase, avec *Sender name* = `Mirrio` et *Sender email* = une adresse de votre domaine.

Tant que le domaine n'est pas authentifié, mieux vaut rester sur l'envoi Supabase : un domaine mal configuré abîme durablement la réputation d'expédition.

---

## 3. Choix de fabrication

Le HTML est volontairement daté — tableaux, styles inline, largeur fixe de 600 px. Ce n'est pas de la négligence : Outlook rend le HTML avec le moteur de Word, qui ignore flexbox, grid et une bonne partie des feuilles de style embarquées. Les points notables :

- **Bouton « bulletproof »** : un bloc VML sous condition `[if mso]` dessine le fond que Word refuse de peindre. Sans lui, le bouton apparaît en simple lien bleu sur Outlook.
- **Pas de police web.** Fraunces et Inter ne se chargent pas dans un client mail. Georgia tient le rôle du titre, la pile système celui du texte.
- **`color-scheme: light`** pour éviter que le mode sombre de Gmail ou d'Apple Mail n'inverse les couleurs et ne fasse disparaître l'ambre.
- **Texte d'aperçu masqué** en tête de chaque gabarit : c'est la ligne que la boîte de réception affiche à côté de l'objet. Sans elle, Gmail y met les premiers mots trouvés, souvent « Mirrio Mirrio ».
- **Lien de secours en clair** sous le bouton, pour les clients qui neutralisent les liens.
- **Ton** conforme à la charte (§7) : verbes actifs, phrases courtes, et le cas « ce n'est pas vous » traité sans dramatiser.

---

## 4. Avant de mettre en production

- S'envoyer chaque modèle et l'ouvrir sur Gmail web, Gmail mobile, Apple Mail et Outlook.
- Vérifier que l'objet ne dépasse pas ~45 caractères, au-delà il est tronqué sur mobile.
- Contrôler que le lien de secours reste cliquable-copiable sans césure gênante.
