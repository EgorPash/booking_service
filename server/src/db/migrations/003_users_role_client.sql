-- ============================================================
-- 003_users_role_client.sql
-- Разрешаем роль 'client' в таблице users.
--
-- SQLite не умеет менять CHECK-ограничение через ALTER, поэтому
-- пересобираем таблицу по официальной процедуре (12-step ALTER):
-- создать новую -> скопировать данные -> удалить старую -> переименовать.
-- Прогонщик миграций на время выполнения отключает внешние ключи
-- (иначе DROP TABLE users затронул бы masters.user_id по ON DELETE SET NULL).
-- ============================================================

CREATE TABLE users_new (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  email          TEXT    NOT NULL UNIQUE,
  password_hash  TEXT    NOT NULL,
  role           TEXT    NOT NULL CHECK (role IN ('admin', 'master', 'client')),
  is_active      INTEGER NOT NULL DEFAULT 1 CHECK (is_active IN (0, 1)),
  created_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  updated_at     TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now'))
);

INSERT INTO users_new (id, email, password_hash, role, is_active, created_at, updated_at)
  SELECT id, email, password_hash, role, is_active, created_at, updated_at
  FROM users;

DROP TABLE users;

ALTER TABLE users_new RENAME TO users;
