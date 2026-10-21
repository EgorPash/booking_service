"use strict";

/**
 * Тестовые данные для разработки.
 *
 * Наполняет пустую базу так, чтобы сервис было чем проверять:
 *   - 3 пользователя (admin / master / client) с хешированными паролями;
 *   - 2 мастера со специализациями;
 *   - 5 услуг с реальной длительностью и ценой;
 *   - недельный график мастеров (Пн–Сб, 10:00–20:00);
 *   - несколько записей на ближайшие рабочие дни.
 *
 * Скрипт повторяемый: повторный запуск не создаёт дубли — данные
 * обновляются по уникальным ключам (email/телефон/название) либо
 * вставляются только при отсутствии (проверка существования).
 *
 * Время в «моментах» — ISO-8601 UTC (Москва = UTC+3),
 * время графика — местное 'HH:MM'.
 *
 * Запуск: npm run seed   (сначала — npm run migrate)
 */

const { getDb, closeDb } = require("./connection");
const { insertBookingRow } = require("./bookings");
const { assertDestructiveAllowed } = require("./guards");
const { hashPassword } = require("../auth/password");

const MOSCOW_OFFSET_HOURS = 3;
const DAY_MS = 24 * 60 * 60 * 1000;

// ---------------------------------------------------------------------------
// Данные
// ---------------------------------------------------------------------------

const STUDIO = {
  name: "Lumi Beauty Studio",
  address: "г. Тула, ул. Ленина, 1",
  phone: "+7 487 000-00-00",
  timezone: "Europe/Moscow",
  currency: "RUB",
  openingTime: "10:00",
  closingTime: "20:00",
  slotStepMinutes: 30,
  holdTtlMinutes: 10,
};

// Тестовые учётки. Пароли в открытом виде нужны только для входа в dev —
// в базе лежит исключительно scrypt-хеш. Роли задаём списком: у одного
// пользователя их может быть несколько (например, master + admin).
const USERS = [
  { email: "admin@lumi.studio", roles: ["admin"], password: "Admin123!" },
  { email: "master@lumi.studio", roles: ["master"], password: "Master123!" },
  { email: "client@lumi.studio", roles: ["client"], password: "Client123!" },
];

const SERVICES = [
  { name: "Женская стрижка", description: "Стрижка с укладкой", durationMin: 60, priceMinor: 150000 },
  { name: "Маникюр", description: "Классический маникюр с покрытием", durationMin: 90, priceMinor: 180000 },
  { name: "Уход за лицом", description: "Комплексный уход по типу кожи", durationMin: 90, priceMinor: 250000 },
  { name: "Окрашивание волос", description: "Однотонное окрашивание с уходом", durationMin: 120, priceMinor: 400000 },
  { name: "Вечерняя укладка", description: "Укладка для мероприятия", durationMin: 45, priceMinor: 120000 },
];

const MASTERS = [
  {
    fullName: "Анна",
    title: "Топ-стилист",
    bio: "Стрижки, окрашивание и укладки",
    userEmail: "master@lumi.studio",
    services: ["Женская стрижка", "Окрашивание волос", "Вечерняя укладка"],
  },
  {
    fullName: "Мария",
    title: "Мастер маникюра",
    bio: "Маникюр и уход за лицом",
    userEmail: null, // профиль без учётной записи — так тоже можно
    services: ["Маникюр", "Уход за лицом"],
  },
];

const CLIENTS = [
  { fullName: "Иван Иванов", phone: "+79991234567", email: "ivan@example.com" },
  { fullName: "Пётр Петров", phone: "+79997654321", email: null },
  { fullName: "Клиент Тестовый", phone: "+79990000000", email: "client@lumi.studio" },
];

// Записи на ближайшие рабочие дни (dayIndex — индекс в списке upcomingWorkingDays)
const BOOKINGS = [
  { clientPhone: "+79991234567", master: "Анна", service: "Женская стрижка", dayIndex: 0, time: "14:00", status: "confirmed", comment: "Первый визит" },
  { clientPhone: "+79997654321", master: "Мария", service: "Маникюр", dayIndex: 1, time: "10:00", status: "pending", comment: null },
  { clientPhone: "+79990000000", master: "Анна", service: "Окрашивание волос", dayIndex: 2, time: "12:00", status: "confirmed", comment: "Подобрать оттенок" },
];

// ---------------------------------------------------------------------------
// Работа с датами (Москва = UTC+3, без перехода на летнее время)
// ---------------------------------------------------------------------------

/** Текущий момент, выраженный в «настенных» координатах Москвы (UTC-поля). */
function moscowWallNow() {
  return Date.now() + MOSCOW_OFFSET_HOURS * 60 * 60 * 1000;
}

/** День недели по ISO-8601: 1=Пн … 7=Вс. */
function isoWeekday(ms) {
  const weekday = new Date(ms).getUTCDay();
  return weekday === 0 ? 7 : weekday;
}

