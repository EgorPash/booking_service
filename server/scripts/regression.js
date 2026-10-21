"use strict";

/**
 * Регрессионные проверки профиля клиента и регистрации.
 *
 * Скрипт самодостаточный: поднимает backend на отдельном порту с отдельной
 * базой (файл после прогона удаляется), накатывает миграции, сидит тестовые
 * данные и проверяет сценарии по HTTP. Рабочая база разработки не страдает.
 *
 * Проверяемое поведение:
 *   1) регистрация заводит профиль клиента;
 *   2) регистрация на занятый телефон отклоняется и чужой профиль цел;
 *   3) клиент без профиля (аккаунт, созданный до появления профилей)
 *      оформляет запись и получает профиль;
 *   4) клиент без профиля НЕ переписывает чужой профиль (409);
 *   5) клиент без профиля забирает «ничейный» профиль, созданный мастером;
 *   6) регистрация забирает «ничейный» профиль, созданный мастером;
 *   7) клиент со своим профилом не подменяет его чужими данными;
 *   8) мастер уточняет имя профиля, но не переносит email;
 *   9) доступ к админ-разделу: гостю 401, клиенту и мастеру 403,
 *      администратору 200; роль — список, проверяется вхождение;
 *  10) формы админ-раздела проверяет сервер: пустое название услуги,
 *      нулевая длительность и нулевая цена отклоняются;
 *  11) умное удаление: услуга и мастер без записей удаляются,
 *      с записями — отключаются; запись хранит снимок услуги
 *      (цена и длительность) и не меняется после правки справочника;
 *  12) отметки мастера: услуги назначаются и снимаются, мастер без
 *      отметок не попадает в каталог по этой услуге.
 *
 * Запуск: npm test
 */

const { spawn } = require("node:child_process");
const fs = require("node:fs");
const path = require("node:path");

const ROOT = path.resolve(__dirname, "..");
const DB_PATH = path.join(ROOT, "data", "regression.sqlite");
const PORT = Number(process.env.REGRESSION_PORT || 3199);
const BASE = "http://127.0.0.1:" + PORT;
const PASSWORD = "Passw0rd!";

// Конфигурация читается при первом require — путь к базе задаём заранее.
process.env.DATABASE_PATH = DB_PATH;

const { getDb, closeDb } = require("../src/db/connection");
const { hashPassword } = require("../src/auth/password");

const TAG = Date.now().toString(36);
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));

let passed = 0;
let failed = 0;

function check(name, condition, detail) {
  if (condition) {
    passed += 1;
    console.log("  ok   " + name);
    return;
  }
  failed += 1;
  console.log("  FAIL " + name + (detail === undefined ? "" : " → " + detail));
}

function section(title) {
  console.log("\n" + title);
}

function runNode(args, env) {
  return new Promise((resolve, reject) => {
    const child = spawn(process.execPath, args, {
      cwd: ROOT,
      env: Object.assign({}, process.env, env || {}),
      stdio: ["ignore", "pipe", "pipe"],
    });
    let output = "";
    child.stdout.on("data", (chunk) => {
      output += chunk;
    });
    child.stderr.on("data", (chunk) => {
      output += chunk;
    });
    child.on("error", reject);
    child.on("close", (code) => {
      if (code === 0) resolve(output);
      else reject(new Error(path.basename(args[0]) + " завершился с кодом " + code + "\n" + output));
    });
  });
}

async function api(method, apiPath, body, cookie) {
  const headers = { Accept: "application/json" };
  if (body !== undefined) headers["Content-Type"] = "application/json";
  if (cookie) headers["Cookie"] = cookie;
  const res = await fetch(BASE + apiPath, {
    method,
    headers,
    body: body === undefined ? undefined : JSON.stringify(body),
  });
  const setCookie =
    typeof res.headers.getSetCookie === "function" ? res.headers.getSetCookie() : [];
  const text = await res.text();
  let data = null;
  try {
    data = text ? JSON.parse(text) : null;
  } catch (error) {
    data = text;
  }
  return {
    status: res.status,
    data,
    cookie: setCookie.map((value) => value.split(";")[0]).join("; "),
  };
}

