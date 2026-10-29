// Mirrio Caisse : identité de l'éditeur pour l'attestation individuelle de conformité (art. 286 I 3° bis du CGI).
//
// `active` reste FAUX tant que le représentant légal de l'éditeur n'a pas relu le dossier (docs/caisse-conformite.md, docs/audit-isca.md),
// fait valider le texte par son expert-comptable et décidé de signer. Passer à `true` est un acte juridique : il engage l'éditeur pour
// chaque salon qui imprime l'attestation. Les champs [À COMPLÉTER] doivent être remplacés par les vraies informations avant toute activation.
// La page `attestation-caisse.html` refuse d'ailleurs de produire le document tant qu'un champ reste à compléter ou qu'un contrôle d'audit échoue.
export const ATTESTATION = {
  active: false,
  logiciel: 'Mirrio Caisse',
  editeur: {
    nom: 'Dima Artistry SARL',
    forme: 'société à responsabilité limitée',
    adresse: '[À COMPLÉTER : adresse du siège]',
    immatriculation: '[À COMPLÉTER : registre du commerce et identifiant fiscal]',
    pays: 'Maroc',
    representant: '[À COMPLÉTER : prénom et nom du représentant légal]',
    qualite: '[À COMPLÉTER : gérant]',
    lieu: '[À COMPLÉTER : ville de signature]'
  },
  signature: null          // chemin d'une image de signature déposée dans site/brand/, ex. 'brand/signature-editeur.png'
};
