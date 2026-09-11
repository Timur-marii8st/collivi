-- Применяется при каждом старте (db.ts → initDb). Всё идемпотентно.
-- Свежая установка получает полную схему из CREATE TABLE ниже; для баз со
-- старой схемой отдельно добавляются недостающие колонки.

CREATE TABLE IF NOT EXISTS users (
  tg_id BIGINT PRIMARY KEY,
  public_id UUID NOT NULL DEFAULT gen_random_uuid(),
  username TEXT,
  first_name TEXT,
  birthdate DATE,
  age INT,
  gender TEXT,
  prefer_gender TEXT DEFAULT 'any',
  occupation TEXT,
  budget INT,
  budget_min INT,
  budget_max INT,
  districts TEXT[] DEFAULT '{}',
  move_in TEXT,
  lease_months INT DEFAULT 12,
  smoking TEXT,
  alcohol TEXT,
  sleep_time INT,
  cleanliness INT,
  guests TEXT,
  parties TEXT,
  pets_ok BOOLEAN DEFAULT TRUE,
  pets_has BOOLEAN DEFAULT FALSE,
  sociability TEXT,
  interests TEXT[] DEFAULT '{}',
  priorities TEXT[] DEFAULT '{}',
  status TEXT DEFAULT 'active',
  onboarded BOOLEAN DEFAULT FALSE,
  banned BOOLEAN DEFAULT FALSE,
  ban_reason TEXT,
  banned_at TIMESTAMPTZ,
  admin_note TEXT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT users_public_id_key UNIQUE (public_id),
  CONSTRAINT users_age_chk CHECK (age IS NULL OR age >= 18),
  CONSTRAINT users_birthdate_chk CHECK (birthdate IS NULL OR (birthdate >= DATE '1900-01-01' AND birthdate < DATE '2100-01-01')),
  CONSTRAINT users_budget_chk CHECK (budget IS NULL OR budget BETWEEN 0 AND 10000000),
  CONSTRAINT users_budget_min_chk CHECK (budget_min IS NULL OR budget_min BETWEEN 0 AND 10000000),
  CONSTRAINT users_budget_max_chk CHECK (budget_max IS NULL OR budget_max BETWEEN 0 AND 10000000),
  CONSTRAINT users_priorities_len_chk CHECK (COALESCE(array_length(priorities, 1), 0) <= 3),
  CONSTRAINT users_cleanliness_chk CHECK (cleanliness IS NULL OR cleanliness BETWEEN 1 AND 10),
  CONSTRAINT users_sleep_chk CHECK (sleep_time IS NULL OR sleep_time BETWEEN 0 AND 27),
  CONSTRAINT users_lease_chk CHECK (lease_months IS NULL OR lease_months BETWEEN 1 AND 36),
  CONSTRAINT users_gender_chk CHECK (gender IS NULL OR gender IN ('m','f')),
  CONSTRAINT users_prefer_chk CHECK (prefer_gender IS NULL OR prefer_gender IN ('any','mixed','m','f')),
  CONSTRAINT users_status_chk CHECK (status IN ('active','in_group','inactive')),
  CONSTRAINT users_districts_len_chk CHECK (COALESCE(array_length(districts, 1), 0) <= 12),
  CONSTRAINT users_interests_len_chk CHECK (COALESCE(array_length(interests, 1), 0) <= 5)
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'forming',
  apartment_id INT,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  CONSTRAINT groups_status_chk CHECK (status IN ('forming','confirmed','searching','archived'))
);

CREATE TABLE IF NOT EXISTS apartments (
  id SERIAL PRIMARY KEY,
  title TEXT, rooms INT, price INT, district TEXT, address TEXT,
  isolated_rooms BOOLEAN DEFAULT TRUE, contact TEXT, photo_id TEXT,
  photo_path TEXT,
  status TEXT DEFAULT 'available',
  created_by BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS likes (
  from_tg BIGINT REFERENCES users(tg_id) ON DELETE CASCADE,
  to_tg BIGINT REFERENCES users(tg_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_tg, to_tg)
);

CREATE TABLE IF NOT EXISTS dislikes (
  from_tg BIGINT REFERENCES users(tg_id) ON DELETE CASCADE,
  to_tg BIGINT REFERENCES users(tg_id) ON DELETE CASCADE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_tg, to_tg)
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INT REFERENCES groups(id) ON DELETE CASCADE,
  tg_id BIGINT REFERENCES users(tg_id) ON DELETE CASCADE,
  ready BOOLEAN DEFAULT FALSE,
  joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, tg_id)
);

CREATE TABLE IF NOT EXISTS apt_interest (
  apt_id INT REFERENCES apartments(id) ON DELETE CASCADE,
  group_id INT REFERENCES groups(id) ON DELETE CASCADE,
  tg_id BIGINT REFERENCES users(tg_id) ON DELETE CASCADE,
  ts TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (apt_id, tg_id)
);


-- журнал действий администратора
CREATE TABLE IF NOT EXISTS admin_log (
  id SERIAL PRIMARY KEY,
  admin_tg BIGINT,
  action TEXT,
  target TEXT,
  details JSONB,
  created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS admin_log_created_idx ON admin_log (created_at DESC);

-- новые колонки для баз, созданных по старой схеме (свежая установка получает
-- их из CREATE TABLE выше). CHECK и FK на уже заполненную базу — вручную либо
-- через `docker compose down -v`.
ALTER TABLE users ADD COLUMN IF NOT EXISTS birthdate DATE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS budget_min INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS budget_max INT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS priorities TEXT[] DEFAULT '{}';
ALTER TABLE users ADD COLUMN IF NOT EXISTS public_id UUID;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned BOOLEAN DEFAULT FALSE;
ALTER TABLE users ADD COLUMN IF NOT EXISTS ban_reason TEXT;
ALTER TABLE users ADD COLUMN IF NOT EXISTS banned_at TIMESTAMPTZ;
ALTER TABLE users ADD COLUMN IF NOT EXISTS admin_note TEXT;
ALTER TABLE apartments ADD COLUMN IF NOT EXISTS photo_path TEXT;
UPDATE users SET public_id = gen_random_uuid() WHERE public_id IS NULL;
ALTER TABLE users ALTER COLUMN public_id SET DEFAULT gen_random_uuid();
ALTER TABLE users ALTER COLUMN public_id SET NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS users_public_id_key ON users(public_id);

-- индексы

CREATE INDEX IF NOT EXISTS likes_to_tg_idx ON likes(to_tg);
CREATE INDEX IF NOT EXISTS likes_from_tg_idx ON likes(from_tg);
CREATE INDEX IF NOT EXISTS dislikes_from_tg_idx ON dislikes(from_tg);
CREATE INDEX IF NOT EXISTS group_members_tg_idx ON group_members(tg_id);
CREATE INDEX IF NOT EXISTS users_active_idx ON users(status) WHERE onboarded;
