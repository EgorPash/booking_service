"use strict";

const { getDb } = require("../../db/connection");
const { hashPassword } = require("../../auth/password");
const { HttpError, badRequest, notFound, conflict, forbidden } = require("../http");
const { requireRole, requireAuth, hasRole } = require("../session");
const { getStudio, assertServicesExist } = require("../availability");
const { bookingSelect, masterServiceIds } = require("../sql");
const { setStatusByAdmin } = require("../booking-service");
const time = require("../time");
const v = require("../validate");
const mappers = require("../mappers");

const BOOKING_STATUSES = ["pending", "confirmed", "cancelled", "completed", "no_show"];

function studioView(studio) {
  return {
    id: studio.id,
    name: studio.name,
    address: studio.address,
    phone: studio.phone,
    timezone: studio.timezone,
    currency: studio.currency,
    openingTime: studio.opening_time,
    closingTime: studio.closing_time,
    slotStepMinutes: studio.slot_step_minutes,
    holdTtlMinutes: studio.hold_ttl_minutes,
  };
}

function register(router) {
  /* Проверка доступа к админ-разделу — единая точка правды.
     Роли приходят из БД (user_roles) списком, поэтому смотрим вхождение
     роли в список, а не равенство: у пользователя их может быть несколько.
     Роль admin назначается только в БД — выдать её через API нельзя. */
  router.get("/api/admin/access", async (ctx) => {
    const user = requireAuth(ctx);
    if (!hasRole(user, "admin")) {
      throw forbidden("Этот раздел только для администраторов");
    }
    return { user: { id: user.id, email: user.email, roles: user.roles } };
  });

  router.get("/api/admin/studio", async (ctx) => {
    requireRole(ctx, "admin");
    const studio = getStudio();
    if (!studio) throw notFound("Настройки студии не заданы");
    return { studio: studioView(studio) };
  });

  router.patch("/api/admin/studio", async (ctx) => {
    requireRole(ctx, "admin");
    const db = getDb();
    const studio = getStudio();
    if (!studio) throw notFound("Настройки студии не заданы");

    const body = ctx.body || {};
    const timezone =
      body.timezone === undefined ? studio.timezone : v.string(body.timezone, "timezone", { max: 64 });
    const currency =
      body.currency === undefined
        ? studio.currency
        : v.string(body.currency, "currency", { min: 3, max: 3 }).toUpperCase();
    const openingTime =
      body.openingTime === undefined
        ? studio.opening_time
        : v.timeHHMM(body.openingTime, "openingTime");
    const closingTime =
      body.closingTime === undefined
        ? studio.closing_time
        : v.timeHHMM(body.closingTime, "closingTime");
    const slotStepMinutes =
      body.slotStepMinutes === undefined
        ? studio.slot_step_minutes
        : v.int(body.slotStepMinutes, "slotStepMinutes", { min: 5, max: 240 });
    const holdTtlMinutes =
      body.holdTtlMinutes === undefined
        ? studio.hold_ttl_minutes
        : v.int(body.holdTtlMinutes, "holdTtlMinutes", { min: 1, max: 120 });

    try {
      new Intl.DateTimeFormat("en-US", { timeZone: timezone });
    } catch (error) {
      throw badRequest('Поле "timezone" содержит неизвестный часовой пояс');
    }
    if (openingTime >= closingTime) {
      throw badRequest("Время открытия должно быть раньше времени закрытия");
    }

    db.prepare(
      "UPDATE studios SET timezone = ?, currency = ?, opening_time = ?, closing_time = ?, " +
        "slot_step_minutes = ?, hold_ttl_minutes = ?, " +
        "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(timezone, currency, openingTime, closingTime, slotStepMinutes, holdTtlMinutes, studio.id);

    return { studio: studioView(getStudio()) };
  });

  router.get("/api/admin/bookings", async (ctx) => {
    requireRole(ctx, "admin");
    const db = getDb();
    const timeZone = getStudio().timezone;

    const conditions = [];
    const params = [];

    const status = ctx.query.get("status");
    if (status) {
      conditions.push("b.status = ?");
      params.push(v.enumValue(status, "status", BOOKING_STATUSES));
    }
    const masterId = ctx.query.get("masterId");
    if (masterId) {
      conditions.push("b.master_id = ?");
      params.push(v.int(masterId, "masterId", { min: 1 }));
    }
    const clientId = ctx.query.get("clientId");
    if (clientId) {
      conditions.push("b.client_id = ?");
      params.push(v.int(clientId, "clientId", { min: 1 }));
    }
    const date = ctx.query.get("date");
    if (date) {
      const day = v.dateOnly(date);
      const dayStart = time.localToUtcIso(day, "00:00", timeZone);
      const dayEnd = time.addDaysIso(dayStart, 1);
      conditions.push("b.starts_at >= ? AND b.starts_at < ?");
      params.push(dayStart, dayEnd);
    }

    const where = conditions.length ? "WHERE " + conditions.join(" AND ") : "";
    const rows = db
      .prepare(bookingSelect(where) + "ORDER BY b.starts_at DESC")
      .all(...params);
    return { bookings: rows.map((row) => mappers.bookingDetail(row, timeZone)) };
  });

  router.patch("/api/admin/bookings/:id/status", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const status = v.enumValue((ctx.body || {}).status, "status", BOOKING_STATUSES);
    return { booking: setStatusByAdmin(id, status) };
  });

  router.get("/api/admin/services", async (ctx) => {
    requireRole(ctx, "admin");
    const rows = getDb()
      .prepare(
        "SELECT id, name, description, duration_min, price_minor, currency, is_active FROM services ORDER BY name"
      )
      .all();
    return { services: rows.map(mappers.service) };
  });

  router.post("/api/admin/services", async (ctx) => {
    requireRole(ctx, "admin");
    const body = ctx.body || {};
    const name = v.string(body.name, "name", { max: 200 });
    const description = v.optionalString(body.description, "description", { max: 1000 });
    const durationMin = v.int(body.durationMin, "durationMin", { min: 1, max: 24 * 60 });
    const priceMinor = v.int(body.priceMinor, "priceMinor", { min: 0 });
    const currency = body.currency
      ? v.string(body.currency, "currency", { min: 3, max: 3 }).toUpperCase()
      : "RUB";
    const isActive = body.isActive === undefined ? true : v.bool(body.isActive, "isActive");

    const db = getDb();
    if (db.prepare("SELECT id FROM services WHERE name = ?").get(name)) {
      throw conflict("Услуга с таким названием уже существует");
    }
    const info = db
      .prepare(
        "INSERT INTO services (name, description, duration_min, price_minor, currency, is_active) VALUES (?, ?, ?, ?, ?, ?)"
      )
      .run(name, description, durationMin, priceMinor, currency, isActive ? 1 : 0);

    ctx.status = 201;
    const row = db
      .prepare(
        "SELECT id, name, description, duration_min, price_minor, currency, is_active FROM services WHERE id = ?"
      )
      .get(Number(info.lastInsertRowid));
    return { service: mappers.service(row) };
  });

  router.patch("/api/admin/services/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    const row = db.prepare("SELECT * FROM services WHERE id = ?").get(id);
    if (!row) throw notFound("Услуга не найдена");

    const body = ctx.body || {};
    const name = body.name === undefined ? row.name : v.string(body.name, "name", { max: 200 });
    const description =
      body.description === undefined
        ? row.description
        : v.optionalString(body.description, "description", { max: 1000 });
    const durationMin =
      body.durationMin === undefined
        ? row.duration_min
        : v.int(body.durationMin, "durationMin", { min: 1, max: 24 * 60 });
    const priceMinor =
      body.priceMinor === undefined
        ? row.price_minor
        : v.int(body.priceMinor, "priceMinor", { min: 0 });
    const currency =
      body.currency === undefined
        ? row.currency
        : v.string(body.currency, "currency", { min: 3, max: 3 }).toUpperCase();
    const isActive =
      body.isActive === undefined ? row.is_active === 1 : v.bool(body.isActive, "isActive");

    if (name !== row.name) {
      const dup = db.prepare("SELECT id FROM services WHERE name = ? AND id <> ?").get(name, id);
      if (dup) throw conflict("Услуга с таким названием уже существует");
    }

    db.prepare(
      "UPDATE services SET name = ?, description = ?, duration_min = ?, price_minor = ?, currency = ?, is_active = ?, " +
        "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(name, description, durationMin, priceMinor, currency, isActive ? 1 : 0, id);

    const updated = db
      .prepare(
        "SELECT id, name, description, duration_min, price_minor, currency, is_active FROM services WHERE id = ?"
      )
      .get(id);
    return { service: mappers.service(updated) };
  });

  router.delete("/api/admin/services/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    if (!db.prepare("SELECT id FROM services WHERE id = ?").get(id)) {
      throw notFound("Услуга не найдена");
    }
    db.prepare(
      "UPDATE services SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(id);
    return { serviceId: id, isActive: false };
  });

  router.get("/api/admin/masters", async (ctx) => {
    requireRole(ctx, "admin");
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT id, full_name, title, bio, avatar_url, is_active FROM masters ORDER BY full_name"
      )
      .all();
    const serviceMap = masterServiceIds(db, rows.map((row) => row.id));
    return { masters: rows.map((row) => mappers.master(row, serviceMap.get(row.id) || [])) };
  });

  router.post("/api/admin/masters", async (ctx) => {
    requireRole(ctx, "admin");
    const body = ctx.body || {};
    const fullName = v.string(body.fullName, "fullName", { max: 120 });
    const title = v.optionalString(body.title, "title", { max: 200 });
    const bio = v.optionalString(body.bio, "bio", { max: 2000 });
    const avatarUrl = v.optionalString(body.avatarUrl, "avatarUrl", { max: 500 });
    const isActive = body.isActive === undefined ? true : v.bool(body.isActive, "isActive");
    const serviceIds = body.serviceIds === undefined ? [] : v.ids(body.serviceIds, "serviceIds", { max: 50 });

    const db = getDb();

    // Проверяем услуги ДО любых вставок, чтобы не создавать «осиротевший» аккаунт.
    if (serviceIds.length) assertServicesExist(serviceIds);

    // Аккаунт (если нужен), профиль мастера и связи с услугами создаём в ОДНОЙ
    // транзакции: при любой ошибке откатывается всё, а не остаётся аккаунт без
    // профиля или профиль без аккаунта.
    let userId = null;
    let userEmail = null;
    let userPassword = null;
    if (body.userEmail !== undefined) {
      userEmail = v.email(body.userEmail, "userEmail");
      userPassword = v.password(body.userPassword, "userPassword");
    }

    db.exec("BEGIN");
    try {
      if (userEmail !== null) {
        if (db.prepare("SELECT id FROM users WHERE email = ?").get(userEmail)) {
          throw conflict("Пользователь с таким email уже существует");
        }
        const info = db
          .prepare("INSERT INTO users (email, password_hash, is_active) VALUES (?, ?, 1)")
          .run(userEmail, hashPassword(userPassword));
        userId = Number(info.lastInsertRowid);
        db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'master')").run(userId);
      }

      const info = db
        .prepare(
          "INSERT INTO masters (user_id, full_name, title, bio, avatar_url, is_active) VALUES (?, ?, ?, ?, ?, ?)"
        )
        .run(userId, fullName, title, bio, avatarUrl, isActive ? 1 : 0);
      const masterId = Number(info.lastInsertRowid);
      const link = db.prepare("INSERT OR IGNORE INTO master_services (master_id, service_id) VALUES (?, ?)");
      for (const serviceId of serviceIds) link.run(masterId, serviceId);
      db.exec("COMMIT");

      ctx.status = 201;
      const row = db
        .prepare(
          "SELECT id, full_name, title, bio, avatar_url, is_active FROM masters WHERE id = ?"
        )
        .get(masterId);
      return { master: mappers.master(row, serviceIds) };
    } catch (error) {
      db.exec("ROLLBACK");
      if (error instanceof HttpError) throw error;
      if (String(error.message || "").includes("UNIQUE")) {
        throw conflict("Профиль мастера для этого аккаунта уже существует");
      }
      throw error;
    }
  });

  router.patch("/api/admin/masters/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    const row = db.prepare("SELECT * FROM masters WHERE id = ?").get(id);
    if (!row) throw notFound("Мастер не найден");

    const body = ctx.body || {};
    const fullName =
      body.fullName === undefined ? row.full_name : v.string(body.fullName, "fullName", { max: 120 });
    const title =
      body.title === undefined ? row.title : v.optionalString(body.title, "title", { max: 200 });
    const bio = body.bio === undefined ? row.bio : v.optionalString(body.bio, "bio", { max: 2000 });
    const avatarUrl =
      body.avatarUrl === undefined
        ? row.avatar_url
        : v.optionalString(body.avatarUrl, "avatarUrl", { max: 500 });
    const isActive =
      body.isActive === undefined ? row.is_active === 1 : v.bool(body.isActive, "isActive");
    const hasServices = body.serviceIds !== undefined;
    const serviceIds = hasServices ? v.ids(body.serviceIds, "serviceIds", { max: 50 }) : null;
    if (hasServices && serviceIds.length) assertServicesExist(serviceIds);

    db.exec("BEGIN");
    try {
      db.prepare(
        "UPDATE masters SET full_name = ?, title = ?, bio = ?, avatar_url = ?, is_active = ?, " +
          "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
      ).run(fullName, title, bio, avatarUrl, isActive ? 1 : 0, id);

      if (hasServices) {
        db.prepare("DELETE FROM master_services WHERE master_id = ?").run(id);
        const link = db.prepare("INSERT OR IGNORE INTO master_services (master_id, service_id) VALUES (?, ?)");
        for (const serviceId of serviceIds) link.run(id, serviceId);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }

    const updated = db
      .prepare("SELECT id, full_name, title, bio, avatar_url, is_active FROM masters WHERE id = ?")
      .get(id);
    const serviceMap = masterServiceIds(db, [id]);
    return { master: mappers.master(updated, serviceMap.get(id) || []) };
  });

  router.delete("/api/admin/masters/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    if (!db.prepare("SELECT id FROM masters WHERE id = ?").get(id)) {
      throw notFound("Мастер не найден");
    }
    db.prepare(
      "UPDATE masters SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(id);
    return { masterId: id, isActive: false };
  });

  router.put("/api/admin/masters/:id/services", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    if (!db.prepare("SELECT id FROM masters WHERE id = ?").get(id)) {
      throw notFound("Мастер не найден");
    }
    const serviceIds = v.ids((ctx.body || {}).serviceIds, "serviceIds", { max: 50 });
    if (serviceIds.length) assertServicesExist(serviceIds);

    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM master_services WHERE master_id = ?").run(id);
      const link = db.prepare("INSERT OR IGNORE INTO master_services (master_id, service_id) VALUES (?, ?)");
      for (const serviceId of serviceIds) link.run(id, serviceId);
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { masterId: id, serviceIds };
  });

  router.put("/api/admin/masters/:id/schedule", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    if (!db.prepare("SELECT id FROM masters WHERE id = ?").get(id)) {
      throw notFound("Мастер не найден");
    }

    const raw = (ctx.body || {}).schedule;
    if (!Array.isArray(raw)) throw badRequest('Поле "schedule" должно быть массивом');

    const items = raw.map((item, index) => {
      const item_ = item || {};
      const weekday = v.int(item_.weekday, "schedule[" + index + "].weekday", { min: 1, max: 7 });
      const startTime = v.timeHHMM(item_.startTime, "schedule[" + index + "].startTime");
      const endTime = v.timeHHMM(item_.endTime, "schedule[" + index + "].endTime");
      if (startTime >= endTime) throw badRequest("В графике начало смены должно быть раньше конца");
      const validFrom = item_.validFrom ? v.dateOnly(item_.validFrom, "validFrom") : null;
      const validTo = item_.validTo ? v.dateOnly(item_.validTo, "validTo") : null;
      return { weekday, startTime, endTime, validFrom, validTo };
    });

    db.exec("BEGIN");
    try {
      db.prepare("DELETE FROM master_schedules WHERE master_id = ?").run(id);
      const insert = db.prepare(
        "INSERT INTO master_schedules (master_id, weekday, start_time, end_time, valid_from, valid_to) VALUES (?, ?, ?, ?, ?, ?)"
      );
      for (const item of items) {
        insert.run(id, item.weekday, item.startTime, item.endTime, item.validFrom, item.validTo);
      }
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      throw error;
    }
    return { masterId: id, schedule: items };
  });
}

module.exports = { register };
