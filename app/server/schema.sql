CREATE TABLE IF NOT EXISTS clubs (
  id text PRIMARY KEY, name text NOT NULL, venue text NOT NULL, accent text NOT NULL
);
CREATE TABLE IF NOT EXISTS tournaments (
  id text PRIMARY KEY, club_id text NOT NULL REFERENCES clubs(id), name text NOT NULL,
  level integer NOT NULL DEFAULT 0 CHECK (level >= 0),
  remaining integer NOT NULL DEFAULT 1200 CHECK (remaining >= 0), started_at bigint,
  state text NOT NULL DEFAULT 'draft',
  revision integer NOT NULL DEFAULT 0,
  UNIQUE (club_id, id)
);
ALTER TABLE tournaments DROP CONSTRAINT IF EXISTS tournaments_state_check;
ALTER TABLE tournaments ADD CONSTRAINT tournaments_state_check CHECK (state IN ('draft','scheduled','live','finished'));
ALTER TABLE tournaments ALTER COLUMN state SET DEFAULT 'draft';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS starts_at timestamptz;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS description text NOT NULL DEFAULT '';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS layout text;
CREATE TABLE IF NOT EXISTS players (
  club_id text NOT NULL REFERENCES clubs(id), id text NOT NULL, name text NOT NULL,
  source text NOT NULL DEFAULT '', note text NOT NULL DEFAULT '', tags text NOT NULL DEFAULT '',
  PRIMARY KEY (club_id, id)
);
ALTER TABLE players ADD COLUMN IF NOT EXISTS tags text NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN IF NOT EXISTS nickname text NOT NULL DEFAULT '';
CREATE TABLE IF NOT EXISTS seats (
  tournament_id text NOT NULL REFERENCES tournaments(id), table_no integer NOT NULL CHECK (table_no > 0),
  seat_no integer NOT NULL CHECK (seat_no > 0), PRIMARY KEY (tournament_id, table_no, seat_no)
);
CREATE TABLE IF NOT EXISTS entries (
  club_id text NOT NULL, tournament_id text NOT NULL, player_id text NOT NULL,
  status text NOT NULL DEFAULT 'registered' CHECK (status IN ('registered','active','out')),
  table_no integer, seat_no integer, reentries integer NOT NULL DEFAULT 0 CHECK (reentries >= 0),
  last_table integer, visited_at bigint, confirmed boolean NOT NULL DEFAULT false,
  PRIMARY KEY (tournament_id, player_id),
  FOREIGN KEY (club_id, tournament_id) REFERENCES tournaments(club_id, id),
  FOREIGN KEY (club_id, player_id) REFERENCES players(club_id, id),
  FOREIGN KEY (tournament_id, table_no, seat_no) REFERENCES seats(tournament_id, table_no, seat_no),
  UNIQUE (tournament_id, table_no, seat_no),
  CHECK ((table_no IS NULL) = (seat_no IS NULL)),
  CHECK (table_no IS NULL OR status = 'active')
);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS confirmed boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS payments (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, club_id text NOT NULL,
  tournament_id text NOT NULL, player_id text NOT NULL, amount integer NOT NULL CHECK (amount > 0),
  kind text NOT NULL CHECK (kind IN ('payment','reentry')), time bigint NOT NULL,
  FOREIGN KEY (club_id, tournament_id) REFERENCES tournaments(club_id, id),
  FOREIGN KEY (club_id, player_id) REFERENCES players(club_id, id)
);
CREATE TABLE IF NOT EXISTS journal (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY, tournament_id text NOT NULL REFERENCES tournaments(id),
  label text NOT NULL, actor text NOT NULL, time bigint NOT NULL
);
CREATE TABLE IF NOT EXISTS processed_commands (
  token text NOT NULL, id text NOT NULL, fingerprint text NOT NULL, result text NOT NULL, PRIMARY KEY (token, id)
);
ALTER TABLE processed_commands ADD COLUMN IF NOT EXISTS tournament_id text REFERENCES tournaments(id);
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS config jsonb NOT NULL DEFAULT '{}';
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS structure jsonb;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS manual_break jsonb;
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS display jsonb NOT NULL DEFAULT '{}';
ALTER TABLE entries ADD COLUMN IF NOT EXISTS addon boolean NOT NULL DEFAULT false;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS addon_tier integer NOT NULL DEFAULT 0 CHECK (addon_tier BETWEEN 0 AND 3);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS addon_chips integer CHECK (addon_chips >= 0);
UPDATE entries SET addon_tier=1 WHERE addon AND addon_tier=0;
UPDATE entries e SET addon_chips=COALESCE((t.config->>'addonChips')::int,30000)
  FROM tournaments t WHERE e.tournament_id=t.id AND e.addon AND e.addon_chips IS NULL;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS queued_at bigint;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS queue_arrived boolean NOT NULL DEFAULT false;