async function waitForApi(timeoutMs) {
  const deadline = Date.now() + (timeoutMs || 20000);
  while (Date.now() < deadline) {
    try {
      const res = await fetch(BASE + "/api/studio");
      if (res.ok) return;
    } catch (error) {
      // сервер ещё не поднялся — ждём
    }
    await sleep(200);
  }
  throw new Error("API не поднялся на " + BASE);
}

/** Аккаунт клиента без профиля — как те, что появились до правок. */
function createLegacyClient(email) {
  const db = getDb();
  db.prepare(
    "INSERT INTO users (email, password_hash, is_active) VALUES (?, ?, 1)"
  ).run(email, hashPassword(PASSWORD));
  const user = db.prepare("SELECT id FROM users WHERE email = ?").get(email);
  db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'client')").run(user.id);
  return user.id;
}

/** Свободный слот мастера: дату подбираем по недельному графику. */
async function findFreeSlot(master, serviceId, used) {
  for (let offset = 28; offset < 45; offset += 1) {
    const date = new Date(Date.now() + offset * 86400000);
    const weekday = date.getUTCDay();
    if (weekday === 0 || weekday === 7) continue;
    const dateStr = date.toISOString().slice(0, 10);
    const res = await api(
      "GET",
      "/api/masters/" + master.id + "/slots?date=" + dateStr + "&serviceIds=" + serviceId
    );
    const slots = (res.data && res.data.slots) || [];
    for (const slot of slots) {
      if (slot.available === false) continue;
      if (used.has(slot.startsAt)) continue;
      used.add(slot.startsAt);
      return slot.startsAt;
    }
  }
  throw new Error("Не нашлось свободного слота для мастера " + master.id);
}

