-- =============================================================================
-- Выполнить от имени суперпользователя postgres на VPS ОДИН РАЗ.
-- Замените пароли на сгенерированные (например: openssl rand -base64 32).
-- =============================================================================

-- 1. Владелец схемы (используется ТОЛЬКО при миграциях и bootstrap.ts)
CREATE ROLE onetable_owner LOGIN PASSWORD 'REPLACE_WITH_OWNER_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE;

-- 2. Рабочая роль приложения (БЕЗ BYPASSRLS, БЕЗ DROP/TRUNCATE!)
CREATE ROLE onetable_app LOGIN PASSWORD 'REPLACE_WITH_APP_PASSWORD' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;

-- 3. Отдельная изолированная база данных
CREATE DATABASE onetable OWNER onetable_owner;

\connect onetable

REVOKE ALL ON SCHEMA public FROM PUBLIC;
GRANT USAGE ON SCHEMA public TO onetable_app;
GRANT ALL ON SCHEMA public TO onetable_owner;

-- После применения schema.sql + schema_prod.sql от имени onetable_owner выполнить:
-- GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA public TO onetable_app;
-- GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA public TO onetable_app;
-- ALTER DEFAULT PRIVILEGES FOR ROLE onetable_owner IN SCHEMA public
--   GRANT SELECT, INSERT, UPDATE, DELETE ON TABLES TO onetable_app;
-- ALTER DEFAULT PRIVILEGES FOR ROLE onetable_owner IN SCHEMA public
--   GRANT USAGE, SELECT ON SEQUENCES TO onetable_app;
