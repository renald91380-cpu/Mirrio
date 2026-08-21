// Cadence — thème et vocabulaire de l'utilisateur, partagés par tous les écrans applicatifs.
//
// Pourquoi un module partagé alors que la règle du projet est « un fichier autonome
// par écran » : la personnalisation est par définition transversale. La dupliquer
// dans cinq fichiers garantirait qu'ils divergent. Ce module suit la même forme que
// `supabase-config.js` — un module ES importé, pas un framework, pas d'étape de build.
//
// Utilisation dans un écran :
//   import { initTheme } from './theme.js';
//   const brand = await initTheme(supabase, 'clients');   // 'clients' = onglet actif

// ---------------------------------------------------------------------------
// Accents disponibles
// ---------------------------------------------------------------------------
// Jeu fermé, et non un sélecteur de couleur libre : chaque accent a été vérifié
// par calcul pour (a) porter un texte à un contraste >= 4.5:1, (b) rester à une
// distance perceptuelle >= 15 (OKLab x100) de la Sarcelle, qui signifie
// « argent qui rentre / payé », et >= 13 de la Brique, qui signifie « alerte ».
// Un color picker libre laisserait l'utilisateur choisir un vert qui rendrait
// ses pastilles « Payé » illisibles — la contrainte est ici un service rendu.

export const ACCENTS = {
  ambre:  { hex:'#E2A63D', texte:'#1C2333', doux:'#F0C98A', nom:'Ambre',      note:'Le réglage d’origine de Cadence' },
  marine: { hex:'#244990', texte:'#F5F1E7', doux:'#8FA6D4', nom:'Marine',     note:'Sobre, orienté conseil' },
  ciel:   { hex:'#58A1E5', texte:'#1C2333', doux:'#B7D6F5', nom:'Ciel',       note:'Clair et ouvert' },
  acajou: { hex:'#822E02', texte:'#F5F1E7', doux:'#D9A183', nom:'Acajou',     note:'Chaud, artisanal' },
  foret:  { hex:'#155D16', texte:'#F5F1E7', doux:'#93C795', nom:'Forêt',      note:'Naturel, extérieur' },
  rose:   { hex:'#CC7097', texte:'#1C2333', doux:'#EFC2D5', nom:'Rose ancien',note:'Doux, créatif' }
};

export const ACCENT_DEFAUT = 'ambre';

// ---------------------------------------------------------------------------
// Vocabulaire métier
// ---------------------------------------------------------------------------
// Un photographe ne fait pas des « séances », il fait des shootings ; un
// professeur donne des cours. Un seul réglage renomme les rendez-vous partout :
// titres d'écran, états vides, libellés de formulaire, lignes de devis.

export const METIERS = {
  photographe: { nom:'Photographe',            singulier:'shooting', pluriel:'shootings' },
  coach:       { nom:'Coach sportif',          singulier:'séance',   pluriel:'séances'   },
  formateur:   { nom:'Formateur',              singulier:'session',  pluriel:'sessions'  },
  professeur:  { nom:'Professeur particulier', singulier:'cours',    pluriel:'cours'     },
  consultant:  { nom:'Consultant',             singulier:'mission',  pluriel:'missions'  },
  therapeute:  { nom:'Praticien bien-être',    singulier:'séance',   pluriel:'séances'   },
  autre:       { nom:'Autre métier',           singulier:'rendez-vous', pluriel:'rendez-vous' }
};

const CLE_CACHE = 'cadence:brand';

// Valeurs de repli : ce que voit un compte qui n'a rien personnalisé.
const DEFAUT = {
  business_name: 'Cadence',
  metier: 'autre',
  terme_singulier: null,
  terme_pluriel: null,
  accent: ACCENT_DEFAUT,
  densite: 'confortable',
  logo_url: null
};

// ---------------------------------------------------------------------------
// Vocabulaire résolu
// ---------------------------------------------------------------------------

export function vocabulaire(brand){
  const base = METIERS[brand?.metier] || METIERS.autre;
  const singulier = (brand?.terme_singulier || base.singulier).trim();
  const pluriel   = (brand?.terme_pluriel   || base.pluriel).trim();
  const cap = (s) => s.charAt(0).toUpperCase() + s.slice(1);

  // Le genre pilote les accords. Les termes connus sont listés ; pour un terme
  // saisi librement, on retombe sur une heuristique — « -tion », « -ance »,
  // « -ée » sont féminins en français, le reste est traité au masculin.
  const feminins = /^(séance|session|mission|consultation|leçon|répétition|prestation|visite)/i;
  const feminin = feminins.test(singulier) || /(tion|ance|ence|ée|ité)$/i.test(singulier);

  return {
    singulier,
    pluriel,
    Singulier: cap(singulier),
    Pluriel: cap(pluriel),
    feminin,
    // « un shooting » / « une séance » — les accords suivent le terme choisi.
    article: feminin ? 'une' : 'un',
    Nouveau: feminin ? 'Nouvelle' : 'Nouveau',
    Aucun: feminin ? 'Aucune' : 'Aucun'
  };
}

