"use strict";

/**
 * Единственная точка записи строки в таблицу `bookings`.
 *
 * Любой код, создающий запись (HTTP-API, сиды), обязан идти через
 * `insertBookingRow`. Второго INSERT в таблицу bookings в проекте быть не должно,
 * иначе легко разойтись в наборе заполняемых полей и в обходе ограничений БД.
 *
 * `durationMin`, `priceMinor` и `serviceName` — снимок услуги на момент
 * записи: правка прайса или переименование услуги не должны менять
 * уже созданные записи.
 */

const INSERT_SQL =
  "INSERT INTO bookings " +
  "(client_id, master_id, service_id, service_name, starts_at, ends_at, status, " +
  "duration_min, price_minor, currency, comment, allow_overlap) " +
  "VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)";

function insertBookingRow(db, booking) {
  const info = db
    .prepare(INSERT_SQL)
    .run(
      booking.clientId,
      booking.masterId,
      booking.serviceId,
      booking.serviceName === undefined ? null : booking.serviceName,
      booking.startsAt,
      booking.endsAt,
      booking.status || "pending",
      booking.durationMin,
      booking.priceMinor,
      booking.currency || "RUB",
      booking.comment === undefined ? null : booking.comment,
      booking.allowOverlap ? 1 : 0
    );
  return db.prepare("SELECT * FROM bookings WHERE id = ?").get(Number(info.lastInsertRowid));
}

module.exports = { insertBookingRow };
