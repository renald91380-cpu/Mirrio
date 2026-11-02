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
// Styles d'interface
// ---------------------------------------------------------------------------
// Quatre identités visuelles au choix de chaque abonné (Paramètres → Apparence),
// pas un réglage global : ce sont ses propres client·e·s qui verront/utiliseront
// l'écran, donc c'est à lui de choisir ce qui leur parlera. La couleur d'accent
// (ACCENTS ci-dessus) reste un réglage séparé et orthogonal : le style change la
// disposition (nav du haut / menu latéral), la police et la tonalité de fond ;
// l'accent reste la couleur de marque appliquée par-dessus, quel que soit le
// style choisi.
export const STYLES = {
  atelier:  { nom:'Atelier',  note:'L’identité Cadence d’origine — nav en haut, parchemin, Fraunces.' },
  nocturne: { nom:'Nocturne', note:'Menu latéral sombre, icônes seules, look feutré.' },
  clair:    { nom:'Clair',    note:'Minimal et silencieux, un seul accent, aucune barre latérale.' },
  repere:   { nom:'Repère',   note:'L’identité Cadence en menu latéral classique, avec libellés.' }
};

export const STYLE_DEFAUT = 'atelier';

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
  esthetique:  { nom:'Esthéticienne / institut', singulier:'soin',   pluriel:'soins'     },
  coiffure:    { nom:'Coiffeur·euse',          singulier:'rendez-vous', pluriel:'rendez-vous' },
  onglerie:    { nom:'Prothésiste ongulaire',  singulier:'prestation', pluriel:'prestations' },
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
  logo_url: null,
  style_interface: STYLE_DEFAUT
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
  root.setAttribute('data-style', STYLES[b.style_interface] ? b.style_interface : STYLE_DEFAUT);

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

// Lien vers le back-office (admin.html), ajouté à la volée seulement pour les
// comptes `is_admin` — jamais dans ONGLETS lui-même, qui reste la nav commune
// à tout le monde. admin.html revérifie lui-même l'accès côté serveur
// (`admin_est_admin()`) : ce lien n'est qu'une question de découvrabilité,
// pas la barrière de sécurité.
const ONGLET_ADMIN = { cle:'admin', href:'admin.html', libelle:'Back-office' };

// Icônes des onglets — utilisées uniquement par la variante menu latéral
// (`.sidebar-nav`, écrans migrés vers l'identité « Repère »). La nav du haut
// historique (`.app-header .app-nav`) reste du texte seul, inchangée.
const ICONES_ONGLETS = {
  dashboard: '<rect x="3" y="3" width="7" height="9" rx="1"/><rect x="14" y="3" width="7" height="5" rx="1"/><rect x="14" y="12" width="7" height="9" rx="1"/><rect x="3" y="16" width="7" height="5" rx="1"/>',
  clients: '<path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/><path d="M23 21v-2a4 4 0 0 0-3-3.87M16 3.13a4 4 0 0 1 0 7.75"/>',
  agenda: '<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>',
  documents: '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"/><path d="M14 2v6h6"/>',
  reglages: '<circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09A1.65 1.65 0 0 0 9 19.4a1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09A1.65 1.65 0 0 0 4.6 9a1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/>',
  admin: '<path d="M12 22s8-4 8-10V5l-8-3-8 3v7c0 6 8 10 8 10z"/>'
};

