-- ============================================================
-- 007_security_hardening.sql
-- Ужесточение безопасности:
--   1) роли — списком (у пользователя может быть несколько ролей);
--   2) серверные сессии с хранением ХЕША токена;
--   3) настройки продукта, которые меняет администратор, — в БД (studios);
--   4) привязка временного удержания слота к пользователю.
--
-- Прогонщик миграций на время выполнения отключает внешние ключи: мы
-- пересобираем users (DROP/RENAME) и создаём таблицы, ссылающиеся на users.
-- ============================================================

-- ---------- 1. Роли списком ----------
CREATE TABLE user_roles (
  user_id INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  role    TEXT    NOT NULL CHECK (role IN ('admin', 'master', 'client')),
  PRIMARY KEY (user_id, role)
);

INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, role FROM users;

-- users больше не хранит единственную роль — пересобираем таблицу без столбца role
CREATE TABLE users_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO users_new (id, email, password_hash, is_active, created_at, updated_at)
  SELECT id, email, password_hash, is_active, created_at, updated_at FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;

-- ---------- 2. Сессии: храним хеш токена, а не токен ----------
CREATE TABLE sessions (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id     INTEGER NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  token_hash  TEXT    NOT NULL UNIQUE,            -- SHA-256 от токена (base64url)
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  expires_at  TEXT    NOT NULL
);

CREATE INDEX idx_sessions_user    ON sessions (user_id);
CREATE INDEX idx_sessions_expires ON sessions (expires_at);

-- ---------- 3. Настройки продукта в БД (меняет администратор) ----------
ALTER TABLE studios ADD COLUMN slot_step_minutes INTEGER NOT NULL DEFAULT 30
  CHECK (slot_step_minutes > 0);
ALTER TABLE studios ADD COLUMN hold_ttl_minutes INTEGER NOT NULL DEFAULT 10
  CHECK (hold_ttl_minutes > 0);

-- ---------- 4. Удержания принадлежат пользователю ----------
ALTER TABLE slot_holds ADD COLUMN user_id INTEGER REFERENCES users(id) ON DELETE CASCADE;
CREATE INDEX idx_slot_holds_user ON slot_holds (user_id);