async function main() {
  const dbEnv = { DATABASE_PATH: DB_PATH };

  for (const file of [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"]) {
    fs.rmSync(file, { force: true });
  }

  await runNode([path.join(ROOT, "src/db/migrate.js")], dbEnv);
  await runNode([path.join(ROOT, "src/db/seed.js")], dbEnv);

  const server = spawn(process.execPath, [path.join(ROOT, "src/api/server.js")], {
    cwd: ROOT,
    env: Object.assign({}, process.env, dbEnv, {
      PORT: String(PORT),
      RATE_LIMIT_MAX: "1000",
    }),
    stdio: ["ignore", "pipe", "pipe"],
  });
  let serverLog = "";
  server.stdout.on("data", (chunk) => {
    serverLog += chunk;
  });
  server.stderr.on("data", (chunk) => {
    serverLog += chunk;
  });

  let exitCode = 1;
  try {
    await waitForApi();
    await runChecks();
    exitCode = failed === 0 ? 0 : 1;
  } catch (error) {
    console.error("\nОшибка прогона: " + error.message);
    if (serverLog) console.error(serverLog);
    exitCode = 1;
  } finally {
    server.kill();
    // Ждём, пока сервер отпустит файл базы — иначе его не удалить.
    await new Promise((resolve) => {
      if (server.exitCode !== null || server.signalCode !== null) {
        resolve();
        return;
      }
      server.on("exit", resolve);
      setTimeout(resolve, 3000);
    });
    closeDb();
    for (const file of [DB_PATH, DB_PATH + "-wal", DB_PATH + "-shm"]) {
      try {
        fs.rmSync(file, { force: true });
      } catch (error) {
        console.warn("Не удалось удалить " + file + ": " + error.message);
      }
    }
  }

  console.log("\nИтог: " + passed + " ok, " + failed + " fail");
  process.exit(exitCode);
}

async function runChecks() {
  const db = getDb();
  const row = db.prepare("PRAGMA database_list").all();
  if (!row.length || path.resolve(row[0].file) !== path.resolve(DB_PATH)) {
    throw new Error("Открыта не тестовая база: " + JSON.stringify(row));
  }

  const used = new Set();

  // --- Мастер и его свободный слот -----------------------------------------
  let res = await api("POST", "/api/auth/login", {
    email: "master@lumi.studio",
    password: "Master123!",
  });
  check("мастер вошёл", res.status === 200, "статус " + res.status);
  const masterCookie = res.cookie;

  const masters = (await api("GET", "/api/masters")).data.masters;
  const master = masters[0];
  const serviceId = master.serviceIds[0];

  // --- 1. Регистрация заводит профиль клиента ------------------------------
  section("1. Регистрация клиента");
  const emailA = "reg-a-" + TAG + "@example.com";
  const phoneA = "+79001110001";
  res = await api("POST", "/api/auth/register", {
    email: emailA,
    password: PASSWORD,
    fullName: "Анна Клиентова",
    phone: phoneA,
  });
  check("регистрация вернула 201", res.status === 201, "статус " + res.status);
  check("в ответе есть профиль клиента", Boolean(res.data && res.data.client), JSON.stringify(res.data));
  check("имя профиля совпало", res.data && res.data.client.fullName === "Анна Клиентова");
  check("телефон профиля совпал", res.data && res.data.client.phone === phoneA);
  const clientAId = res.data && res.data.client ? res.data.client.id : null;

  res = await api("GET", "/api/auth/me", undefined, res.cookie);
  check("/api/auth/me вернул clientId профиля", res.data && res.data.clientId === clientAId);
  check("/api/auth/me вернул профиль клиента", res.data && res.data.client && res.data.client.fullName === "Анна Клиентова");

  // --- 2. Регистрация на занятый телефон ------------------------------------
  section("2. Регистрация на занятый телефон");
  const emailB = "reg-b-" + TAG + "@example.com";
  res = await api("POST", "/api/auth/register", {
    email: emailB,
    password: PASSWORD,
    fullName: "Другой Человек",
    phone: phoneA,
  });
  check("регистрация на занятый телефон отклонена", res.status === 409, "статус " + res.status);
  let clientRow = db.prepare("SELECT full_name, phone, email FROM clients WHERE phone = ?").get(phoneA);
  check("имя чужого профиля не изменилось", clientRow.full_name === "Анна Клиентова", clientRow.full_name);
  check("email чужого профиля не изменился", clientRow.email === emailA, String(clientRow.email));
  check("аккаунт на чужой телефон не создан", !db.prepare("SELECT id FROM users WHERE email = ?").get(emailB));

  // --- 3. Клиент без профиля оформляет запись --------------------------------
  section("3. Клиент без профиля оформляет запись");
  const legacyEmail = "legacy-a-" + TAG + "@example.com";
  createLegacyClient(legacyEmail);
  res = await api("POST", "/api/auth/login", { email: legacyEmail, password: PASSWORD });
  check("клиент без профиля вошёл", res.status === 200, "статус " + res.status);
  const legacyCookie = res.cookie;

  res = await api("GET", "/api/auth/me", undefined, legacyCookie);
  check("у клиента без профиля clientId пустой", res.data && res.data.clientId === null, JSON.stringify(res.data));
  check("у клиента без профиля client пустой", res.data && res.data.client === null, JSON.stringify(res.data));

  const legacyPhone = "+79001110002";
  const legacyName = "Клиент Без Профиля";
  let startsAt = await findFreeSlot(master, serviceId, used);
  res = await api(
    "POST",
    "/api/bookings",
    {
      masterId: master.id,
      serviceIds: [serviceId],
      startsAt: startsAt,
      fullName: legacyName,
      phone: legacyPhone,
    },
    legacyCookie
  );
  check("запись клиента без профиля создана", res.status === 201, "статус " + res.status + " " + JSON.stringify(res.data));
  clientRow = db.prepare("SELECT full_name, phone, email FROM clients WHERE phone = ?").get(legacyPhone);
  check("профиль клиента создан", Boolean(clientRow));
  check("имя нового профиля верное", clientRow && clientRow.full_name === legacyName);
  check("email нового профиля — аккаунт клиента", clientRow && clientRow.email === legacyEmail, String(clientRow && clientRow.email));

  // --- 4. Чужой профиль не переписывается -----------------------------------
  section("4. Клиент без профиля не переписывает чужой профиль");
  const legacyEmail2 = "legacy-b-" + TAG + "@example.com";
  createLegacyClient(legacyEmail2);
  res = await api("POST", "/api/auth/login", { email: legacyEmail2, password: PASSWORD });
  const legacyCookie2 = res.cookie;

  startsAt = await findFreeSlot(master, serviceId, used);
  res = await api(
    "POST",
    "/api/bookings",
    {
      masterId: master.id,
      serviceIds: [serviceId],
      startsAt: startsAt,
      fullName: "Кто-то Другой",
      phone: phoneA,
    },
    legacyCookie2
  );
  check("запись на чужой телефон отклонена", res.status === 409, "статус " + res.status);
  clientRow = db.prepare("SELECT full_name, phone, email FROM clients WHERE phone = ?").get(phoneA);
  check("имя чужого профиля не изменилось", clientRow.full_name === "Анна Клиентова", clientRow.full_name);
  check("email чужого профиля не изменился", clientRow.email === emailA, String(clientRow.email));

  // --- 5. Мастер создаёт запись -> профиль клиента «ничейный» --------------
  section("5. Мастер создаёт запись для клиента");
  const orphanPhone = "+79001110003";
  startsAt = await findFreeSlot(master, serviceId, used);
  res = await api(
    "POST",
    "/api/bookings",
    {
      masterId: master.id,
      serviceIds: [serviceId],
      startsAt: startsAt,
      fullName: "Гость С Телефона",
      phone: orphanPhone,
    },
    masterCookie
  );
  check("мастер создал запись", res.status === 201, "статус " + res.status);
  const orphan = db.prepare("SELECT id, full_name, email FROM clients WHERE phone = ?").get(orphanPhone);
  check("профиль клиента создан мастером", Boolean(orphan));
  check("профиль мастера — без email", orphan && orphan.email === null, String(orphan && orphan.email));

  // --- 6. Клиент без профиля забирает «ничейный» профиль ---------------------
  section("6. Клиент без профиля забирает «ничейный» профиль");
  const legacyEmail3 = "legacy-c-" + TAG + "@example.com";
  createLegacyClient(legacyEmail3);
  res = await api("POST", "/api/auth/login", { email: legacyEmail3, password: PASSWORD });
  const legacyCookie3 = res.cookie;

  startsAt = await findFreeSlot(master, serviceId, used);
  res = await api(
    "POST",
    "/api/bookings",
    {
      masterId: master.id,
      serviceIds: [serviceId],
      startsAt: startsAt,
      fullName: "Гость С Телефона",
      phone: orphanPhone,
    },
    legacyCookie3
  );
  check("запись клиента создана", res.status === 201, "статус " + res.status + " " + JSON.stringify(res.data));
  const claimed = db.prepare("SELECT full_name, email FROM clients WHERE phone = ?").get(orphanPhone);
  check("профиль остался тем же", claimed && orphan && claimed.full_name === orphan.full_name);
  check("email профиля передан клиенту", claimed && claimed.email === legacyEmail3, String(claimed && claimed.email));

  // --- 7. Регистрация забирает «ничейный» профиль ----------------------------
  section("7. Регистрация забирает «ничейный» профиль");
  const orphanPhone2 = "+79001110004";
  startsAt = await findFreeSlot(master, serviceId, used);
  res = await api(
    "POST",
    "/api/bookings",
    {
      masterId: master.id,
      serviceIds: [serviceId],
      startsAt: startsAt,
      fullName: "Гость Без Аккаунта",
      phone: orphanPhone2,
    },
    masterCookie
  );
  check("мастер создал запись", res.status === 201, "статус " + res.status);
  const orphan2 = db.prepare("SELECT id FROM clients WHERE phone = ?").get(orphanPhone2);
  check("профиль создан мастером", Boolean(orphan2));

  const emailC = "reg-c-" + TAG + "@example.com";
  res = await api("POST", "/api/auth/register", {
    email: emailC,
    password: PASSWORD,
    fullName: "Гость Без Аккаунта",
    phone: orphanPhone2,
  });
  check("регистрация на «ничейный» телефон вернула 201", res.status === 201, "статус " + res.status);
  check("профиль не создан заново", res.data && res.data.client && res.data.client.id === orphan2.id, JSON.stringify(res.data && res.data.client));
  const orphan2After = db.prepare("SELECT email FROM clients WHERE phone = ?").get(orphanPhone2);
  check("email профиля передан аккаунту", orphan2After && orphan2After.email === emailC, String(orphan2After && orphan2After.email));

  res = await api("GET", "/api/bookings/my", undefined, res.cookie);
  const ownBookings = (res.data && res.data.bookings) || [];
  check("клиент видит запись, созданную мастером", ownBookings.length > 0, "записей: " + ownBookings.length);

  // --- 8. Клиент со своим профилем не подменяет его чужими данными ----------
  section("8. Клиент со своим профилем");
  res = await api("POST", "/api/auth/login", { email: emailA, password: PASSWORD });
  const cookieA = res.cookie;
  startsAt = await findFreeSlot(master, serviceId, used);
  res = await api(
    "POST",
    "/api/bookings",
    {
      masterId: master.id,
      serviceIds: [serviceId],
      startsAt: startsAt,
      fullName: "Подмена",
      phone: "+79009998888",
    },
    cookieA
  );
  check("запись создана", res.status === 201, "статус " + res.status);
  clientRow = db.prepare("SELECT full_name, phone, email FROM clients WHERE phone = ?").get(phoneA);
  check("свой профиль не переписан", clientRow.full_name === "Анна Клиентова", clientRow.full_name);
  check("чужой телефон не завёл профиль", !db.prepare("SELECT id FROM clients WHERE phone = ?").get("+79009998888"));

  // --- 9. Мастер уточняет имя профиля, но не переносит email ----------------
  section("9. Мастер уточняет имя существующего клиента");
  startsAt = await findFreeSlot(master, serviceId, used);
  res = await api(
    "POST",
    "/api/bookings",
    {
      masterId: master.id,
      serviceIds: [serviceId],
      startsAt: startsAt,
      fullName: "Анна Обновлённая",
      phone: phoneA,
    },
    masterCookie
  );
  check("запись создана", res.status === 201, "статус " + res.status);
  clientRow = db.prepare("SELECT full_name, email FROM clients WHERE phone = ?").get(phoneA);
  check("имя профиля уточнено мастером", clientRow.full_name === "Анна Обновлённая", clientRow.full_name);
  check("email профиля не перенесён на мастера", clientRow.email === emailA, String(clientRow.email));

  // --- 10. Доступ к админ-разделу -------------------------------------------
  section("10. Проверка доступа к админ-разделу");
  res = await api("GET", "/api/admin/access");
  check("гость получил 401", res.status === 401, "статус " + res.status);

  res = await api("POST", "/api/auth/login", {
    email: "client@lumi.studio",
    password: "Client123!",
  });
  const clientCookie = res.cookie;
  res = await api("GET", "/api/admin/access", undefined, clientCookie);
  check("клиент получил 403", res.status === 403, "статус " + res.status);
  check(
    "клиенту сказано, что раздел только для администраторов",
    res.data && res.data.message === "Этот раздел только для администраторов",
    JSON.stringify(res.data)
  );
  res = await api("GET", "/api/admin/bookings", undefined, clientCookie);
  check("админ-эндпоинт клиенту недоступен", res.status === 403, "статус " + res.status);

  res = await api("POST", "/api/auth/login", {
    email: "master@lumi.studio",
    password: "Master123!",
  });
  res = await api("GET", "/api/admin/access", undefined, res.cookie);
  check("мастеру тоже 403", res.status === 403, "статус " + res.status);

  res = await api("POST", "/api/auth/login", {
    email: "admin@lumi.studio",
    password: "Admin123!",
  });
  const adminCookie = res.cookie;
  res = await api("GET", "/api/admin/access", undefined, adminCookie);
  check("администратору доступ выдан", res.status === 200, "статус " + res.status);
  check(
    "в ответе список ролей с admin",
    res.data &&
      res.data.user &&
      Array.isArray(res.data.user.roles) &&
      res.data.user.roles.indexOf("admin") !== -1,
    JSON.stringify(res.data)
  );

  // Роль — это список: вторая роль не должна ломать проверку вхождения.
  db.prepare(
    "INSERT OR IGNORE INTO user_roles (user_id, role) SELECT id, 'manager' FROM users WHERE email = ?"
  ).run("admin@lumi.studio");
  res = await api("GET", "/api/admin/access", undefined, adminCookie);
  check("доступ есть и при нескольких ролях", res.status === 200, "статус " + res.status);
  check(
    "роль admin по-прежнему в списке",
    res.data && res.data.user && res.data.user.roles.indexOf("admin") !== -1,
    JSON.stringify(res.data)
  );

  // --- 11. Услуги и мастера: проверки форм, умное удаление, снимок услуги ----
  section("11. Админ-раздел: услуги и мастера");

  // 11.1 Форма услуги: проверяет сервер, а не только браузер
  res = await api(
    "POST",
    "/api/admin/services",
    { name: "   ", durationMin: 30, priceMinor: 100000 },
    adminCookie
  );
  check("пустое название услуги отклонено", res.status === 400, "статус " + res.status);
  check(
    "сообщение о пустом названии",
    res.data && res.data.message === "Название услуги не может быть пустым",
    JSON.stringify(res.data)
  );

  res = await api(
    "POST",
    "/api/admin/services",
    { name: "Услуга " + TAG, durationMin: 0, priceMinor: 100000 },
    adminCookie
  );
  check("нулевая длительность отклонена", res.status === 400, "статус " + res.status);
  check(
    "сообщение о длительности",
    res.data && res.data.message === "Длительность услуги должна быть больше нуля",
    JSON.stringify(res.data)
  );

  res = await api(
    "POST",
    "/api/admin/services",
    { name: "Услуга " + TAG, durationMin: 30, priceMinor: 0 },
    adminCookie
  );
  check("нулевая цена отклонена", res.status === 400, "статус " + res.status);
  check(
    "сообщение о цене",
    res.data && res.data.message === "Цена услуги должна быть больше нуля",
    JSON.stringify(res.data)
  );

  res = await api("POST", "/api/admin/services", { name: "Услуга " + TAG, durationMin: 30 }, adminCookie);
  check("услуга без цены отклонена", res.status === 400, "статус " + res.status);

  res = await api(
    "PATCH",
    "/api/admin/services/" + serviceId,
    { name: "" },
    adminCookie
  );
  check("правка услуги с пустым названием отклонена", res.status === 400, "статус " + res.status);

  // 11.2 Услуга без записей удаляется целиком
  const newServiceName = "Тестовая услуга " + TAG;
  res = await api(
    "POST",
    "/api/admin/services",
    { name: newServiceName, durationMin: 45, priceMinor: 123400, description: "Проверка" },
    adminCookie
  );
  check("услуга создана", res.status === 201, "статус " + res.status + " " + JSON.stringify(res.data));
  const newServiceId = res.data && res.data.service ? res.data.service.id : null;

  res = await api("GET", "/api/admin/services", undefined, adminCookie);
  const newServiceRow = (res.data.services || []).find((item) => item.id === newServiceId);
  check("услуга есть в списке админа", Boolean(newServiceRow));
  check("у новой услуги 0 записей", newServiceRow && newServiceRow.bookingsCount === 0);
  check("у новой услуги 0 мастеров", newServiceRow && newServiceRow.mastersCount === 0);

  res = await api("DELETE", "/api/admin/services/" + newServiceId, undefined, adminCookie);
  check("удаление без записей удаляет услугу", res.status === 200 && res.data.deleted === true, JSON.stringify(res.data));
  check("сервер объяснил, что произошло", res.data && typeof res.data.message === "string" && res.data.message.length > 0);
  check("строки услуги нет в БД", !db.prepare("SELECT id FROM services WHERE id = ?").get(newServiceId));
  res = await api("GET", "/api/services");
  check("услуги нет в клиентском каталоге", !(res.data.services || []).some((item) => item.id === newServiceId));

  // 11.3 Услуга с записями отключается, а не удаляется
  const bookedServiceRow = db.prepare("SELECT service_id FROM bookings GROUP BY service_id LIMIT 1").get();
  const bookedServiceId = bookedServiceRow.service_id;
  res = await api("DELETE", "/api/admin/services/" + bookedServiceId, undefined, adminCookie);
  check("услуга с записями не удалена", res.status === 200 && res.data.deleted === false, JSON.stringify(res.data));
  check("услуга отключена", res.data && res.data.disabled === true);
  check("сервер сообщил число записей", res.data && res.data.bookingsCount > 0, JSON.stringify(res.data));
  const serviceRow = db.prepare("SELECT is_active FROM services WHERE id = ?").get(bookedServiceId);
  check("строка услуги осталась в БД", Boolean(serviceRow));
  check("услуга отключена в БД", serviceRow && serviceRow.is_active === 0);
  res = await api("GET", "/api/services");
  check("отключённой услуги нет в каталоге", !(res.data.services || []).some((item) => item.id === bookedServiceId));

  // 11.4 Снимок услуги в записи не меняется после правки справочника
  const snapshotRow = db
    .prepare("SELECT id, duration_min, price_minor FROM bookings WHERE service_id = ? LIMIT 1")
    .get(bookedServiceId);
  res = await api("GET", "/api/bookings/" + snapshotRow.id, undefined, adminCookie);
  check("запись по отключённой услуге читается", res.status === 200, "статус " + res.status);
  check(
    "в записи снимок длительности услуги",
    res.data &&
      res.data.booking &&
      res.data.booking.service &&
      res.data.booking.service.durationMin === snapshotRow.duration_min,
    JSON.stringify(res.data && res.data.booking)
  );
  check(
    "в записи снимок цены",
    res.data && res.data.booking && res.data.booking.priceMinor === snapshotRow.price_minor,
    String(res.data && res.data.booking && res.data.booking.priceMinor)
  );

  res = await api(
    "PATCH",
    "/api/admin/services/" + bookedServiceId,
    { durationMin: snapshotRow.duration_min + 15, priceMinor: snapshotRow.price_minor + 1000 },
    adminCookie
  );
  check("справочник услуги обновлён", res.status === 200, "статус " + res.status);
  res = await api("GET", "/api/bookings/" + snapshotRow.id, undefined, adminCookie);
  check(
    "длительность в записи не изменилась",
    res.data &&
      res.data.booking &&
      res.data.booking.service &&
      res.data.booking.service.durationMin === snapshotRow.duration_min,
    String(res.data && res.data.booking && res.data.booking.service && res.data.booking.service.durationMin)
  );
  check(
    "цена в записи не изменилась",
    res.data && res.data.booking && res.data.booking.priceMinor === snapshotRow.price_minor,
    String(res.data && res.data.booking && res.data.booking.priceMinor)
  );

  // 11.5 Запись по отключённой услуге не создаётся
  const providerRow = db
    .prepare("SELECT master_id FROM master_services WHERE service_id = ? LIMIT 1")
    .get(bookedServiceId);
  if (providerRow) {
    res = await api(
      "POST",
      "/api/bookings",
      {
        masterId: providerRow.master_id,
        serviceIds: [bookedServiceId],
        startsAt: "2030-01-07T09:00:00Z",
        fullName: "Проверка Отключения",
        phone: "+79005550001",
      },
      legacyCookie
    );
    check("запись по отключённой услуге отклонена", res.status === 400, "статус " + res.status);
    check(
      "сказано, что услуга недоступна",
      res.data && typeof res.data.message === "string" && res.data.message.indexOf("недоступна") !== -1,
      JSON.stringify(res.data)
    );
  }

  // 11.6 Мастера: профиль, отметки услуг, график
  res = await api("POST", "/api/admin/masters", { fullName: "  " }, adminCookie);
  check("пустое имя мастера отклонено", res.status === 400, "статус " + res.status);
  check(
    "сообщение об имени мастера",
    res.data && res.data.message === "Имя мастера не может быть пустым",
    JSON.stringify(res.data)
  );

  const masterEmail = "new-master-" + TAG + "@lumi.studio";
  res = await api(
    "POST",
    "/api/admin/masters",
    {
      fullName: "Новый Мастер",
      title: "Стилист",
      userEmail: masterEmail,
      userPassword: "Master123!",
      serviceIds: [serviceId],
    },
    adminCookie
  );
  check("мастер создан", res.status === 201, "статус " + res.status + " " + JSON.stringify(res.data));
  const newMasterId = res.data && res.data.master ? res.data.master.id : null;
  check(
    "у мастера сохранены отметки услуг",
    res.data && res.data.master && res.data.master.serviceIds.length === 1,
    JSON.stringify(res.data && res.data.master)
  );

  res = await api("GET", "/api/masters?serviceId=" + serviceId);
  check(
    "мастер виден в каталоге по своей услуге",
    (res.data.masters || []).some((item) => item.id === newMasterId)
  );

  res = await api(
    "PUT",
    "/api/admin/masters/" + newMasterId + "/services",
    { serviceIds: [] },
    adminCookie
  );
  check(
    "отметки услуг сняты",
    res.status === 200 && Array.isArray(res.data.serviceIds) && res.data.serviceIds.length === 0,
    JSON.stringify(res.data)
  );
  res = await api("GET", "/api/masters?serviceId=" + serviceId);
  check(
    "мастер без отметок не виден в каталоге по услуге",
    !(res.data.masters || []).some((item) => item.id === newMasterId)
  );

  res = await api(
    "PUT",
    "/api/admin/masters/" + newMasterId + "/services",
    { serviceIds: [serviceId] },
    adminCookie
  );
  check("отметка услуги возвращена", res.status === 200 && res.data.serviceIds.length === 1);

  res = await api("GET", "/api/admin/masters/" + newMasterId + "/schedule", undefined, adminCookie);
  check(
    "график мастера читается",
    res.status === 200 && Array.isArray(res.data.schedule),
    JSON.stringify(res.data)
  );
  res = await api(
    "PUT",
    "/api/admin/masters/" + newMasterId + "/schedule",
    { schedule: [{ weekday: 1, startTime: "10:00", endTime: "19:00" }] },
    adminCookie
  );
  check("график сохранён", res.status === 200, "статус " + res.status + " " + JSON.stringify(res.data));
  res = await api("GET", "/api/admin/masters/" + newMasterId + "/schedule", undefined, adminCookie);
  check(
    "график прочитан обратно",
    res.data.schedule.length === 1 &&
      res.data.schedule[0].weekday === 1 &&
      res.data.schedule[0].startTime === "10:00" &&
      res.data.schedule[0].endTime === "19:00",
    JSON.stringify(res.data)
  );
  res = await api(
    "PUT",
    "/api/admin/masters/" + newMasterId + "/schedule",
    { schedule: [{ weekday: 8, startTime: "10:00", endTime: "19:00" }] },
    adminCookie
  );
  check("неверный день недели отклонён", res.status === 400, "статус " + res.status);

  // 11.7 Умное удаление мастера
  res = await api("DELETE", "/api/admin/masters/" + newMasterId, undefined, adminCookie);
  check("мастер без записей удалён", res.status === 200 && res.data.deleted === true, JSON.stringify(res.data));
  check("профиля мастера нет в БД", !db.prepare("SELECT id FROM masters WHERE id = ?").get(newMasterId));
  check("аккаунт мастера удалён вместе с профилем", !db.prepare("SELECT id FROM users WHERE email = ?").get(masterEmail));
  res = await api("GET", "/api/masters");
  check("удалённого мастера нет в каталоге", !(res.data.masters || []).some((item) => item.id === newMasterId));

  const bookedMasterRow = db.prepare("SELECT master_id FROM bookings GROUP BY master_id LIMIT 1").get();
  res = await api("DELETE", "/api/admin/masters/" + bookedMasterRow.master_id, undefined, adminCookie);
  check("мастер с записями не удалён", res.status === 200 && res.data.deleted === false, JSON.stringify(res.data));
  check("мастер отключён", res.data && res.data.disabled === true);
  const masterRow = db.prepare("SELECT is_active FROM masters WHERE id = ?").get(bookedMasterRow.master_id);
  check("мастер остался в БД и отключён", masterRow && masterRow.is_active === 0);
  res = await api("GET", "/api/masters");
  check("отключённый мастер пропал из каталога", !(res.data.masters || []).some((item) => item.id === bookedMasterRow.master_id));
}

main();
