CREATE TABLE IF NOT EXISTS users (
  tg_id BIGINT PRIMARY KEY,
  username TEXT,
  first_name TEXT,
  age INT,
  gender TEXT,
  prefer_gender TEXT DEFAULT 'any',
  occupation TEXT,
  budget INT,
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
  status TEXT DEFAULT 'active',
  onboarded BOOLEAN DEFAULT FALSE,
  created_at TIMESTAMPTZ DEFAULT NOW(),
  updated_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS likes (
  from_tg BIGINT, to_tg BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_tg, to_tg)
);

CREATE TABLE IF NOT EXISTS dislikes (
  from_tg BIGINT, to_tg BIGINT, created_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (from_tg, to_tg)
);

CREATE TABLE IF NOT EXISTS groups (
  id SERIAL PRIMARY KEY,
  status TEXT DEFAULT 'forming',
  apartment_id INT,
  created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS group_members (
  group_id INT, tg_id BIGINT, ready BOOLEAN DEFAULT FALSE, joined_at TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (group_id, tg_id)
);

CREATE TABLE IF NOT EXISTS apartments (
  id SERIAL PRIMARY KEY,
  title TEXT, rooms INT, price INT, district TEXT, address TEXT,
  isolated_rooms BOOLEAN DEFAULT TRUE, contact TEXT, photo_id TEXT,
  status TEXT DEFAULT 'available',
  created_by BIGINT, created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS apt_interest (
  apt_id INT, group_id INT, tg_id BIGINT, ts TIMESTAMPTZ DEFAULT NOW(),
  PRIMARY KEY (apt_id, tg_id)
);