// ---------------------------------------------------------------------------
// Application du thème
// ---------------------------------------------------------------------------

let styleTag = null;

export function appliquerTheme(brand){
  const b = { ...DEFAUT, ...(brand || {}) };
  const accent = ACCENTS[b.accent] || ACCENTS[ACCENT_DEFAUT];
  const root = document.documentElement;

  // `--amber` est réassignée plutôt que remplacée : tous les écrans existants
  // la référencent déjà, donc ils se thémisent sans qu'on touche à leur CSS.
  root.style.setProperty('--amber', accent.hex);
  root.style.setProperty('--amber-soft', accent.doux);
  root.style.setProperty('--accent', accent.hex);
  root.style.setProperty('--accent-soft', accent.doux);
  root.style.setProperty('--accent-text', accent.texte);
  root.setAttribute('data-densite', b.densite);
  root.setAttribute('data-accent', b.accent);

  if(!styleTag){
    styleTag = document.createElement('style');
    styleTag.id = 'cadence-theme';
    document.head.appendChild(styleTag);
  }

  // Le texte d'un bouton primaire suit l'accent : encre sur un accent clair,
  // parchemin sur un accent sombre. Codé en dur, un accent sombre donnerait
  // un bouton illisible.
  styleTag.textContent = `
    .btn-primary{ background:var(--accent) !important; color:var(--accent-text) !important; }
    .btn-primary:hover{ box-shadow:0 8px 18px color-mix(in srgb, var(--accent) 30%, transparent) !important; }
    .app-nav a.active{ border-bottom-color:var(--accent) !important; }
    .logo .dot{ color:var(--accent) !important; }
    @keyframes pulseDot{
      0%, 70%, 100%{ transform:scale(1); opacity:0.3; }
      35%{ transform:scale(1.9); opacity:1; background:var(--accent); }
    }
    :root[data-densite="compacte"] .app-main{ padding-top:24px !important; }
    :root[data-densite="compacte"] .page-head{ margin-bottom:20px !important; }
    :root[data-densite="compacte"] .client-row,
    :root[data-densite="compacte"] .doc-row,
    :root[data-densite="compacte"] .rdv-row{ padding:11px 16px !important; }
    :root[data-densite="compacte"] .client-list,
    :root[data-densite="compacte"] .doc-list{ gap:6px !important; }
    :root[data-densite="compacte"] .page-head h1{ font-size:25px !important; }
  `;

  return b;
}

// ---------------------------------------------------------------------------
// En-tête applicatif
// ---------------------------------------------------------------------------
// Le nom commercial de l'utilisateur prend la place du mot-clé « Cadence » :
// l'outil s'efface derrière le travail du praticien (charte, §2). Cadence reste
// signée discrètement en pied d'écran, pas en tête.

const ONGLETS = [
  { cle:'dashboard',href:'dashboard.html',      libelle:'Tableau de bord' },
  { cle:'clients',  href:'clients.html',        libelle:'Clients' },
  { cle:'agenda',   href:'agenda.html',         libelle:'Agenda' },
  { cle:'documents',href:'devis-factures.html', libelle:'Devis & factures' },
  { cle:'reglages', href:'parametres.html',     libelle:'Paramètres' }
];

function echapper(str){
  const d = document.createElement('div');
  d.textContent = str == null ? '' : String(str);
  return d.innerHTML;
}

export function monterEntete(brand, actif){
  const b = { ...DEFAUT, ...(brand || {}) };
  const logoEl = document.querySelector('.app-header .logo');
  if(logoEl){
    const nom = (b.business_name || 'Cadence').trim() || 'Cadence';
    if(b.logo_url){
      logoEl.innerHTML =
        `<img src="${echapper(b.logo_url)}" alt="${echapper(nom)}" ` +
        `style="height:26px;width:auto;max-width:150px;object-fit:contain;border-radius:3px;">`;
    } else {
      logoEl.innerHTML = `${echapper(nom)}<span class="dot">.</span>`;
    }
    logoEl.setAttribute('title', nom);
  }

  const nav = document.querySelector('.app-header .app-nav');
  if(nav){
    nav.innerHTML = ONGLETS.map(o =>
      `<a href="${o.href}"${o.cle === actif ? ' class="active"' : ''}>${o.libelle.replace('&','&amp;')}</a>`
    ).join('');
  }
}

