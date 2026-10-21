"use strict";

/**
 * Сервис записей: создание, перенос, отмена и смена статуса.
 *
 * Создание записи — ЕДИНСТВЕННАЯ функция `createBookings`, общая для всех трёх
 * ролей. Различия видны внутри и касаются только прав и доступных полей:
 *
 *   роль     | masterId                      | clientId | allowOverlap | доп. поля
 *   ---------|--------------------------------|----------|--------------|------------------
 *   client   | обязателен                     | занят     | игнорируется | —
 *   master   | только свой профиль (иначе 403)| можно     | игнорируется | fullName+phone
 *   admin    | обязателен                     | можно     | учитывается  | fullName+phone
 *
 * Сама вставка выполняется единственной низкоуровневой функцией
 * `insertBookingRow` (см. `db/bookings.js`) — другого пути в таблицу нет.
 */

const { getDb } = require("../db/connection");
const { insertBookingRow } = require("../db/bookings");
const { conflict, forbidden, notFound } = require("./http");
const {
  getActiveMaster,
  resolveServices,
  assertMasterProvides,
  isIntervalFree,
  nearestFreeSlots,
  studioTimezone,
} = require("./availability");
const { bookingSelect } = require("./sql");
const { hasRole } = require("./session");
const holds = require("./holds");
const time = require("./time");
const v = require("./validate");
const mappers = require("./mappers");

const SLOT_TAKEN_MESSAGE = "Выбранное время уже занято";
const ACTIVE_STATUSES = ["pending", "confirmed"];

function isActive(booking) {
  return ACTIVE_STATUSES.includes(booking.status);
}

/**
 * Роли читаем из БД (их может быть несколько). Приоритет прав:
 * admin > master > client — если у человека несколько ролей, действуют
 * самые широкие. «Только клиент» — это роль client без admin и master.
 */
function canChooseClient(user) {
  return hasRole(user, "admin") || hasRole(user, "master");
}

function isClientOnly(user) {
  return hasRole(user, "client") && !canChooseClient(user);
}

function resolveAllowOverlap(user, body) {
  if (!hasRole(user, "admin")) return false;
  if (body.allowOverlap === undefined) return false;
  return v.bool(body.allowOverlap, "allowOverlap");
}

function resolveMasterId(db, user, body) {
  if (hasRole(user, "admin")) {
    return v.int(body.masterId, "masterId", { min: 1 });
  }
  if (hasRole(user, "master")) {
    const own = db.prepare("SELECT id FROM masters WHERE user_id = ?").get(user.id);
    if (!own) throw forbidden("У профиля мастера нет записи в базе");
    if (body.masterId !== undefined && v.int(body.masterId, "masterId", { min: 1 }) !== own.id) {
      throw forbidden("Мастер может создавать записи только к себе");
    }
    return own.id;
  }
  return v.int(body.masterId, "masterId", { min: 1 });
}

/**
 * Профиль клиента для новой записи.
 *
 * Клиент (роль client) всегда работает со своим профилем: ищем по email.
 * Профиля нет — значит клиент пришёл с телефона, по которому запись завёл
 * мастер, или профиль ещё не заведён. Тогда клиент присылает имя и телефон
 * сам, и мы заводим профиль. Чужой профиль (email уже занят) НЕ трогаем:
 * переписывать его full_name нельзя — это портит данные другого человека.
 *
 * Мастер и администратор создают запись для клиента: профиль заводится или
 * уточняется по имени и телефону, но email чужого профиля не переносится.
 */
