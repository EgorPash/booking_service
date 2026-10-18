-- ============================================================
-- 006_bookings_allow_overlap.sql
-- Признак осознанного наложения записи (создаёт только администратор).
--
-- allow_overlap = 1 помечает запись, которую администратор сознательно
-- поставил поверх занятого времени (например, «впихнуть» клиента). Такая
-- запись:
--   * не проверяется триггером на пересечение при ВСТАВКЕ (её и создают
--     поверх занятого времени), но
--   * сама остаётся активной и учитывается при пересечении ДРУГИХ записей —
--     то есть ведёт себя как обычная занятость.
--
-- Выставлять флаг может только API при роли admin (см. routes/bookings.js);
-- в БД это просто столбец со значением по умолчанию 0.
-- ============================================================

ALTER TABLE bookings ADD COLUMN allow_overlap INTEGER NOT NULL DEFAULT 0
  CHECK (allow_overlap IN (0, 1));

-- Пересоздаём триггеры: теперь они пропускают записи с allow_overlap = 1.
DROP TRIGGER trg_bookings_no_overlap_insert;
DROP TRIGGER trg_bookings_no_overlap_update;

CREATE TRIGGER trg_bookings_no_overlap_insert
BEFORE INSERT ON bookings
FOR EACH ROW
WHEN NEW.status IN ('pending', 'confirmed') AND NEW.allow_overlap = 0
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_OVERLAP')
  WHERE EXISTS (
    SELECT 1
    FROM bookings b
    WHERE b.master_id = NEW.master_id
      AND b.status IN ('pending', 'confirmed')
      AND b.starts_at < NEW.ends_at
      AND b.ends_at > NEW.starts_at
  );
END;

CREATE TRIGGER trg_bookings_no_overlap_update
BEFORE UPDATE ON bookings
FOR EACH ROW
WHEN NEW.status IN ('pending', 'confirmed') AND NEW.allow_overlap = 0
BEGIN
  SELECT RAISE(ABORT, 'BOOKING_OVERLAP')
  WHERE EXISTS (
    SELECT 1
    FROM bookings b
    WHERE b.master_id = NEW.master_id
      AND b.id <> NEW.id
      AND b.status IN ('pending', 'confirmed')
      AND b.starts_at < NEW.ends_at
      AND b.ends_at > NEW.starts_at
  );
END;

-- Частичный UNIQUE-индекс не должен мешать наложениям по совпадению старта:
-- строка с allow_overlap = 1 исключена из ограничения.
DROP INDEX uq_bookings_master_start_active;
CREATE UNIQUE INDEX uq_bookings_master_start_active
  ON bookings (master_id, starts_at)
  WHERE status IN ('pending', 'confirmed') AND allow_overlap = 0;
