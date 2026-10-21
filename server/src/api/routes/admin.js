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

/* ---------- Проверки форм админ-раздела ----------
   Сообщения намеренно человеческие: их показывает форма, а не разработчик. */

function requiredText(value, name, messages, max) {
  if (typeof value !== "string" || !value.trim()) {
    throw badRequest(messages.empty);
  }
  if (value.trim().length > max) {
    throw badRequest(messages.long);
  }
  return v.string(value, name, { max });
}

function positiveInt(value, name, messages, max) {
  if (value === undefined || value === null || value === "") {
    throw badRequest(messages.required);
  }
  const num = Number(String(value).trim());
  if (!Number.isInteger(num)) throw badRequest(messages.integer);
  if (num < 1) throw badRequest(messages.positive);
  if (max !== undefined && num > max) throw badRequest(messages.tooBig);
  return num;
}

const SERVICE_NAME_MESSAGES = {
  empty: "Название услуги не может быть пустым",
  long: "Название услуги слишком длинное",
};

const SERVICE_DURATION_MESSAGES = {
  required: "Укажите длительность услуги",
  integer: "Длительность услуги должна быть целым числом",
  positive: "Длительность услуги должна быть больше нуля",
  tooBig: "Длительность услуги слишком большая",
};

const SERVICE_PRICE_MESSAGES = {
  required: "Укажите цену услуги",
  integer: "Цена услуги должна быть целым числом",
  positive: "Цена услуги должна быть больше нуля",
  tooBig: "Цена услуги слишком большая",
};

const MASTER_NAME_MESSAGES = {
  empty: "Имя мастера не может быть пустым",
  long: "Имя мастера слишком длинное",
};

function plural(count, one, few, many) {
  const mod10 = count % 10;
  const mod100 = count % 100;
  if (mod10 === 1 && mod100 !== 11) return one;
  if (mod10 >= 2 && mod10 <= 4 && (mod100 < 12 || mod100 > 14)) return few;
  return many;
}