function resolveClientProfile(db, user, body) {
  if (isClientOnly(user)) {
    const own = db
      .prepare("SELECT id, full_name, phone, email FROM clients WHERE email = ?")
      .get(user.email);
    if (own) return own;

    if (body.clientId !== undefined) {
      throw forbidden("Клиент не может выбрать другого клиента");
    }

    const fullName = v.string(body.fullName, "fullName", { max: 120 });
    const phone = v.phone(body.phone);
    const existing = db
      .prepare("SELECT id, full_name, phone, email FROM clients WHERE phone = ?")
      .get(phone);

    if (existing) {
      if (existing.email) {
        throw conflict("Этот телефон уже привязан к другому клиенту");
      }
      // Профиль «ничейный» (email IS NULL) — забираем его себе.
      db.prepare(
        "UPDATE clients SET full_name = ?, email = ?, " +
          "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
      ).run(fullName, user.email, existing.id);
    } else {
      db.prepare("INSERT INTO clients (full_name, phone, email) VALUES (?, ?, ?)").run(
        fullName,
        phone,
        user.email
      );
    }
    return db.prepare("SELECT id, full_name, phone, email FROM clients WHERE phone = ?").get(phone);
  }

  if (body.clientId !== undefined) {
    const id = v.int(body.clientId, "clientId", { min: 1 });
    const row = db.prepare("SELECT id, full_name, phone, email FROM clients WHERE id = ?").get(id);
    if (!row) throw notFound("Клиент не найден");
    return row;
  }

  const fullName = v.string(body.fullName, "fullName", { max: 120 });
  const phone = v.phone(body.phone);
  const existing = db.prepare("SELECT id, full_name, phone, email FROM clients WHERE phone = ?").get(phone);
  if (existing) {
    db.prepare(
      "UPDATE clients SET full_name = ?, " +
        "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(fullName, existing.id);
  } else {
    db.prepare("INSERT INTO clients (full_name, phone, email) VALUES (?, ?, NULL)").run(fullName, phone);
  }
  return db.prepare("SELECT id, full_name, phone, email FROM clients WHERE phone = ?").get(phone);
}

function isOverlapDbError(error) {
  const message = String((error && error.message) || "");
  return message.includes("BOOKING_OVERLAP") || message.includes("UNIQUE");
}

function isSlotConflict(error) {
  return (error.status === 409 && error.message === SLOT_TAKEN_MESSAGE) || isOverlapDbError(error);
}

function slotTakenError(masterId, durationMin, timeZone, fromIso) {
  let nearestSlots = [];
  try {
    nearestSlots = nearestFreeSlots({ masterId, durationMin, timeZone, fromIso, limit: 5 });
  } catch (error) {
    nearestSlots = [];
  }
  return conflict(SLOT_TAKEN_MESSAGE, { nearestSlots });
}

function getBookingOrThrow(db, id) {
  const row = db.prepare(bookingSelect("WHERE b.id = ?")).get(id);
  if (!row) throw notFound("Запись не найдена");
  return row;
}

function assertBookingAccess(db, user, row) {
  if (hasRole(user, "admin")) return;
  if (hasRole(user, "master")) {
    const master = db.prepare("SELECT id FROM masters WHERE user_id = ?").get(user.id);
    if (master && master.id === row.master_id) return;
  }
  if (hasRole(user, "client")) {
    const client = db.prepare("SELECT id FROM clients WHERE email = ?").get(user.email);
    if (client && client.id === row.client_id) return;
  }
  throw forbidden("Нет доступа к этой записи");
}

function rollbackQuietly(db) {
  try {
    db.exec("ROLLBACK");
  } catch (error) {
    // транзакция могла быть уже завершена триггером — это нормально
  }
}

/** Чтение записи с проверкой доступа (владелец или админ). */
function getBookingDetail(user, id) {
  const db = getDb();
  const row = getBookingOrThrow(db, id);
  assertBookingAccess(db, user, row);
  return mappers.bookingDetail(row, studioTimezone());
}

/** Единственная функция создания записи для клиента, мастера и администратора. */
function createBookings(user, body) {
  holds.cleanupExpiredHolds();

  const db = getDb();
  const serviceIds = v.idList(body.serviceIds);
  const startsAt = v.isoUtc(body.startsAt, "startsAt");
  const comment = v.optionalString(body.comment, "comment", { max: 1000 });
  const holdToken = body.holdToken ? v.string(body.holdToken, "holdToken", { max: 64 }) : null;

  const allowOverlap = resolveAllowOverlap(user, body);
  const masterId = resolveMasterId(db, user, body);

  if (isClientOnly(user) && body.clientId !== undefined) {
    throw forbidden("Клиент не может выбрать другого клиента");
  }

  getActiveMaster(masterId);
  const selection = resolveServices(serviceIds);
  assertMasterProvides(masterId, serviceIds);

  const timeZone = studioTimezone();
  const endsAt = time.addMinutesIso(startsAt, selection.durationMin);
  const date = time.utcToLocal(startsAt, timeZone).date;

  db.exec("BEGIN IMMEDIATE");
  try {
    let hold = null;
    if (holdToken) {
      hold = holds.getHold(holdToken);
      if (!hold) throw conflict("Удержание не найдено или истекло");
      // Токен удержания принадлежит конкретному пользователю: чужое удержание
      // использовать нельзя (админ — исключение).
      if (hold.userId && hold.userId !== user.id && !hasRole(user, "admin")) {
        throw forbidden("Это удержание принадлежит другому пользователю");
      }
      const sameServices =
        hold.serviceIds.length === serviceIds.length &&
        hold.serviceIds.every((id) => serviceIds.includes(id));
      if (hold.masterId !== masterId || hold.startsAt !== startsAt || !sameServices) {
        throw conflict("Удержание не соответствует выбранному слоту");
      }
    }

    if (!allowOverlap) {
      const free = isIntervalFree({
        masterId,
        date,
        startIso: startsAt,
        endIso: endsAt,
        timeZone,
        excludeHoldId: hold ? hold.id : null,
      });
      if (!free) throw conflict(SLOT_TAKEN_MESSAGE);
    }

    const client = resolveClientProfile(db, user, body);

    const created = [];
    let cursor = startsAt;
    for (const service of selection.services) {
      const row = insertBookingRow(db, {
        clientId: client.id,
        masterId,
        serviceId: service.id,
        serviceName: service.name,
        startsAt: cursor,
        endsAt: time.addMinutesIso(cursor, service.duration_min),
        status: "pending",
        durationMin: service.duration_min,
        priceMinor: service.price_minor,
        currency: service.currency,
        comment,
        allowOverlap,
      });
      created.push(row);
      cursor = row.ends_at;
    }

    if (hold) db.prepare("DELETE FROM slot_holds WHERE id = ?").run(hold.id);
    db.exec("COMMIT");

    return {
      bookings: created.map(mappers.booking),
      clientId: client.id,
      startsAt,
      endsAt,
      durationMin: selection.durationMin,
      priceMinor: selection.priceMinor,
      currency: selection.currency,
    };
  } catch (error) {
    rollbackQuietly(db);
    if (isSlotConflict(error)) {
      throw slotTakenError(masterId, selection.durationMin, timeZone, startsAt);
    }
    throw error;
  }
}

/** Перенос активной записи на другое время. */
function rescheduleBooking(user, id, body) {
  const startsAt = v.isoUtc(body.startsAt, "startsAt");
  const db = getDb();
  const row = getBookingOrThrow(db, id);
  assertBookingAccess(db, user, row);
  if (!isActive(row)) throw conflict("Перенести можно только активную запись (pending/confirmed)");

  const timeZone = studioTimezone();
  const durationMin = time.diffMinutesIso(row.starts_at, row.ends_at);
  const endsAt = time.addMinutesIso(startsAt, durationMin);
  const date = time.utcToLocal(startsAt, timeZone).date;
  const skipOverlapCheck = hasRole(user, "admin") && row.allow_overlap === 1;

  db.exec("BEGIN IMMEDIATE");
  try {
    if (!skipOverlapCheck) {
      const free = isIntervalFree({
        masterId: row.master_id,
        date,
        startIso: startsAt,
        endIso: endsAt,
        timeZone,
        excludeBookingId: row.id,
      });
      if (!free) throw conflict(SLOT_TAKEN_MESSAGE);
    }

    db.prepare(
      "UPDATE bookings SET starts_at = ?, ends_at = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(startsAt, endsAt, id);
    db.exec("COMMIT");
  } catch (error) {
    rollbackQuietly(db);
    if (isSlotConflict(error)) {
      throw slotTakenError(row.master_id, durationMin, timeZone, startsAt);
    }
    throw error;
  }

  return mappers.bookingDetail(getBookingOrThrow(db, id), timeZone);
}

/** Отмена активной записи (владелец или админ). */
function cancelBooking(user, id) {
  const db = getDb();
  const row = getBookingOrThrow(db, id);
  assertBookingAccess(db, user, row);
  if (!isActive(row)) throw conflict("Отменить можно только активную запись (pending/confirmed)");
  updateBookingStatus(db, id, "cancelled");
  return mappers.bookingDetail(getBookingOrThrow(db, id), studioTimezone());
}

/** Смена статуса администратором (в том числе отмена). */
function setStatusByAdmin(id, status) {
  const db = getDb();
  getBookingOrThrow(db, id);
  updateBookingStatus(db, id, status);
  return mappers.bookingDetail(getBookingOrThrow(db, id), studioTimezone());
}

/** Единственная функция обновления статуса записи. */
function updateBookingStatus(db, id, status) {
  db.prepare(
    "UPDATE bookings SET status = ?, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
  ).run(status, id);
}

module.exports = {
  createBookings,
  getBookingDetail,
  rescheduleBooking,
  cancelBooking,
  setStatusByAdmin,
};
