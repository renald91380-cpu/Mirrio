// Mirrio — API du dashboard de supervision des agents.
//
//   GET  /api/agent-actions?key=<secret>            -> liste des actions en attente
//   POST /api/agent-actions?key=<secret>&id=<id>&action=approve|reject
//
// Sert de relais entre site/agent-dashboard.html (servi par Vercel, sur le
// domaine Mirrio habituel) et la table `agent_actions` de Supabase, avec la
// clé service_role — même parti pris que api/document-public.js et
// api/envoyer-document.js : le contrôle d'accès se fait dans le code, pas par
// une policy RLS, et `key` est comparée au secret `DASHBOARD_SECRET`.
//
// Pourquoi ce détour plutôt que d'appeler directement l'Edge Function
// Supabase `agent-dashboard` depuis le téléphone : certains réseaux mobiles
// (contrôle parental opérateur type Orange/SFR) filtrent le domaine
// supabase.co et renvoient le HTML en clair au lieu de le laisser s'afficher.
// Le domaine Mirrio (déjà utilisé pour login/agenda/etc. sans souci sur le
// même téléphone) n'a pas ce problème. L'Edge Function `agent-relance` reste
// le seul endroit qui écrit une action ; celle-ci ne fait que lire/valider/
// rejeter, jamais générer de brouillon.
//
// L'envoi réel de l'email quand une action est validée reste à brancher
// (voir "automatisation site.md" — prochaine étape du projet) : pour
// l'instant, "approve" ne fait que changer le statut en base, comme le
// faisait déjà l'ancien dashboard.
//
// Zéro dépendance npm, comme le reste de api/.
//
// Variables d'environnement attendues :
//   SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, DASHBOARD_SECRET

const SUPABASE_URL = process.env.SUPABASE_URL || process.env.NEXT_PUBLIC_SUPABASE_URL;
const SERVICE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const DASHBOARD_SECRET = process.env.DASHBOARD_SECRET;

function json(res, statut, corps) {
  res.statusCode = statut;
  res.setHeader('Content-Type', 'application/json; charset=utf-8');
  res.setHeader('X-Robots-Tag', 'noindex, nofollow');
  res.setHeader('Cache-Control', 'no-store');
  res.end(JSON.stringify(corps));
}

async function supabase(chemin, options = {}) {
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${chemin}`, {
    ...options,
    headers: {
      apikey: SERVICE_KEY,
      Authorization: `Bearer ${SERVICE_KEY}`,
      Accept: 'application/json',
      ...(options.body ? { 'Content-Type': 'application/json', Prefer: 'return=representation' } : {}),
      ...options.headers
    }
  });
  if (!r.ok) {
    const detail = await r.text().catch(() => '');
    throw new Error(`Supabase ${r.status} ${detail}`);
  }
  const texte = await r.text();
  return texte ? JSON.parse(texte) : null;
}

export default async function handler(req, res) {
  if (!SUPABASE_URL || !SERVICE_KEY || !DASHBOARD_SECRET) {
    return json(res, 500, { error: 'Configuration serveur incomplète.' });
  }

  const url = new URL(req.url, `https://${req.headers.host}`);
  const key = url.searchParams.get('key') || '';

  if (key !== DASHBOARD_SECRET) {
    return json(res, 401, { error: 'Non autorisé.' });
  }

  if (req.method === 'GET') {
    try {
      const actions = await supabase(
        'agent_actions?statut=eq.proposee&select=*&order=created_at.desc'
      );
      return json(res, 200, { actions });
    } catch (e) {
      return json(res, 503, { error: 'Actions temporairement indisponibles.' });
    }
  }

  if (req.method === 'POST') {
    const id = url.searchParams.get('id') || '';
    const action = url.searchParams.get('action') || '';

    if (!/^[0-9a-f-]{36}$/i.test(id)) {
      return json(res, 400, { error: 'Identifiant invalide.' });
    }
    if (action !== 'approve' && action !== 'reject') {
      return json(res, 400, { error: 'Action invalide.' });
    }

    const statut = action === 'approve' ? 'validee' : 'rejetee';

    try {
      await supabase(`agent_actions?id=eq.${id}`, {
        method: 'PATCH',
        body: JSON.stringify({ statut, traitee_at: new Date().toISOString() })
      });
      // NOTE: l'envoi réel de l'email (Gmail) reste à brancher à l'étape
      // suivante — voir "automatisation site.md".
      return json(res, 200, { ok: true });
    } catch (e) {
      return json(res, 503, { error: 'Action temporairement indisponible.' });
    }
  }

  return json(res, 405, { error: 'Method Not Allowed' });
}
