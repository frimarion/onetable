-- =============================================================================
-- OneTable Production Security & Multi-Tenant RLS Schema
-- Применяется поверх app/server/schema.sql в отдельной БД PostgreSQL `onetable`.
-- =============================================================================

-- 1. Пользователи, членство в клубах, сессии, инвайты, ТВ-токены и аудит
CREATE TABLE IF NOT EXISTS users (
  id             text PRIMARY KEY,
  email          text NOT NULL UNIQUE,
  name           text NOT NULL DEFAULT '',
  password_hash  text NOT NULL, -- формат: scrypt$<salt_hex>$<hash_hex>
  is_superadmin  boolean NOT NULL DEFAULT false,
  disabled       boolean NOT NULL DEFAULT false,
  failed_logins  integer NOT NULL DEFAULT 0,
  locked_until   bigint,
  created_at     bigint NOT NULL,
  last_login_at  bigint,
  avatar_url     text NOT NULL DEFAULT ''
);
ALTER TABLE users ADD COLUMN IF NOT EXISTS avatar_url text NOT NULL DEFAULT '';
CREATE UNIQUE INDEX IF NOT EXISTS uq_users_email_lower ON users (lower(email));

-- Привязанные внешние способы входа (Telegram, VK ID, Яндекс ID)
CREATE TABLE IF NOT EXISTS user_identities (
  provider          text NOT NULL CHECK (provider IN ('telegram', 'vk', 'yandex')),
  provider_user_id  text NOT NULL,
  user_id           text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  username          text NOT NULL DEFAULT '',
  display_name      text NOT NULL DEFAULT '',
  avatar_url        text NOT NULL DEFAULT '',
  created_at        bigint NOT NULL,
  PRIMARY KEY (provider, provider_user_id),
  UNIQUE (user_id, provider)
);
CREATE INDEX IF NOT EXISTS idx_user_identities_user ON user_identities (user_id);

