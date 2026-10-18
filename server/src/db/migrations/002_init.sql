-- ============================================================
-- 002_init.sql — начальная схема БД (см. docs/db-schema.md)
-- СУБД: SQLite
-- Формат времени: ISO-8601 UTC  'YYYY-MM-DDTHH:MM:SSZ'
-- Деньги: целые копейки (INTEGER)
-- ============================================================

-- ---------- 1. studios: настройки студии (одна запись) ----------
CREATE TABLE studios (
  id            INTEGER PRIMARY KEY AUTOINCREMENT,
  name          TEXT    NOT NULL,
  address       TEXT,
  phone         TEXT,
  timezone      TEXT    NOT NULL DEFAULT 'Europe/Moscow',
  currency      TEXT    NOT NULL DEFAULT 'RUB',
  opening_time  TEXT,
  closing_time  TEXT,
  created_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at    TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------- 2. users: аккаунты сотрудников (только хеш пароля) ----------
CREATE TABLE users (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,          -- сам пароль не хранится
  role           TEXT    NOT NULL CHECK (role IN ('admin', 'master')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------- 3. masters: профили мастеров ----------
CREATE TABLE masters (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER UNIQUE REFERENCES users(id) ON DELETE SET NULL,
  full_name   TEXT    NOT NULL,
  title       TEXT,
  bio         TEXT,
  avatar_url  TEXT,
  is_active   INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------- 4. clients: клиенты (пароля нет — регистрации нет) ----------
CREATE TABLE clients (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  full_name   TEXT NOT NULL,
  phone       TEXT NOT NULL UNIQUE,        -- нормализованный вид: +79991234567
  email       TEXT,
  created_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------- 5. services: услуги ----------
CREATE TABLE services (
  id           INTEGER PRIMARY KEY AUTOINCREMENT,
  name         TEXT    NOT NULL UNIQUE,
  description  TEXT,
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price_minor  INTEGER NOT NULL CHECK (price_minor >= 0),
  currency     TEXT    NOT NULL DEFAULT 'RUB',
  is_active    INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

-- ---------- 6. master_services: какие мастера делают какие услуги ----------
CREATE TABLE master_services (
  master_id   INTEGER NOT NULL REFERENCES masters(id)  ON DELETE CASCADE,
  service_id  INTEGER NOT NULL REFERENCES services(id) ON DELETE CASCADE,
  PRIMARY KEY (master_id, service_id)
);

-- ---------- 7. master_schedules: повторяющийся недельный график ----------
CREATE TABLE master_schedules (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  weekday     INTEGER NOT NULL CHECK (weekday BETWEEN 1 AND 7), -- 1=Пн … 7=Вс
  start_time  TEXT    NOT NULL,             -- 'HH:MM' (местное время студии)
  end_time    TEXT    NOT NULL,
  valid_from  TEXT,                         -- 'YYYY-MM-DD', необязательно
  valid_to    TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (start_time < end_time)
);

-- ---------- 8. time_blocks: разовые блокировки (выходной, обед, личное) ----------
CREATE TABLE time_blocks (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  master_id   INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  starts_at   TEXT    NOT NULL,             -- ISO-8601 UTC
  ends_at     TEXT    NOT NULL,             -- ISO-8601 UTC
  reason      TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (starts_at < ends_at)
);

-- ---------- 9. bookings: записи клиентов ----------
CREATE TABLE bookings (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  client_id   INTEGER NOT NULL REFERENCES clients(id),
  master_id   INTEGER NOT NULL REFERENCES masters(id),
  service_id  INTEGER NOT NULL REFERENCES services(id),
  starts_at   TEXT    NOT NULL,             -- ISO-8601 UTC
  ends_at     TEXT    NOT NULL,             -- ISO-8601 UTC
  status      TEXT    NOT NULL DEFAULT 'pending'
              CHECK (status IN ('pending', 'confirmed', 'cancelled', 'completed', 'no_show')),
  price_minor INTEGER NOT NULL CHECK (price_minor >= 0),
  currency    TEXT    NOT NULL DEFAULT 'RUB',
  comment     TEXT,
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (starts_at < ends_at)
);

-- ============================================================
-- Индексы (обоснование — в docs/db-schema.md, раздел 8)
-- ============================================================
CREATE INDEX idx_bookings_master_start ON bookings (master_id, starts_at);
CREATE INDEX idx_bookings_client       ON bookings (client_id);
CREATE INDEX idx_bookings_start        ON bookings (starts_at);
CREATE INDEX idx_bookings_status       ON bookings (status);
CREATE INDEX idx_master_schedules_master ON master_schedules (master_id, weekday);
CREATE INDEX idx_time_blocks_master    ON time_blocks (master_id, starts_at, ends_at);
CREATE INDEX idx_master_services_service ON master_services (service_id);

-- Частичный уникальный индекс: у мастера не может быть двух активных
-- записей с одинаковым началом (детали пересечений — на уровне приложения).
CREATE UNIQUE INDEX uq_bookings_master_start_active
  ON bookings (master_id, starts_at)
  WHERE status IN ('pending', 'confirmed');