/** Ближайшие рабочие дни (Пн–Сб) как моменты в координатах Москвы. */
function upcomingWorkingDays(count) {
  const base = moscowWallNow();
  const days = [];
  for (let i = 1; days.length < count && i <= 21; i += 1) {
    const ms = base + i * DAY_MS;
    const weekday = isoWeekday(ms);
    if (weekday >= 1 && weekday <= 6) days.push(ms);
  }
  return days;
}

/** Собирает ISO-8601 UTC из даты (в координатах Москвы) и местного времени 'HH:MM'. */
function toIsoUtc(moscowWallMs, time) {
  const date = new Date(moscowWallMs);
  const [hours, minutes] = time.split(":").map(Number);
  const wallUtc = Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate(), hours, minutes);
  return new Date(wallUtc - MOSCOW_OFFSET_HOURS * 60 * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

/** Прибавляет минуты к ISO-8601 строке. */
function addMinutesIso(iso, minutes) {
  return new Date(new Date(iso).getTime() + minutes * 60 * 1000)
    .toISOString()
    .replace(/\.\d{3}Z$/, "Z");
}

// ---------------------------------------------------------------------------
// Заполнение
// ---------------------------------------------------------------------------

function seed() {
  assertDestructiveAllowed("seed");

  const db = getDb();
  let createdBookings = 0;

  db.exec("BEGIN");
  try {
    // --- Студия (одна запись; уникального ключа нет — ищем по названию) ---
    const studio = db.prepare("SELECT id FROM studios WHERE name = ?").get(STUDIO.name);
    if (studio) {
      db.prepare(
        "UPDATE studios SET address = ?, phone = ?, timezone = ?, currency = ?," +
          " opening_time = ?, closing_time = ?, slot_step_minutes = ?, hold_ttl_minutes = ?," +
          " updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
      ).run(STUDIO.address, STUDIO.phone, STUDIO.timezone, STUDIO.currency, STUDIO.openingTime, STUDIO.closingTime, STUDIO.slotStepMinutes, STUDIO.holdTtlMinutes, studio.id);
    } else {
      db.prepare(
        "INSERT INTO studios (name, address, phone, timezone, currency, opening_time, closing_time, slot_step_minutes, hold_ttl_minutes)" +
          " VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)"
      ).run(STUDIO.name, STUDIO.address, STUDIO.phone, STUDIO.timezone, STUDIO.currency, STUDIO.openingTime, STUDIO.closingTime, STUDIO.slotStepMinutes, STUDIO.holdTtlMinutes);
    }

    // --- Пользователи (upsert по уникальному email) + роли списком ---
    // Роль хранится не в users, а в отдельной таблице user_roles; перед
    // вставкой чистим старые роли пользователя, иначе повторный запуск
    // оставит устаревшие.
    const upsertUser = db.prepare(
      "INSERT INTO users (email, password_hash, is_active) VALUES (?, ?, 1)" +
        " ON CONFLICT(email) DO UPDATE SET password_hash = excluded.password_hash," +
        " is_active = 1, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
    );
    const clearRoles = db.prepare("DELETE FROM user_roles WHERE user_id = ?");
    const addRole = db.prepare("INSERT OR IGNORE INTO user_roles (user_id, role) VALUES (?, ?)");
    const userIdByEmail = new Map();
    for (const user of USERS) {
      upsertUser.run(user.email, hashPassword(user.password));
      const id = db.prepare("SELECT id FROM users WHERE email = ?").get(user.email).id;
      userIdByEmail.set(user.email, id);
      clearRoles.run(id);
      for (const role of user.roles) addRole.run(id, role);
    }

    // --- Мастера (уникального ключа по имени нет — ищем по full_name) ---
    const masterIdByName = new Map();
    for (const master of MASTERS) {
      const userId = master.userEmail ? userIdByEmail.get(master.userEmail) : null;
      const existing = db.prepare("SELECT id FROM masters WHERE full_name = ?").get(master.fullName);
      if (existing) {
        db.prepare(
          "UPDATE masters SET user_id = ?, title = ?, bio = ?, is_active = 1," +
            " updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now') WHERE id = ?"
        ).run(userId, master.title, master.bio, existing.id);
        masterIdByName.set(master.fullName, existing.id);
      } else {
        const info = db.prepare(
          "INSERT INTO masters (user_id, full_name, title, bio, is_active) VALUES (?, ?, ?, ?, 1)"
        ).run(userId, master.fullName, master.title, master.bio);
        masterIdByName.set(master.fullName, Number(info.lastInsertRowid));
      }
    }

    // --- Услуги (upsert по уникальному названию) ---
    const upsertService = db.prepare(
      "INSERT INTO services (name, description, duration_min, price_minor, currency, is_active)" +
        " VALUES (?, ?, ?, ?, 'RUB', 1)" +
        " ON CONFLICT(name) DO UPDATE SET description = excluded.description," +
        " duration_min = excluded.duration_min, price_minor = excluded.price_minor," +
        " currency = 'RUB', is_active = 1," +
        " updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
    );
    const serviceByName = new Map();
    for (const service of SERVICES) {
      upsertService.run(service.name, service.description, service.durationMin, service.priceMinor);
      const row = db.prepare("SELECT id FROM services WHERE name = ?").get(service.name);
      serviceByName.set(service.name, { id: row.id, ...service });
    }

    // --- Специализации мастеров (повторная вставка невозможна: составной PK) ---
    const linkMasterService = db.prepare(
      "INSERT OR IGNORE INTO master_services (master_id, service_id) VALUES (?, ?)"
    );
    for (const master of MASTERS) {
      for (const serviceName of master.services) {
        linkMasterService.run(masterIdByName.get(master.fullName), serviceByName.get(serviceName).id);
      }
    }

    // --- Недельный график: Пн–Сб, 10:00–20:00 (уникального ключа нет) ---
    // Перезаписываем график мастеров целиком — так повторный запуск не плодит строки.
    const deleteSchedules = db.prepare("DELETE FROM master_schedules WHERE master_id = ?");
    const insertSchedule = db.prepare(
      "INSERT INTO master_schedules (master_id, weekday, start_time, end_time) VALUES (?, ?, ?, ?)"
    );
    for (const master of MASTERS) {
      const masterId = masterIdByName.get(master.fullName);
      deleteSchedules.run(masterId);
      for (let weekday = 1; weekday <= 6; weekday += 1) {
        insertSchedule.run(masterId, weekday, "10:00", "20:00");
      }
    }

    // --- Ближайшие рабочие дни нужны и для блокировки, и для записей ---
    const workingDays = upcomingWorkingDays(3);

    // --- Разовая блокировка: обед Анны в первый рабочий день, 13:00–14:00 ---
    const annaId = masterIdByName.get("Анна");
    const lunchStart = toIsoUtc(workingDays[0], "13:00");
    const lunchEnd = toIsoUtc(workingDays[0], "14:00");
    const lunchExists = db
      .prepare("SELECT id FROM time_blocks WHERE master_id = ? AND starts_at = ? AND ends_at = ?")
      .get(annaId, lunchStart, lunchEnd);
    if (!lunchExists) {
      db.prepare(
        "INSERT INTO time_blocks (master_id, starts_at, ends_at, reason) VALUES (?, ?, ?, ?)"
      ).run(annaId, lunchStart, lunchEnd, "обед");
    }

    // --- Клиенты (upsert по уникальному телефону) ---
    const upsertClient = db.prepare(
      "INSERT INTO clients (full_name, phone, email) VALUES (?, ?, ?)" +
        " ON CONFLICT(phone) DO UPDATE SET full_name = excluded.full_name," +
        " email = excluded.email," +
        " updated_at = strftime('%Y-%m-%dT%H:%M:%SZ', 'now')"
    );
    const clientIdByPhone = new Map();
    for (const client of CLIENTS) {
      upsertClient.run(client.fullName, client.phone, client.email);
      const row = db.prepare("SELECT id FROM clients WHERE phone = ?").get(client.phone);
      clientIdByPhone.set(client.phone, row.id);
    }

    // --- Записи (проверяем существование по мастеру и времени старта) ---
    const findBooking = db.prepare("SELECT id FROM bookings WHERE master_id = ? AND starts_at = ?");
    for (const booking of BOOKINGS) {
      const masterId = masterIdByName.get(booking.master);
      const service = serviceByName.get(booking.service);
      const startsAt = toIsoUtc(workingDays[booking.dayIndex], booking.time);
      if (findBooking.get(masterId, startsAt)) continue;

      insertBookingRow(db, {
        clientId: clientIdByPhone.get(booking.clientPhone),
        masterId,
        serviceId: service.id,
        startsAt,
        endsAt: addMinutesIso(startsAt, service.durationMin),
        status: booking.status,
        durationMin: service.durationMin,
        priceMinor: service.priceMinor,
        currency: "RUB",
        comment: booking.comment,
      });
      createdBookings += 1;
    }

    db.exec("COMMIT");
  } catch (error) {
    db.exec("ROLLBACK");
    throw error;
  }

  // --- Итог ---
  const counts = db
    .prepare(
      "SELECT (SELECT COUNT(*) FROM users) AS users," +
        " (SELECT COUNT(*) FROM masters) AS masters," +
        " (SELECT COUNT(*) FROM services) AS services," +
        " (SELECT COUNT(*) FROM master_schedules) AS schedules," +
        " (SELECT COUNT(*) FROM bookings) AS bookings"
    )
    .get();

  console.log("Тестовые данные добавлены/обновлены.");
  console.log("  пользователей: " + counts.users + ", мастеров: " + counts.masters + ", услуг: " + counts.services);
  console.log("  слотов графика: " + counts.schedules + ", записей: " + counts.bookings + " (+" + createdBookings + " новых)");
  console.log("Входы (dev): admin@lumi.studio / Admin123! | master@lumi.studio / Master123! | client@lumi.studio / Client123!");
}

if (require.main === module) {
  try {
    seed();
  } finally {
    closeDb();
  }
}

module.exports = { seed };
