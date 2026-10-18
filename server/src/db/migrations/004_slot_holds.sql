-- ============================================================
-- 004_slot_holds.sql
-- Временные удержания слота на время оформления записи.
--
-- Это НЕ таблица заранее подготовленных слотов (такой таблицы нет и не
-- должно быть — свободное время вычисляется на лету, см. docs/db-schema.md,
-- раздел 6). Удержание создаётся на несколько минут при оформлении, учитывается
-- в расчёте свободного времени и удаляется по истечении срока.
--
-- Таблица служебная (как schema_migrations): к девяти предметным таблицам
-- схемы она не относится.
-- ============================================================

CREATE TABLE slot_holds (
  id           TEXT    PRIMARY KEY,          -- случайный токен удержания
  master_id    INTEGER NOT NULL REFERENCES masters(id) ON DELETE CASCADE,
  service_ids  TEXT    NOT NULL,             -- JSON-массив id выбранных услуг
  starts_at    TEXT    NOT NULL,             -- ISO-8601 UTC
  ends_at      TEXT    NOT NULL,             -- ISO-8601 UTC
  duration_min INTEGER NOT NULL CHECK (duration_min > 0),
  price_minor  INTEGER NOT NULL CHECK (price_minor >= 0),
  currency     TEXT    NOT NULL DEFAULT 'RUB',
  expires_at   TEXT    NOT NULL,             -- ISO-8601 UTC, момент истечения
  created_at   TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%SZ', 'now')),
  CHECK (starts_at < ends_at)
);

CREATE INDEX idx_slot_holds_master_start ON slot_holds (master_id, starts_at, ends_at);
CREATE INDEX idx_slot_holds_expires      ON slot_holds (expires_at);
