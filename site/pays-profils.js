// Mirrio — profils pays : tout ce qui change d'un pays à l'autre, au même endroit.
//
// Un salon choisit son pays dans Paramètres, Devis et factures (parametres_facturation.profil_pays, schema-v49). Le profil règle :
// la monnaie et sa mise en forme, les taux de TVA proposés, la mention de non-assujettissement, l'intitulé de l'identifiant d'entreprise,
// la durée de conservation à rappeler pour les archives, la règle de certification de la caisse à afficher, et les moyens de paiement
// en ligne (terminal SumUp et lien Stripe sont écrits pour l'euro : ils ne sont proposés qu'aux profils en euros où SumUp et Stripe opèrent).
//
// ATTENTION : seul le profil FR a été vérifié sur des sources officielles (economie.gouv.fr). Les valeurs de BE, CH et MA viennent de la mémoire
// du développeur ou de blogs : `aValider` reste vrai tant qu'un expert-comptable du pays ne les a pas confirmées. Ne pas communiquer dessus avant.
// Ajouter un pays : une entrée ici, une valeur dans la contrainte de schema-v49, et rien d'autre ne doit changer dans les écrans.
export const PROFILS = {
  FR: { code:'FR', nom:'France', devise:'EUR', locale:'fr-FR', tva:[20, 10, 5.5, 2.1, 0], tvaDefaut:20, identifiant:'SIRET', identifiantCourt:'SIRET',
        mentionFranchise:'TVA non applicable, art. 293 B du CGI.', conservationAns:6, enLigne:true, aValider:false,
        certification:'En France, un salon assujetti à la TVA qui encaisse des particuliers doit utiliser une caisse certifiée NF525 ou attestée par son éditeur (art. 286 I 3° bis du CGI).' },
  BE: { code:'BE', nom:'Belgique', devise:'EUR', locale:'fr-BE', tva:[21, 12, 6, 0], tvaDefaut:21, identifiant:'Numéro d\'entreprise (BCE)', identifiantCourt:'BCE',
        mentionFranchise:'Petite entreprise soumise au régime de franchise de la taxe : TVA non applicable.', conservationAns:7, enLigne:true, aValider:true,
        certification:'Belgique : le système de caisse enregistreuse certifié ne concerne, à notre connaissance, que l\'horeca. À confirmer avec votre comptable.' },
  CH: { code:'CH', nom:'Suisse', devise:'CHF', locale:'fr-CH', tva:[8.1, 3.8, 2.6, 0], tvaDefaut:8.1, identifiant:'Numéro IDE', identifiantCourt:'IDE',
        mentionFranchise:'Non assujetti à la TVA.', conservationAns:10, enLigne:false, aValider:true,
        certification:'Suisse : aucune obligation de certification de la caisse à notre connaissance. À confirmer avec votre fiduciaire.' },
  MA: { code:'MA', nom:'Maroc', devise:'MAD', locale:'fr-MA', tva:[20, 14, 10, 7, 0], tvaDefaut:20, identifiant:'ICE (identifiant commun de l\'entreprise)', identifiantCourt:'ICE',
        mentionFranchise:'Opération non soumise à la TVA.', conservationAns:10, enLigne:false, aValider:true,
        certification:'Maroc : aucune certification de caisse identifiée ; la facturation électronique de la DGI s\'applique par étapes. À confirmer avec votre expert-comptable.' }
};

const CLE = 'mirrio:profil-pays';
let actif = 'FR';
try{ const c = sessionStorage.getItem(CLE); if(c && PROFILS[c]) actif = c; }catch(e){}

export function definirProfil(code){
  if(!PROFILS[code]) return actif;
  actif = code;
  try{ sessionStorage.setItem(CLE, code); }catch(e){}
  return actif;
}
export const profil = () => PROFILS[actif];
export function formaterMontant(n, options = {}){
  const p = PROFILS[actif];
  return new Intl.NumberFormat(p.locale, { style:'currency', currency:p.devise, ...options }).format(Number(n) || 0);
}
export const libelleTva = t => `${String(t).replace('.', ',')} %`;