// ---------------------------------------------------------------------------
// Chargement
// ---------------------------------------------------------------------------

// Le thème en cache est appliqué immédiatement, avant tout aller-retour réseau :
// sans ça l'écran s'affiche en ambre puis saute vers l'accent choisi à chaque
// navigation. Le cache est ensuite corrigé par la valeur serveur si elle diffère.
export function appliquerThemeEnCache(){
  try{
    const brut = sessionStorage.getItem(CLE_CACHE);
    if(brut) return appliquerTheme(JSON.parse(brut));
  }catch(e){ /* sessionStorage indisponible : on tombe sur le thème par défaut */ }
  return appliquerTheme(null);
}

// `espaceId` cible le profil dont on veut lire la marque : celui du propriétaire
// de l'espace actif, pas forcément l'utilisateur connecté. Un collaborateur qui
// travaille dans l'espace d'un tiers doit voir ET imprimer le nom commercial,
// le logo et le vocabulaire de CE tiers, pas les siens (souvent vierges). Sans
// ce paramètre (appel historique), on retombe sur la ligne de l'utilisateur
// connecté via le filtre RLS implicite.
export async function chargerBrand(supabase, espaceId){
  let requete = supabase
    .from('profiles')
    .select('business_name, metier, terme_singulier, terme_pluriel, accent, densite, logo_url, full_name, plan');
  requete = espaceId ? requete.eq('id', espaceId) : requete;
  const { data, error } = await requete.maybeSingle();

  if(error || !data) return { ...DEFAUT };

  const brand = {
    business_name: data.business_name || data.full_name || 'Cadence',
    metier: data.metier || 'autre',
    terme_singulier: data.terme_singulier,
    terme_pluriel: data.terme_pluriel,
    accent: ACCENTS[data.accent] ? data.accent : ACCENT_DEFAUT,
    densite: data.densite === 'compacte' ? 'compacte' : 'confortable',
    logo_url: data.logo_url || null,
    full_name: data.full_name || null,
    plan: data.plan || 'solo'
  };

  try{ sessionStorage.setItem(CLE_CACHE, JSON.stringify(brand)); }catch(e){}
  return brand;
}

export function viderCacheBrand(){
  try{ sessionStorage.removeItem(CLE_CACHE); }catch(e){}
}

// Point d'entrée unique : applique le cache, charge la vraie valeur, remonte
// l'en-tête, et renvoie la marque résolue.
export async function initTheme(supabase, ongletActif){
  appliquerThemeEnCache();
  const espaceId = await idEspaceActif(supabase);
  const brand = await chargerBrand(supabase, espaceId);
  appliquerTheme(brand);
  monterEntete(brand, ongletActif);
  return brand;
}

// ---------------------------------------------------------------------------
// Espace de travail actif
// ---------------------------------------------------------------------------
// Un compte solo est son propre espace : `owner_id` vaut son `auth.uid()`, comme
// avant l'introduction du partage multi-collaborateurs. Un collaborateur qui a
// rejoint l'espace d'un tiers doit en revanche poser `owner_id = <id du
// propriétaire>` sur tout ce qu'il crée — sinon ses clients/rendez-vous/devis
// lui appartiendraient en propre, invisibles au reste de l'équipe.
//
// `current_workspace_id()` tranche déjà cette question côté base (RLS s'appuie
// dessus). On la rappelle ici via RPC pour connaître, côté client, LA valeur à
// écrire dans `owner_id` au moment d'un insert — la fonction ne s'applique
// qu'aux clauses `using`/`with check` d'une policy, jamais à la valeur envoyée
// par le formulaire, qui reste à la charge de l'écran.
//
// Mise en cache en mémoire pour la durée de la page : l'espace actif ne change
// qu'après un rechargement (bascule dans Paramètres → onglet Équipe).
let cacheEspaceId = null;

export async function idEspaceActif(supabase){
  if(cacheEspaceId) return cacheEspaceId;
  try{
    const { data, error } = await supabase.rpc('current_workspace_id');
    if(!error && data){
      cacheEspaceId = data;
      return cacheEspaceId;
    }
  }catch(e){ /* on retombe sur son propre compte ci-dessous */ }

  const { data: auth } = await supabase.auth.getUser();
  cacheEspaceId = auth?.user?.id || null;
  return cacheEspaceId;
}

export function viderCacheEspace(){
  cacheEspaceId = null;
}