CREATE INDEX IF NOT EXISTS entries_waitlist ON entries (tournament_id, queued_at, player_id) WHERE queued_at IS NOT NULL;
ALTER TABLE players ADD COLUMN IF NOT EXISTS online_key text;
CREATE UNIQUE INDEX IF NOT EXISTS players_online_key ON players (club_id, online_key) WHERE online_key IS NOT NULL;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS knockouts integer NOT NULL DEFAULT 0 CHECK (knockouts >= 0);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS rate integer NOT NULL DEFAULT 100 CHECK (rate IN (0,50,100));
ALTER TABLE entries ADD COLUMN IF NOT EXISTS busted_at bigint;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS method text CHECK (method IN ('cash','card','transfer'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS voided boolean NOT NULL DEFAULT false;
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_kind_check;
ALTER TABLE payments ADD CONSTRAINT payments_kind_check CHECK (kind IN ('payment','reentry','buyin','addon'));
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_amount_check;
ALTER TABLE payments ADD CONSTRAINT payments_amount_check CHECK (amount >= 0 AND (kind <> 'payment' OR amount > 0));
ALTER TABLE tournaments ADD COLUMN IF NOT EXISTS manual_stats jsonb NOT NULL DEFAULT '{"entered":0,"reentries":0,"out":0}';
CREATE TABLE IF NOT EXISTS blind_presets (
  club_id text NOT NULL REFERENCES clubs(id), name text NOT NULL, structure jsonb NOT NULL,
  PRIMARY KEY (club_id, name)
);
ALTER TABLE blind_presets ADD COLUMN IF NOT EXISTS config jsonb;
CREATE TABLE IF NOT EXISTS demo_imports (
  name text PRIMARY KEY
);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS original_buyin integer CHECK (original_buyin >= 0);
ALTER TABLE payments ADD COLUMN IF NOT EXISTS waived boolean NOT NULL DEFAULT false;
ALTER TABLE payments ADD COLUMN IF NOT EXISTS collected_at_tournament text REFERENCES tournaments(id);
ALTER TABLE payments DROP CONSTRAINT IF EXISTS payments_method_check;
ALTER TABLE payments ADD CONSTRAINT payments_method_check CHECK (method IN ('cash','card','transfer','prior'));
ALTER TABLE payments ADD COLUMN IF NOT EXISTS original_amount integer CHECK (original_amount >= 0);
ALTER TABLE entries ADD COLUMN IF NOT EXISTS addon_granted_free boolean NOT NULL DEFAULT false;
CREATE TABLE IF NOT EXISTS rating_presets (
  club_id text NOT NULL REFERENCES clubs(id), name text NOT NULL, scheme jsonb NOT NULL,
  PRIMARY KEY (club_id, name)
);
ALTER TABLE players ADD COLUMN IF NOT EXISTS phone text NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN IF NOT EXISTS telegram text NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN IF NOT EXISTS instagram text NOT NULL DEFAULT '';
ALTER TABLE players ADD COLUMN IF NOT EXISTS registered_at bigint NOT NULL DEFAULT 0;
ALTER TABLE players ADD COLUMN IF NOT EXISTS telegram_consent boolean NOT NULL DEFAULT false;
ALTER TABLE players ADD COLUMN IF NOT EXISTS stage text NOT NULL DEFAULT 'lead';
ALTER TABLE players ADD COLUMN IF NOT EXISTS owner text NOT NULL DEFAULT 'Администратор';
ALTER TABLE entries ADD COLUMN IF NOT EXISTS registered_at bigint;
ALTER TABLE entries ADD COLUMN IF NOT EXISTS broadcast_id text;
CREATE TABLE IF NOT EXISTS player_notes (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id text NOT NULL,
  player_id text NOT NULL,
  author text NOT NULL DEFAULT 'Администратор',
  body text NOT NULL,
  created_at bigint NOT NULL,
  FOREIGN KEY (club_id, player_id) REFERENCES players(club_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS player_messages (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id text NOT NULL,
  player_id text NOT NULL,
  direction text NOT NULL CHECK (direction IN ('in', 'out')),
  channel text NOT NULL CHECK (channel IN ('telegram', 'instagram', 'phone', 'club')),
  author text NOT NULL DEFAULT '',
  body text NOT NULL,
  created_at bigint NOT NULL,
  FOREIGN KEY (club_id, player_id) REFERENCES players(club_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS broadcasts (
  id text PRIMARY KEY,
  club_id text NOT NULL REFERENCES clubs(id),
  title text NOT NULL DEFAULT '',
  segment text NOT NULL,
  segment_label text NOT NULL DEFAULT '',
  tournament_id text REFERENCES tournaments(id),
  message text NOT NULL,
  link_url text NOT NULL DEFAULT '',
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('draft', 'sending', 'sent', 'failed')),
  mode text NOT NULL DEFAULT 'demo' CHECK (mode IN ('demo', 'live')),
  sent_count integer NOT NULL DEFAULT 0,
  failed_count integer NOT NULL DEFAULT 0,
  clicks_count integer NOT NULL DEFAULT 0,
  rate_limit_per_sec integer NOT NULL DEFAULT 25,
  created_at bigint NOT NULL,
  sent_at bigint
);
CREATE TABLE IF NOT EXISTS broadcast_recipients (
  broadcast_id text NOT NULL REFERENCES broadcasts(id) ON DELETE CASCADE,
  club_id text NOT NULL,
  player_id text NOT NULL,
  status text NOT NULL DEFAULT 'sent' CHECK (status IN ('sent', 'failed', 'skipped')),
  clicked_at bigint,
  registered_tournament_id text REFERENCES tournaments(id),
  visited_tournament_id text REFERENCES tournaments(id),
  sent_at bigint NOT NULL,
  PRIMARY KEY (broadcast_id, player_id),
  FOREIGN KEY (club_id, player_id) REFERENCES players(club_id, id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS crm_tasks (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id text NOT NULL,
  player_id text NOT NULL,
  kind text NOT NULL DEFAULT 'call' CHECK (kind IN ('call', 'follow_up', 'meeting')),
  title text NOT NULL,
  assignee text NOT NULL DEFAULT 'Администратор',
  due_at bigint NOT NULL,
  completed_at bigint,
  result text NOT NULL DEFAULT '',
  created_at bigint NOT NULL,
  FOREIGN KEY (club_id, player_id) REFERENCES players(club_id, id) ON DELETE CASCADE
);
CREATE TABLE IF NOT EXISTS crm_events (
  id bigint GENERATED ALWAYS AS IDENTITY PRIMARY KEY,
  club_id text NOT NULL,
  player_id text NOT NULL,
  kind text NOT NULL,
  actor text NOT NULL DEFAULT 'Система',
  summary text NOT NULL,
  created_at bigint NOT NULL,
  FOREIGN KEY (club_id, player_id) REFERENCES players(club_id, id) ON DELETE CASCADE
);
