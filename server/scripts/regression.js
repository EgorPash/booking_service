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
 *      администратору 200; роль — список, проверяется вхождение.
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
}

main();
