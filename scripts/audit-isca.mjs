// Mirrio Caisse : audit technique automatisé des quatre critères ISCA (Inaltérabilité, Sécurisation, Conservation, Archivage).
//
//   npm i --no-save @electric-sql/pglite      (une fois, dans un dossier de travail)
//   node scripts/audit-isca.mjs               (depuis la racine du dépôt ; ROOT=/chemin pour un autre emplacement)
//
// Le script monte un Postgres embarqué (PGlite), y charge les migrations RÉELLES du dépôt (db/schema-v39, v43, v44 sur un squelette minimal de
// `documents`, `rendez_vous`, etc.), joue des scénarios de vente, d'avoir, de terminal, de rendez-vous, de clôture et d'archive, puis tente de les
// falsifier. Chaque contrôle affiche PASS ou FAIL ; le code de sortie vaut 1 s'il y a un échec. Il ne remplace pas l'audit d'un organisme accrédité :
// c'est la preuve rejouable à lui remettre (voir docs/audit-isca.md).

import { PGlite } from '@electric-sql/pglite';
import { pgcrypto } from '@electric-sql/pglite/contrib/pgcrypto';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.ROOT || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const lire = f => fs.readFileSync(path.join(ROOT, 'db', f), 'utf8');
const db = new PGlite({ extensions: { pgcrypto } });
const U = '11111111-1111-1111-1111-111111111111';
const resultats = [];
const verif = (critere, nom, ok, detail = '') => { resultats.push({ critere, nom, ok: !!ok, detail }); };
const q = async (sql, p) => (await db.query(sql, p)).rows;
const un = async (sql, p) => (await q(sql, p))[0];
const refuse = async (fn) => { try { await fn(); return null; } catch (e) { return String(e.message || e); } };

// ---------------------------------------------------------------- squelette minimal de la base de l'application
await db.exec(`create schema if not exists extensions; create extension if not exists pgcrypto with schema extensions;
create schema auth; create table auth.users(id uuid primary key);
create function auth.uid() returns uuid language sql stable as $$ select nullif(current_setting('app.uid', true), '')::uuid $$;
create role authenticated; create role anon;
create function public.current_workspace_id() returns uuid language sql stable as $$ select auth.uid() $$;
create table public.clients(id uuid primary key default gen_random_uuid(), owner_id uuid, full_name text);
create table public.parametres_facturation(owner_id uuid primary key, assujetti_tva boolean default false);
create table public.parametres_paiement (owner_id uuid primary key, stripe_actif boolean default false, stripe_secret_key text);
create table public.documents (id uuid primary key default gen_random_uuid(), owner_id uuid not null, client_id uuid references public.clients on delete set null, type text not null, numero text,
  statut text not null default 'brouillon', date_emission date not null default current_date, date_echeance date, converted_from uuid references public.documents on delete set null, notes text,
  created_at timestamptz default now(), updated_at timestamptz default now());
create table public.document_lignes (id uuid primary key default gen_random_uuid(), document_id uuid not null references public.documents on delete cascade, description text not null,
  quantite numeric not null default 1, prix_unitaire numeric not null default 0, position int not null default 0, tva_taux numeric not null default 0);
create table public.document_counters (owner_id uuid not null, type text not null, year int not null, last_number int not null default 0, primary key (owner_id, type, year));
create table public.rendez_vous (id uuid primary key default gen_random_uuid(), owner_id uuid not null, client_id uuid, titre text, statut text, document_id uuid, paiement_mode text,
  paiement_montant numeric, reste_sur_place numeric, reste_encaisse_le timestamptz);
create function public.gen_num() returns trigger language plpgsql as $$ begin
  if new.numero is null then
    insert into public.document_counters (owner_id, type, year, last_number) values (new.owner_id, new.type, 2026, 1) on conflict (owner_id, type, year) do update set last_number = document_counters.last_number + 1;
    new.numero := 'FAC-2026-' || lpad((select last_number from public.document_counters where owner_id = new.owner_id and type = new.type and year = 2026)::text, 3, '0');
  end if; return new; end $$;
create trigger set_document_number before insert on public.documents for each row execute function public.gen_num();`);
await db.exec(lire('schema-v39-caisse.sql'));
await db.exec(lire('schema-v43-caisse-certifiable.sql'));
await db.exec(lire('schema-v43-caisse-certifiable.sql'));        // rejouable sans effet de bord
await db.exec(lire('schema-v44-produits.sql'));
await db.exec(`insert into auth.users values ('${U}'); insert into public.parametres_facturation values ('${U}', true); set app.uid = '${U}';`);

