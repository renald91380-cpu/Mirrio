// Textes légaux modifiables depuis le back-office (table textes_legaux, schema-v35).
// Partagé par cgu.html, confidentialite.html et admin.html : un seul assainisseur,
// pour que l'aperçu de l'éditeur soit exactement ce que le public reçoit.

const BALISES = new Set(['H2', 'H3', 'P', 'UL', 'OL', 'LI', 'STRONG', 'EM', 'B', 'I', 'A', 'BR',
  'TABLE', 'THEAD', 'TBODY', 'TR', 'TH', 'TD', 'DIV', 'SPAN']);
const CLASSES = new Set(['note', 'fill']);

function lienSur(href) {
  return /^(https?:|mailto:|#|[a-z0-9_./-]+\.html(#.*)?$)/i.test(href.trim());
}

// Allowlist stricte : un admin compromis ne doit pas pouvoir injecter de script dans une page publique.
export function assainir(html) {
  const doc = new DOMParser().parseFromString('<body>' + html + '</body>', 'text/html');
  const parcourir = (noeud) => {
    for (const enfant of [...noeud.children]) {
      if (['SCRIPT', 'STYLE', 'IFRAME', 'OBJECT', 'EMBED', 'FORM', 'LINK', 'META'].includes(enfant.tagName)) {
        enfant.remove(); continue;
      }
      parcourir(enfant);
      if (!BALISES.has(enfant.tagName)) { enfant.replaceWith(...enfant.childNodes); continue; }
      for (const attr of [...enfant.attributes]) {
        const nom = attr.name;
        if (nom === 'href' && enfant.tagName === 'A' && lienSur(attr.value)) continue;
        if (nom === 'class' && attr.value.split(/\s+/).every(c => CLASSES.has(c))) continue;
        enfant.removeAttribute(nom);
      }
      if (enfant.tagName === 'A' && enfant.getAttribute('href')?.startsWith('http')) enfant.setAttribute('rel', 'noopener');
    }
  };
  parcourir(doc.body);
  return doc.body.innerHTML;
}

export function dateFr(iso) {
  return new Date(iso).toLocaleDateString('fr-FR', { day: 'numeric', month: 'long', year: 'numeric' });
}

// Remplace <article> et la date de mise à jour par la version publiée en base, si elle existe.
// Sans ligne (ou en cas d'erreur réseau), la page garde son texte statique : jamais de page vide.
export async function afficherTexteLegal(supabase, slug) {
  try {
    const { data } = await supabase.from('textes_legaux').select('contenu_html, maj_le').eq('slug', slug).maybeSingle();
    if (!data || !data.contenu_html) return;
    document.querySelector('article').innerHTML = assainir(data.contenu_html);
    const maj = document.querySelector('.maj');
    if (maj) maj.textContent = 'Dernière mise à jour : ' + dateFr(data.maj_le);
  } catch (e) { /* texte statique conservé */ }
}