export function monterEntete(brand, actif, estAdmin){
  const b = { ...DEFAUT, ...(brand || {}) };
  const nom = (b.business_name || 'Cadence').trim() || 'Cadence';

  // `.app-header .logo` (nav du haut) ET `.app-sidebar .logo` (menu latéral)
  // coexistent maintenant dans chaque écran — chrome.css n'affiche que l'un
  // des deux selon le style choisi, mais les deux doivent être peuplés pour
  // que la bascule soit instantanée (pas de re-rendu au changement de style).
  document.querySelectorAll('.app-header .logo, .app-sidebar .logo').forEach(logoEl => {
    if(b.logo_url){
      logoEl.innerHTML =
        `<img src="${echapper(b.logo_url)}" alt="${echapper(nom)}" ` +
        `style="height:26px;width:auto;max-width:150px;object-fit:contain;border-radius:3px;">`;
    } else {
      logoEl.innerHTML = `${echapper(nom)}<span class="dot">.</span>`;
    }
    logoEl.setAttribute('title', nom);
  });

  // Pastille compacte (une lettre) pour les styles à menu latéral étroit,
  // icônes seules (« Nocturne ») — le nom complet ne tiendrait pas sur 76px.
  document.querySelectorAll('.app-sidebar .logo-badge').forEach(el => {
    el.textContent = nom.charAt(0).toUpperCase();
    el.setAttribute('title', nom);
  });

  const onglets = estAdmin ? [...ONGLETS, ONGLET_ADMIN] : ONGLETS;

  const navHaut = document.querySelector('.app-header .app-nav');
  if(navHaut){
    navHaut.innerHTML = onglets.map(o =>
      `<a href="${o.href}"${o.cle === actif ? ' class="active"' : ''}>${o.libelle.replace('&','&amp;')}</a>`
    ).join('');
  }

  // Variante menu latéral : mêmes onglets (même ordre, même lien admin), avec
  // icône + libellé au lieu de texte seul.
  const navCote = document.querySelector('.app-sidebar .sidebar-nav');
  if(navCote){
    navCote.innerHTML = onglets.map(o => `
      <a href="${o.href}"${o.cle === actif ? ' class="active"' : ''} title="${echapper(o.libelle)}">
        <svg viewBox="0 0 24 24" fill="none" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">${ICONES_ONGLETS[o.cle] || ''}</svg>
        <span class="nav-label">${o.libelle.replace('&','&amp;')}</span>
      </a>
    `).join('');
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
    .select('business_name, metier, terme_singulier, terme_pluriel, accent, densite, logo_url, full_name, plan, style_interface');
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
    plan: data.plan || 'solo',
    style_interface: STYLES[data.style_interface] ? data.style_interface : STYLE_DEFAUT
  };

  try{ sessionStorage.setItem(CLE_CACHE, JSON.stringify(brand)); }catch(e){}
  return brand;
}

export function viderCacheBrand(){
  try{ sessionStorage.removeItem(CLE_CACHE); }catch(e){}
}

// `is_admin` est un attribut du COMPTE connecté, pas de l'espace actif : un
// collaborateur qui travaille dans l'espace d'un tiers ne doit jamais hériter
// du lien Back-office de ce tiers, et un admin qui travaille dans un espace
// qui n'est pas le sien doit quand même le voir. D'où une requête séparée de
// `chargerBrand()`, filtrée sur l'utilisateur connecté, jamais sur `espaceId`.
async function estCompteAdmin(supabase){
  const { data } = await supabase.auth.getUser();
  const uid = data?.user?.id;
  if(!uid) return false;
  const { data: profil } = await supabase.from('profiles').select('is_admin').eq('id', uid).maybeSingle();
  return !!profil?.is_admin;
}

// Point d'entrée unique : applique le cache, charge la vraie valeur, remonte
// l'en-tête, et renvoie la marque résolue.
export async function initTheme(supabase, ongletActif){
  appliquerThemeEnCache();
  const espaceId = await idEspaceActif(supabase);
  const [brand, estAdmin] = await Promise.all([
    chargerBrand(supabase, espaceId),
    estCompteAdmin(supabase)
  ]);
  appliquerTheme(brand);
  monterEntete(brand, ongletActif, estAdmin);
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

// ---------------------------------------------------------------------------
// Affichage du nom
// ---------------------------------------------------------------------------
// `full_name` peut être saisi de n'importe quelle façon (tout en minuscules,
// tout en majuscules, casse mêlée) — on le remet en forme "Prénom Nom" pour
// l'affichage (menu latéral, avatar), sans jamais toucher à la valeur stockée.
export function formaterNomAffichage(nom){
  if(!nom) return '';
  const capMot = (mot) => mot
    .split('-')
    .map(p => p ? p.charAt(0).toUpperCase() + p.slice(1).toLowerCase() : p)
    .join('-');
  return nom.trim().split(/\s+/).map(capMot).join(' ');
}

// Initiales pour l'avatar du menu latéral — « Sophie Marchand » → « SM »,
// « Cadence » → « CA ». Utilisé sur tous les écrans dotés d'un menu latéral.
export function initiales(nom){
  const mots = (nom || '').trim().split(/\s+/).filter(Boolean);
  if(!mots.length) return '?';
  if(mots.length === 1) return mots[0].slice(0,2).toUpperCase();
  return (mots[0][0] + mots[mots.length-1][0]).toUpperCase();
}
