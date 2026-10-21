"use strict";

const BOOKING_SELECT =
  "SELECT b.*, c.full_name AS client_full_name, c.phone AS client_phone, " +
  "m.full_name AS master_full_name, " +
  // Название услуги — снимок из самой записи: переименование услуги
  // в справочнике не должно менять уже оформленные записи.
  "COALESCE(b.service_name, s.name) AS service_name, " +
  "s.duration_min AS service_duration_min " +
  "FROM bookings b " +
  "JOIN clients c ON c.id = b.client_id " +
  "JOIN masters m ON m.id = b.master_id " +
  "JOIN services s ON s.id = b.service_id ";

function bookingSelect(where) {
  return BOOKING_SELECT + (where ? where + " " : "");
}

function masterServiceIds(db, masterIds) {
  const map = new Map();
  if (!masterIds || masterIds.length === 0) return map;
  const placeholders = masterIds.map(() => "?").join(",");
  const rows = db
    .prepare(
      "SELECT master_id, service_id FROM master_services WHERE master_id IN (" +
        placeholders +
        ")"
    )
    .all(...masterIds);
  for (const row of rows) {
    if (!map.has(row.master_id)) map.set(row.master_id, []);
    map.get(row.master_id).push(row.service_id);
  }
  return map;
}

module.exports = { bookingSelect, masterServiceIds };