// ---------------------------------------------------------------- scénarios légitimes
const ses = (await un(`select public.caisse_ouvrir(100) r`)).r;
const ligne = (d, qte, pu, tva) => ({ description: d, quantite: qte, prix_unitaire: pu, tva_taux: tva });
const L1 = JSON.stringify([ligne('Coupe', 1, 25, 20), ligne('Soin', 2, 10.33, 10)]);
const v1 = (await un(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,null) r`, [ses.id, L1, JSON.stringify([{ mode: 'especes', montant: 30, recu: 50 }, { mode: 'carte', montant: 22.73 }])])).r;
const v2 = (await un(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,null) r`, [ses.id, JSON.stringify([ligne('Brushing', 1, 30, 20)]), JSON.stringify([{ mode: 'carte', montant: 36 }])])).r;
await un(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,true,null) r`, [ses.id, L1, JSON.stringify([{ mode: 'carte', montant: 52.73 }])]);
const av = (await un(`select public.caisse_avoir($1,'[{"index":2,"quantite":1}]'::jsonb,'Soin non réalisé',$2::jsonb) r`, [v1.ticket_id, JSON.stringify([{ mode: 'especes' }])])).r;
await un(`select public.caisse_duplicata($1) r`, [v1.ticket_id]);

verif('I', 'Vente enregistrée avec numéro continu et signature', v1.numero === 'T-2026-000001' && v2.numero === 'T-2026-000002' && /^[0-9a-f]{64}$/.test(v1.signature), `${v1.numero}, ${v2.numero}`);
verif('I', 'Le serveur recalcule les totaux (45,66 HT + 7,07 TVA = 52,73)', v1.total_ht == 45.66 && v1.total_tva == 7.07 && v1.total_ttc == 52.73);
verif('I', 'Correction par avoir numéroté, ticket d\'origine inchangé', av.numero === 'AV-2026-000001' && av.total_ttc == -11.36);
verif('I', 'Mode formation hors grand total', Number((await un(`select gt_perpetuel g from public.caisse_chaine`)).g) === 77.37);

// ---------------------------------------------------------------- I : inaltérabilité
for (const [nom, sql] of [
  ['modifier un ticket', `update public.caisse_tickets set total_ttc = 1`],
  ['supprimer un ticket', `delete from public.caisse_tickets`],
  ['modifier le journal', `update public.caisse_journal set numero = 'X'`],
  ['supprimer le journal', `delete from public.caisse_journal`],
  ['vider le journal (truncate)', `truncate public.caisse_journal`],
  ['modifier un paiement', `update public.caisse_paiements set montant = 1`],
  ['supprimer un paiement', `delete from public.caisse_paiements`],
  ['modifier la facture d\'une vente', `update public.documents set notes = 'x' where id = (select document_id from public.caisse_tickets limit 1)`],
  ['supprimer les lignes de la facture d\'une vente', `delete from public.document_lignes where document_id = (select document_id from public.caisse_tickets limit 1)`]
]) { const e = await refuse(() => db.exec(sql)); verif('I', `Refus : ${nom}`, e && /inaltérable/.test(e), e ? e.slice(0, 80) : 'ACCEPTÉ'); }
const libre = (await un(`insert into public.documents (owner_id,type,statut) values ($1,'devis','brouillon') returning id`, [U])).id;
verif('I', 'Un document hors caisse reste modifiable', (await refuse(() => db.exec(`update public.documents set statut='envoye' where id='${libre}'`))) === null);
verif('I', 'Refus : paiements ne couvrant pas le ticket', /ne correspond pas/.test(await refuse(() => q(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,null)`, [ses.id, L1, JSON.stringify([{ mode: 'carte', montant: 10 }])])) || ''));
verif('I', 'Refus : sur-remboursement d\'un avoir', /plus que ce qui reste/.test(await refuse(() => q(`select public.caisse_avoir($1,'[{"index":2,"quantite":2}]'::jsonb,'Trop',$2::jsonb)`, [v1.ticket_id, JSON.stringify([{ mode: 'especes' }])])) || ''));
verif('I', 'Refus : acompte forgé par un navigateur', /Moyen de paiement inconnu/.test(await refuse(() => q(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,null)`, [ses.id, JSON.stringify([ligne('X', 1, 10, 0)]), JSON.stringify([{ mode: 'acompte', montant: 10 }])])) || ''));

// Paiement terminal : réussi, une seule fois, bon montant
const tp = (await un(`insert into public.caisse_terminal_paiements (owner_id, montant, statut, secret, transaction_code) values ($1, 12.50, 'reussi', 'abcdefabcdefabcdefabcd', 'TXN123') returning id`, [U])).id;
const L2 = JSON.stringify([ligne('Huile', 1, 12.5, 0)]);
verif('I', 'Refus : paiement terminal au mauvais montant', /ne correspond pas/.test(await refuse(() => q(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,null)`, [ses.id, L2, JSON.stringify([{ mode: 'carte', montant: 10, terminal_id: tp }])])) || ''));
const vt = (await un(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,null) r`, [ses.id, L2, JSON.stringify([{ mode: 'carte', montant: 12.5, terminal_id: tp }])])).r;
verif('I', 'Paiement terminal : référence scellée dans le ticket', vt.paiements[0].reference === 'TXN123');
verif('I', 'Refus : paiement terminal réutilisé', /invalide ou déjà utilisé/.test(await refuse(() => q(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,null)`, [ses.id, L2, JSON.stringify([{ mode: 'carte', montant: 12.5, terminal_id: tp }])])) || ''));

