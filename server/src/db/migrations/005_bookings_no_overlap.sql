-- ============================================================
-- 005_bookings_no_overlap.sql
-- Запрет пересечения записей одного мастера по времени (уровень БД).
--
-- Проверяется не только совпадение начала (за это уже отвечает частичный
-- UNIQUE-индекс uq_bookings_master_start_active), а любое пересечение
-- интервалов: начало одного визита < конца другого И конец одного > начала
-- другого. Визиты «вплотную» (15:00–16:00 и 16:00–17:00) пересечением не
-- считаются: сравнения строгие.
--
-- Учитываются только активные записи (pending/confirmed): отменённые,
-- завершённые и неявившиеся слот не блокируют.
--
-- Два триггера: на INSERT (новая запись) и на UPDATE (перенос по времени
-- или смена мастера). Оба «бросают» ABORT с кодом BOOKING_OVERLAP, который
-- перехватывает API.
-- ============================================================

CREATE TRIGGER trg_bookings_no_overlap_insert
BEFORE INSERT ON bookings
FOR EACH ROW
WHEN NEW.status IN ('pending', 'confirmed')
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
WHEN NEW.status IN ('pending', 'confirmed')
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