CREATE TABLE IF NOT EXISTS club_members (
  club_id     text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role        text NOT NULL CHECK (role IN ('owner', 'admin', 'floor', 'dealer')),
  table_no    integer CHECK (table_no IS NULL OR table_no > 0),
  active      boolean NOT NULL DEFAULT true,
  created_at  bigint NOT NULL,
  PRIMARY KEY (club_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_club_members_user ON club_members (user_id) WHERE active;

-- В БД хранится ТОЛЬКО SHA-256 хэш сессионного токена (HttpOnly cookie).
CREATE TABLE IF NOT EXISTS auth_sessions (
  token_hash  text PRIMARY KEY,
  user_id     text NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  club_id     text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  created_at  bigint NOT NULL,
  expires_at  bigint NOT NULL,
  ip          text NOT NULL DEFAULT '',
  user_agent  text NOT NULL DEFAULT ''
);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_user ON auth_sessions (user_id);
CREATE INDEX IF NOT EXISTS idx_auth_sessions_exp  ON auth_sessions (expires_at);

-- Одноразовые криптостойкие инвайты (256 бит, живут 24 ч, хранится только SHA-256 хэш).
CREATE TABLE IF NOT EXISTS club_invites (
  token_hash   text PRIMARY KEY,
  club_id      text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  email        text NOT NULL,
  role         text NOT NULL CHECK (role IN ('owner', 'admin', 'floor', 'dealer')),
  table_no     integer CHECK (table_no IS NULL OR table_no > 0),
  invited_by   text REFERENCES users(id) ON DELETE SET NULL,
  created_at   bigint NOT NULL,
  expires_at   bigint NOT NULL,
  accepted_at  bigint
);
ALTER TABLE club_invites ADD COLUMN IF NOT EXISTS table_no integer CHECK (table_no IS NULL OR table_no > 0);
CREATE INDEX IF NOT EXISTS idx_club_invites_club ON club_invites (club_id);

-- 256-битные токены только-на-чтение для ТВ-дисплея конкретного турнира.
CREATE TABLE IF NOT EXISTS tv_tokens (
  token_hash     text PRIMARY KEY,
  club_id        text NOT NULL REFERENCES clubs(id) ON DELETE CASCADE,
  tournament_id  text NOT NULL REFERENCES tournaments(id) ON DELETE CASCADE,
  created_by     text REFERENCES users(id) ON DELETE SET NULL,
  created_at     bigint NOT NULL,
  revoked_at     bigint
);
CREATE INDEX IF NOT EXISTS idx_tv_tokens_tournament ON tv_tokens (tournament_id) WHERE revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS auth_audit_log (
  id          bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  event       text NOT NULL,
  user_id     text,
  club_id     text,
  email       text NOT NULL DEFAULT '',
  ip          text NOT NULL DEFAULT '',
  detail      text NOT NULL DEFAULT '',
  created_at  bigint NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_auth_audit_created ON auth_audit_log (created_at DESC);

-- =============================================================================
-- 2. Изоляция клубов на уровне PostgreSQL (Row Level Security)
-- Приложение подключается ролью onetable_app (БЕЗ BYPASSRLS и БЕЗ SUPERUSER)
-- и в каждой транзакции выставляет:
--   SELECT set_config('app.club_id', '<club_id>', true);
--   SELECT set_config('app.system', '1', true); -- ТОЛЬКО для таблиц авторизации/инвайтов
-- =============================================================================

CREATE OR REPLACE FUNCTION app_current_club() RETURNS text
LANGUAGE sql STABLE AS $$
  SELECT NULLIF(current_setting('app.club_id', true), '');
$$;

CREATE OR REPLACE FUNCTION app_is_system() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT current_setting('app.system', true) = '1';
$$;

-- Включаем и форсируем RLS на всех бизнес-таблицах
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'clubs', 'tournaments', 'players', 'seats', 'entries', 'payments', 'journal',
    'blind_presets', 'rating_presets', 'player_notes', 'player_messages',
    'broadcasts', 'broadcast_recipients', 'crm_tasks', 'crm_events',
    'club_members', 'club_invites', 'tv_tokens'
  ] LOOP
    EXECUTE format('ALTER TABLE %I ENABLE ROW LEVEL SECURITY', tbl);
    EXECUTE format('ALTER TABLE %I FORCE ROW LEVEL SECURITY', tbl);
  END LOOP;
END $$;

-- Политика для clubs
DROP POLICY IF EXISTS rls_clubs_tenant ON clubs;
CREATE POLICY rls_clubs_tenant ON clubs
  USING (app_is_system() OR id = app_current_club())
  WITH CHECK (app_is_system() OR id = app_current_club());

-- Политики для всех таблиц с колонкой club_id
DO $$
DECLARE
  tbl text;
BEGIN
  FOREACH tbl IN ARRAY ARRAY[
    'tournaments', 'players', 'entries', 'payments', 'blind_presets', 'rating_presets',
    'player_notes', 'player_messages', 'broadcasts', 'broadcast_recipients',
    'crm_tasks', 'crm_events', 'club_members', 'club_invites', 'tv_tokens'
  ] LOOP
    EXECUTE format('DROP POLICY IF EXISTS rls_%s_tenant ON %I', tbl, tbl);
    EXECUTE format(
      'CREATE POLICY rls_%s_tenant ON %I USING (app_is_system() OR club_id = app_current_club()) WITH CHECK (app_is_system() OR club_id = app_current_club())',
      tbl, tbl
    );
  END LOOP;
END $$;

-- Политики для таблиц, привязанных через tournament_id (seats, journal)
DROP POLICY IF EXISTS rls_seats_tenant ON seats;
CREATE POLICY rls_seats_tenant ON seats
  USING (
    app_is_system() OR EXISTS (
      SELECT 1 FROM tournaments t WHERE t.id = seats.tournament_id AND t.club_id = app_current_club()
    )
  )
  WITH CHECK (
    app_is_system() OR EXISTS (
      SELECT 1 FROM tournaments t WHERE t.id = seats.tournament_id AND t.club_id = app_current_club()
    )
  );

DROP POLICY IF EXISTS rls_journal_tenant ON journal;
CREATE POLICY rls_journal_tenant ON journal
  USING (
    app_is_system() OR EXISTS (
      SELECT 1 FROM tournaments t WHERE t.id = journal.tournament_id AND t.club_id = app_current_club()
    )
  )
  WITH CHECK (
    app_is_system() OR EXISTS (
      SELECT 1 FROM tournaments t WHERE t.id = journal.tournament_id AND t.club_id = app_current_club()
    )
  );