// Rendez-vous : acompte déduit, facture réutilisée, une seule fois
const mkdoc = async (statut) => { const d = (await un(`insert into public.documents (owner_id,type,statut) values ($1,'facture',$2) returning id`, [U, statut])).id; await q(`insert into public.document_lignes (document_id,description,quantite,prix_unitaire,tva_taux,position) values ($1,'Coupe',1,45.8333,20,1)`, [d]); return d; };
const dEnv = await mkdoc('envoye'), dPaye = await mkdoc('paye');
const rA = (await un(`insert into public.rendez_vous (owner_id,titre,statut,document_id,paiement_mode,paiement_montant,reste_sur_place) values ($1,'Coupe','confirme',$2,'sur_place',5,50) returning id`, [U, dEnv])).id;
const rC = (await un(`insert into public.rendez_vous (owner_id,titre,statut,document_id,paiement_mode) values ($1,'Payé','confirme',$2,'en_ligne') returning id`, [U, dPaye])).id;
const L55 = JSON.stringify([ligne('Coupe', 1, 45.8333, 20)]);
verif('I', 'Refus : rendez-vous déjà réglé en ligne', /déjà réglé en ligne/.test(await refuse(() => q(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,$4)`, [ses.id, L55, JSON.stringify([{ mode: 'carte', montant: 55 }]), rC])) || ''));
const nbAvant = Number((await un(`select count(*) n from public.documents`)).n);
const vr = (await un(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,$4) r`, [ses.id, L55, JSON.stringify([{ mode: 'carte', montant: 50 }]), rA])).r;
verif('I', 'Rendez-vous : acompte de 5 € déduit par le serveur, facture réutilisée sans doublon', vr.paiements[0].mode === 'acompte' && Number(vr.paiements[0].montant) === 5 && vr.document_id === dEnv && Number((await un(`select count(*) n from public.documents`)).n) === nbAvant);
verif('I', 'Refus : rendez-vous encaissé deux fois', /déjà été encaissé/.test(await refuse(() => q(`select public.caisse_encaisser($1,null,$2::jsonb,$3::jsonb,false,$4)`, [ses.id, L55, JSON.stringify([{ mode: 'carte', montant: 50 }]), rA])) || ''));

// ---------------------------------------------------------------- S : sécurisation
const ok0 = (await un(`select public.caisse_verifier() r`)).r;
verif('S', 'Vérification : chaîne, signatures, grands totaux, numérotation', ok0.ok === true, `${ok0.entrees} entrées`);
verif('S', 'Les fonctions internes ne sont exécutables ni par anon ni par authenticated', !(await un(`select has_function_privilege('anon','public.caisse__ecrire(uuid,text,uuid,uuid,text,numeric,jsonb,boolean)','execute') or has_function_privilege('authenticated','public.caisse__ecrire(uuid,text,uuid,uuid,text,numeric,jsonb,boolean)','execute') a`)).a);
verif('S', 'caisse_encaisser n\'est pas exécutable par anon', !(await un(`select has_function_privilege('anon','public.caisse_encaisser(uuid,uuid,jsonb,jsonb,boolean,uuid)','execute') a`)).a);
verif('S', 'caisse_cloturer_auto n\'est exécutable ni par anon ni par authenticated', !(await un(`select has_function_privilege('anon','public.caisse_cloturer_auto()','execute') or has_function_privilege('authenticated','public.caisse_cloturer_auto()','execute') a`)).a);

// ---------------------------------------------------------------- C : conservation (clôtures)
const z = (await un(`select public.caisse_cloturer($1, 190, null) r`, [ses.id])).r;
verif('C', 'Clôture Z : numérotée, signée, totaux calculés par le serveur', z.numero_z === 'Z-000001' && /^[0-9a-f]{64}$/.test(z.signature), `${z.nb_ventes} ventes, ${z.nb_avoirs} avoir(s), CA ${z.total_ttc}`);
verif('C', 'Z : les espèces attendues tiennent compte du remboursement en espèces', Number(z.par_mode.especes) === 18.64);
verif('C', 'Refus : clôturer un mois non terminé', /pas terminée/.test(await refuse(() => q(`select public.caisse_cloturer_periode('mensuelle', 2026, 12)`)) || ''));

// Données d'un autre mois : on antidate (superuser, triggers suspendus) pour éprouver la clôture automatique, puis on rétablit la protection.
await db.exec(`alter table public.caisse_tickets disable trigger caisse_immuable; alter table public.caisse_sessions disable trigger caisse_session_figee;`);
await db.exec(`update public.caisse_tickets set date_ticket = date_ticket - interval '65 days'`);
await db.exec(`alter table public.caisse_tickets enable trigger caisse_immuable; alter table public.caisse_sessions enable trigger caisse_session_figee;`);
await db.exec(`insert into public.caisse_sessions (owner_id, ouverte_le, fond_caisse) values ('${U}', now() - interval '3 days', 50)`);
const auto = (await un(`select public.caisse_cloturer_auto() r`)).r;
verif('C', 'Clôture automatique : journée oubliée fermée', auto.sessions_fermees === 1, JSON.stringify(auto));
verif('C', 'Clôture automatique : mois révolus clôturés', auto.mois_clotures >= 1, JSON.stringify(auto));
verif('C', 'Clôture automatique : aucune erreur', auto.erreurs === 0);
const auto2 = (await un(`select public.caisse_cloturer_auto() r`)).r;
verif('C', 'Clôture automatique rejouée : rien n\'est clôturé deux fois', auto2.sessions_fermees === 0 && auto2.mois_clotures === 0 && auto2.annees_cloturees === 0, JSON.stringify(auto2));
verif('C', 'Clôture automatique tracée comme telle', (await un(`select count(*) n from public.caisse_journal where payload->>'automatique' = 'true'`)).n >= 2);
verif('C', 'Refus : une période déjà clôturée', /déjà clôturée/.test(await refuse(() => q(`select public.caisse_cloturer_periode('mensuelle', $1, $2)`, [new Date(Date.now() - 65 * 86400000).getFullYear(), new Date(Date.now() - 65 * 86400000).getMonth() + 1])) || ''));

// ---------------------------------------------------------------- A : archivage
const anneeDerniere = new Date(Date.now() - 65 * 86400000).getFullYear();
const debut = new Date(Date.now() - 300 * 86400000).toISOString().slice(0, 10), fin = new Date().toISOString().slice(0, 10);
const arch = (await un(`select public.caisse_archiver($1::date, $2::date) r`, [debut, fin])).r;
verif('A', 'Archive : journal, tickets, vérification et empreinte globale', arch.journal.length > 0 && arch.tickets.length > 0 && /^[0-9a-f]{64}$/.test(arch.empreinte) && arch.verification.ok === true);
verif('A', 'Archive : empreinte scellée dans le journal (date certaine)', (await un(`select payload->>'empreinte' e from public.caisse_journal where type = 'archive' order by seq desc limit 1`)).e === arch.empreinte);

// ---------------------------------------------------------------- audit intégré à l'application
const audit = (await un(`select public.caisse_audit_isca() r`)).r;
for (const c of audit.controles) verif(c.critere, `Audit intégré ${c.code} : ${c.libelle}`, c.ok === true || c.ok === null, c.detail);

// ---------------------------------------------------------------- falsifications (en super-utilisateur, protections suspendues) : elles doivent être DÉTECTÉES
await db.exec(`alter table public.caisse_journal disable trigger caisse_immuable; alter table public.caisse_tickets disable trigger caisse_immuable;`);
await db.exec(`update public.caisse_journal set payload = jsonb_set(payload,'{nb_lignes}','99') where seq = 2`);
let v = (await un(`select public.caisse_verifier() r`)).r;
verif('S', 'Falsification du contenu d\'une entrée : détectée', v.ok === false && /modifié/.test(v.defaut.raison) && v.defaut.seq === 2, v.defaut && v.defaut.raison);
await db.exec(`update public.caisse_journal set payload = jsonb_set(payload,'{nb_lignes}','2') where seq = 2`);
verif('S', 'Contenu restauré : la chaîne redevient valide', (await un(`select public.caisse_verifier() r`)).r.ok === true);
await db.exec(`update public.caisse_tickets set total_ttc = total_ttc + 1 where numero = 'T-2026-000002'`);
const a2 = (await un(`select public.caisse_audit_isca() r`)).r;
verif('I', 'Falsification d\'un ticket : détectée par l\'audit intégré (I4)', a2.controles.find(c => c.code === 'I4').ok === false);
await db.exec(`update public.caisse_tickets set total_ttc = total_ttc - 1 where numero = 'T-2026-000002'`);
await db.exec(`delete from public.caisse_journal where seq = (select max(seq) - 3 from public.caisse_journal)`);
v = (await un(`select public.caisse_verifier() r`)).r;
verif('S', 'Suppression d\'une entrée du journal : détectée', v.ok === false && /manquante|rompue/.test(v.defaut.raison), v.defaut && v.defaut.raison);

// ---------------------------------------------------------------- rapport
const critereNom = { I: 'Inaltérabilité', S: 'Sécurisation', C: 'Conservation', A: 'Archivage' };
let ko = 0;
for (const cr of ['I', 'S', 'C', 'A']) {
  const l = resultats.filter(r => r.critere === cr);
  console.log(`\n== ${critereNom[cr]} (${l.filter(r => r.ok).length}/${l.length}) ==`);
  for (const r of l) { if (!r.ok) ko++; console.log(`${r.ok ? 'PASS' : 'FAIL'}  ${r.nom}${r.detail ? '  [' + r.detail + ']' : ''}`); }
}
console.log(`\n${resultats.length - ko} contrôles réussis, ${ko} échec(s).`);
process.exit(ko ? 1 : 0);