function recordsWord(count) {
  return plural(count, "запись", "записи", "записей");
}

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
        "SELECT s.id, s.name, s.description, s.duration_min, s.price_minor, s.currency, s.is_active, " +
          "(SELECT COUNT(*) FROM bookings b WHERE b.service_id = s.id) AS bookings_count, " +
          "(SELECT COUNT(*) FROM master_services ms WHERE ms.service_id = s.id) AS masters_count " +
          "FROM services s ORDER BY s.name"
      )
      .all();
    return {
      services: rows.map((row) => ({
        ...mappers.service(row),
        bookingsCount: row.bookings_count,
        mastersCount: row.masters_count,
      })),
    };
  });

  router.post("/api/admin/services", async (ctx) => {
    requireRole(ctx, "admin");
    const body = ctx.body || {};
    const name = requiredText(body.name, "name", SERVICE_NAME_MESSAGES, 200);
    const description = v.optionalString(body.description, "description", { max: 1000 });
    const durationMin = positiveInt(
      body.durationMin,
      "durationMin",
      SERVICE_DURATION_MESSAGES,
      24 * 60
    );
    const priceMinor = positiveInt(body.priceMinor, "priceMinor", SERVICE_PRICE_MESSAGES, 100000000);
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
    const name =
      body.name === undefined
        ? row.name
        : requiredText(body.name, "name", SERVICE_NAME_MESSAGES, 200);
    const description =
      body.description === undefined
        ? row.description
        : v.optionalString(body.description, "description", { max: 1000 });
    const durationMin =
      body.durationMin === undefined
        ? row.duration_min
        : positiveInt(body.durationMin, "durationMin", SERVICE_DURATION_MESSAGES, 24 * 60);
    const priceMinor =
      body.priceMinor === undefined
        ? row.price_minor
        : positiveInt(body.priceMinor, "priceMinor", SERVICE_PRICE_MESSAGES, 100000000);
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

  /* Умное удаление: если по услуге есть записи, её нельзя удалить —
     иначе пропадёт история записей. Тогда отключаем услугу: в каталоге
     и в форме записи она пропадает, новые записи не создаются,
     а старые остаются со своим снимком услуги (цена и длительность). */
  router.delete("/api/admin/services/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    const row = db.prepare("SELECT id, name FROM services WHERE id = ?").get(id);
    if (!row) throw notFound("Услуга не найдена");

    const bookingsCount = db
      .prepare("SELECT COUNT(*) AS c FROM bookings WHERE service_id = ?")
      .get(id).c;

    if (bookingsCount === 0) {
      db.prepare("DELETE FROM services WHERE id = ?").run(id);
      return {
        serviceId: id,
        deleted: true,
        disabled: false,
        isActive: false,
        bookingsCount: 0,
        message: "Услуга «" + row.name + "» удалена: по ней не было записей.",
      };
    }

    db.prepare(
      "UPDATE services SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(id);
    return {
      serviceId: id,
      deleted: false,
      disabled: true,
      isActive: false,
      bookingsCount,
      message:
        "Услуга «" + row.name + "» не удалена: по ней " + bookingsCount + " " +
        recordsWord(bookingsCount) + ". Отключена — новые записи не создаются, старые остаются.",
    };
  });

  router.get("/api/admin/masters", async (ctx) => {
    requireRole(ctx, "admin");
    const db = getDb();
    const rows = db
      .prepare(
        "SELECT m.id, m.full_name, m.title, m.bio, m.avatar_url, m.is_active, m.user_id, " +
          "(SELECT COUNT(*) FROM bookings b WHERE b.master_id = m.id) AS bookings_count " +
          "FROM masters m ORDER BY m.full_name"
      )
      .all();
    const serviceMap = masterServiceIds(db, rows.map((row) => row.id));
    return {
      masters: rows.map((row) => ({
        ...mappers.master(row, serviceMap.get(row.id) || []),
        bookingsCount: row.bookings_count,
      })),
    };
  });

  router.post("/api/admin/masters", async (ctx) => {
    requireRole(ctx, "admin");
    const body = ctx.body || {};
    const fullName = requiredText(body.fullName, "fullName", MASTER_NAME_MESSAGES, 120);
    const title = v.optionalString(body.title, "title", { max: 200 });
    const bio = v.optionalString(body.bio, "bio", { max: 2000 });
    const avatarUrl = v.optionalString(body.avatarUrl, "avatarUrl", { max: 500 });
    const isActive = body.isActive === undefined ? true : v.bool(body.isActive, "isActive");
    const serviceIds =
      body.serviceIds === undefined
        ? []
        : v.ids(body.serviceIds, "serviceIds", { max: 50, allowEmpty: true });

    const db = getDb();

    // Проверяем услуги ДО любых вставок, чтобы не создавать «осиротевший» аккаунт.
    if (serviceIds.length) assertServicesExist(serviceIds);

    // Аккаунт (если нужен), профиль мастера и связи с услугами создаём в ОДНОЙ
    // транзакции: при любой ошибке откатывается всё, а не остаётся аккаунт без
    // профиля или профиль без аккаунта.
    let userId = null;
    let userEmail = null;
    let userPassword = null;
    // Пустая строка — это «аккаунт не нужен», а не ошибка формата.
    if (body.userEmail !== undefined && String(body.userEmail).trim() !== "") {
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
      body.fullName === undefined
        ? row.full_name
        : requiredText(body.fullName, "fullName", MASTER_NAME_MESSAGES, 120);
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
    const serviceIds = hasServices
      ? v.ids(body.serviceIds, "serviceIds", { max: 50, allowEmpty: true })
      : null;
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

  /* Умное удаление мастера: при наличии записей профиль не удаляется,
     а отключается — иначе пропала бы история записей. Если записей нет,
     удаляем профиль целиком: связи с услугами, график и блокировки
     времени уходят каскадом (см. миграцию 002_init.sql). */
  router.delete("/api/admin/masters/:id", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    const row = db.prepare("SELECT id, full_name, user_id FROM masters WHERE id = ?").get(id);
    if (!row) throw notFound("Мастер не найден");

    const bookingsCount = db
      .prepare("SELECT COUNT(*) AS c FROM bookings WHERE master_id = ?")
      .get(id).c;

    if (bookingsCount === 0) {
      db.exec("BEGIN");
      try {
        db.prepare("DELETE FROM masters WHERE id = ?").run(id);
        // Аккаунт мастера: если роль master — единственная, удаляем аккаунт
        // вместе с его сессиями, иначе — оставляем аккаунт, но снимаем роль.
        if (row.user_id) {
          const roles = db
            .prepare("SELECT role FROM user_roles WHERE user_id = ?")
            .all(row.user_id)
            .map((item) => item.role);
          if (roles.length === 1 && roles[0] === "master") {
            db.prepare("DELETE FROM users WHERE id = ?").run(row.user_id);
          } else if (roles.includes("master")) {
            db.prepare("DELETE FROM user_roles WHERE user_id = ? AND role = 'master'").run(row.user_id);
          }
        }
        db.exec("COMMIT");
      } catch (error) {
        db.exec("ROLLBACK");
        throw error;
      }
      return {
        masterId: id,
        deleted: true,
        disabled: false,
        isActive: false,
        bookingsCount: 0,
        message: "Мастер «" + row.full_name + "» удалён: по нему не было записей.",
      };
    }

    db.prepare(
      "UPDATE masters SET is_active = 0, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
    ).run(id);
    return {
      masterId: id,
      deleted: false,
      disabled: true,
      isActive: false,
      bookingsCount,
      message:
        "Мастер «" + row.full_name + "» не удалён: у него " + bookingsCount + " " +
        recordsWord(bookingsCount) + ". Отключён — новые записи не создаются, старые остаются.",
    };
  });

  router.put("/api/admin/masters/:id/services", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    if (!db.prepare("SELECT id FROM masters WHERE id = ?").get(id)) {
      throw notFound("Мастер не найден");
    }
    const serviceIds = v.ids((ctx.body || {}).serviceIds, "serviceIds", {
      max: 50,
      allowEmpty: true,
    });
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

  /* Текущий график мастера — чтобы форма редактирования открывалась
     с уже сохранёнными сменами, а не с пустым полем. */
  router.get("/api/admin/masters/:id/schedule", async (ctx) => {
    requireRole(ctx, "admin");
    const id = v.int(ctx.params.id, "id", { min: 1 });
    const db = getDb();
    if (!db.prepare("SELECT id FROM masters WHERE id = ?").get(id)) {
      throw notFound("Мастер не найден");
    }
    const rows = db
      .prepare(
        "SELECT weekday, start_time, end_time, valid_from, valid_to " +
          "FROM master_schedules WHERE master_id = ? ORDER BY weekday, start_time"
      )
      .all(id);
    return {
      masterId: id,
      schedule: rows.map((row) => ({
        weekday: row.weekday,
        startTime: row.start_time,
        endTime: row.end_time,
        validFrom: row.valid_from ?? null,
        validTo: row.valid_to ?? null,
      })),
    };
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
