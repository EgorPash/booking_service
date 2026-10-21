"use strict";

const { getDb } = require("../../db/connection");
const { hashPassword, verifyPassword } = require("../../auth/password");
const { HttpError, conflict, forbidden } = require("../http");
const {
  createSession,
  destroySession,
  readToken,
  sessionCookie,
  clearSessionCookie,
  requireAuth,
  hasRole,
  rolesOfUser,
} = require("../session");
const { rateLimit } = require("../rate-limit");
const v = require("../validate");

// Заглушечный хеш для выравнивания времени ответа: если аккаунта с таким email
// нет, всё равно считаем scrypt, чтобы нельзя было узнать существование логина
// по времени ответа (user enumeration через тайминг).
const DUMMY_HASH = hashPassword("timing-equalizer-not-a-real-password");

function publicUser(user) {
  return { id: user.id, email: user.email, roles: user.roles };
}

function links(user) {
  const db = getDb();
  let masterId = null;
  let clientId = null;
  let client = null;
  if (hasRole(user, "master")) {
    const master = db.prepare("SELECT id FROM masters WHERE user_id = ?").get(user.id);
    if (master) masterId = master.id;
  }
  if (hasRole(user, "client")) {
    const row = db
      .prepare("SELECT id, full_name, phone, email FROM clients WHERE email = ?")
      .get(user.email);
    if (row) {
      clientId = row.id;
      client = { id: row.id, fullName: row.full_name, phone: row.phone };
    }
  }
  return { masterId, clientId, client };
}

function register(router) {
  router.post("/api/auth/register", async (ctx) => {
    rateLimit(ctx, "register");

    const body = ctx.body || {};
    const email = v.email(body.email);
    const password = v.password(body.password);
    const fullName = v.string(body.fullName, "fullName", { max: 120 });
    const phone = v.phone(body.phone);

    const db = getDb();
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
      throw conflict("Пользователь с таким email уже зарегистрирован");
    }

    db.exec("BEGIN IMMEDIATE");
    let user;
    let client;
    try {
      // Телефон у клиента уникален, поэтому профиль на этом номере может уже
      // быть. Он бывает двух видов:
      //   • «ничейный» (email IS NULL) — его создаёт мастер, заводя запись для
      //     клиента. Такой профиль новый аккаунт забирает: человек с этим
      //     телефоном и есть тот самый клиент;
      //   • привязанный к другому email — чужой. Тогда регистрацию отклоняем,
      //     иначе на чужой телефон можно было бы завести второй аккаунт.
      // Заодно НЕ переносим email в чужой профиль: это дало бы доступ к его
      // записям.
      const existing = db
        .prepare("SELECT id, full_name, phone, email FROM clients WHERE phone = ?")
        .get(phone);
      if (existing) {
        if (existing.email) {
          throw conflict(
            "Этот телефон уже привязан к другому аккаунту — войдите в него или укажите другой номер"
          );
        }
        db.prepare(
          "UPDATE clients SET full_name = ?, email = ?, " +
            "updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now') WHERE id = ?"
        ).run(fullName, email, existing.id);
        client = db.prepare("SELECT id, full_name, phone FROM clients WHERE id = ?").get(existing.id);
      } else {
        db.prepare("INSERT INTO clients (full_name, phone, email) VALUES (?, ?, ?)").run(
          fullName,
          phone,
          email
        );
        client = db.prepare("SELECT id, full_name, phone FROM clients WHERE phone = ?").get(phone);
      }

      const info = db
        .prepare("INSERT INTO users (email, password_hash, is_active) VALUES (?, ?, 1)")
        .run(email, hashPassword(password));
      const userId = Number(info.lastInsertRowid);
      // Новый аккаунт через публичную регистрацию получает единственную роль — client.
      db.prepare("INSERT INTO user_roles (user_id, role) VALUES (?, 'client')").run(userId);

      user = { id: userId, email, roles: ["client"] };
      db.exec("COMMIT");
    } catch (error) {
      db.exec("ROLLBACK");
      // Ожидаемая гонка — тот же email вставили параллельно. Остальные ошибки
      // (сбой БД и т. п.) не маскируем под «email занят», а пробрасываем дальше.
      if (String((error && error.message) || "").includes("UNIQUE")) {
        throw conflict("Пользователь с таким email уже зарегистрирован");
      }
      throw error;
    }

    ctx.res.setHeader("Set-Cookie", sessionCookie(createSession(user.id)));
    ctx.status = 201;
    return {
      user: publicUser(user),
      clientId: client.id,
      client: { id: client.id, fullName: client.full_name, phone: client.phone },
    };
  });

  router.post("/api/auth/login", async (ctx) => {
    rateLimit(ctx, "login");

    const body = ctx.body || {};
    const email = v.email(body.email);
    const password = v.string(body.password, "password", { min: 1, max: 200, trim: false });

    const db = getDb();
    const row = db
      .prepare("SELECT id, email, password_hash, is_active FROM users WHERE email = ?")
      .get(email);

    // Всегда считаем scrypt: для отсутствующего аккаунта — против заглушки,
    // чтобы время ответа не выдавало, зарегистрирован email или нет.
    const passwordOk = verifyPassword(password, row ? row.password_hash : DUMMY_HASH);
    if (!row || !passwordOk) {
      throw new HttpError(401, "invalid_credentials", "Неверный email или пароль");
    }
    if (row.is_active !== 1) throw forbidden("Аккаунт заблокирован");

    const user = { id: row.id, email: row.email, roles: rolesOfUser(row.id) };
    ctx.res.setHeader("Set-Cookie", sessionCookie(createSession(user.id)));
    const ids = links(user);
    return {
      user: publicUser(user),
      masterId: ids.masterId,
      clientId: ids.clientId,
      client: ids.client,
    };
  });

  router.post("/api/auth/logout", async (ctx) => {
    destroySession(readToken(ctx.req));
    ctx.res.setHeader("Set-Cookie", clearSessionCookie());
    return { ok: true };
  });

  router.get("/api/auth/me", async (ctx) => {
    const user = requireAuth(ctx);
    const ids = links(user);
    return {
      user: publicUser(user),
      masterId: ids.masterId,
      clientId: ids.clientId,
      client: ids.client,
    };
  });
}

module.exports = { register };
