-- scripts/harden-supabase.sql
-- Fecha a "Data API" do Supabase (PostgREST) para as tabelas do sistema.
--
-- Por quê: no Supabase, tabelas em `public` sem RLS e com permissão para os papéis `anon`/`authenticated`
-- podem ser lidas/gravadas por quem tiver a chave pública (anon key) do projeto — inclusive a tabela
-- `users` (hashes de senha). O sistema NÃO usa essa API: acessa o banco direto, com o papel `postgres`
-- (que ignora RLS). Então ligar RLS (sem políticas) e retirar as permissões não muda nada para o sistema
-- e bloqueia o acesso externo.
--
-- Seguro para rodar mais de uma vez. Rodar em: homologação -> (aprovado) produção -> banco novo.

DO $$
DECLARE t record;
BEGIN
  FOR t IN SELECT tablename FROM pg_tables WHERE schemaname = 'public' LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY', t.tablename);
  END LOOP;
END $$;

REVOKE ALL ON ALL TABLES    IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public FROM anon, authenticated;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public FROM anon, authenticated;

-- tabelas futuras (criadas pelas migrações) também nascem fechadas
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON TABLES    FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON SEQUENCES FROM anon, authenticated;
ALTER DEFAULT PRIVILEGES FOR ROLE postgres IN SCHEMA public REVOKE ALL ON FUNCTIONS FROM anon, authenticated;
