-- Durcissement issu du test de sécurité du 29 octobre 2026 : deux fonctions utilitaires étaient exécutables par n'importe quel visiteur anonyme
-- (la clé publique du site suffisait). Aucune donnée n'était exposée, mais ce sont des surfaces inutiles.
--   * new_feed_token() : génère un jeton aléatoire ; utilisée par des triggers et des fonctions `security definer`, qui n'ont pas besoin du droit de l'appelant.
--   * rotate_calendar_feed_token() : régénère le jeton de flux agenda de l'utilisateur CONNECTÉ ; inutile pour un anonyme.
-- Sûr à rejouer en entier. À exécuter après schema-v49-profil-pays.sql.
revoke execute on function public.new_feed_token() from anon, public;
revoke execute on function public.rotate_calendar_feed_token() from anon, public;
grant execute on function public.new_feed_token() to authenticated, service_role;
grant execute on function public.rotate_calendar_feed_token() to authenticated;
