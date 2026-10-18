"use strict";

const { getDb } = require("../../db/connection");
const { hashPassword, verifyPassword } = require("../../auth/password");
const { HttpError, conflict, forbidden } = require("../http");
const { createToken, sessionCookie, clearSessionCookie, requireAuth } = require("../session");
const v = require("../validate");

function publicUser(row) {
  return { id: row.id, email: row.email, role: row.role };
}

function links(user) {
  const db = getDb();
  let masterId = null;
  let clientId = null;
  if (user.role === "master") {
    const master = db.prepare("SELECT id FROM masters WHERE user_id = ?").get(user.id);
    if (master) masterId = master.id;
  }
  if (user.role === "client") {
    const client = db.prepare("SELECT id FROM clients WHERE email = ?").get(user.email);
    if (client) clientId = client.id;
  }
  return { masterId, clientId };
}

function register(router) {
  router.post("/api/auth/register", async (ctx) => {
    const body = ctx.body || {};
    const email = v.email(body.email);
    const password = v.password(body.password);
    const fullName = v.string(body.fullName, "fullName", { max: 120 });
    const phone = v.phone(body.phone);

    const db = getDb();
    if (db.prepare("SELECT id FROM users WHERE email = ?").get(email)) {
      throw conflict("Пользователь с таким email уже зарегистрирован");
    }

    db.prepare(
      "INSERT INTO clients (full_name, phone, email) VALUES (?, ?, ?) " +
        "ON CONFLICT(phone) DO UPDATE SET full_name = excluded.full_name, " +
        "email = excluded.email, updated_at = strftime('%Y-%m-%dT%H:%M:%SZ','now')"
    ).run(fullName, phone, email);
    const client = db
      .prepare("SELECT id, full_name, phone FROM clients WHERE phone = ?")
      .get(phone);

    let info;
    try {
      info = db
        .prepare("INSERT INTO users (email, password_hash, role, is_active) VALUES (?, ?, 'client', 1)")
        .run(email, hashPassword(password));
    } catch (error) {
      throw conflict("Пользователь с таким email уже зарегистрирован");
    }

    const user = db
      .prepare("SELECT id, email, role FROM users WHERE id = ?")
      .get(Number(info.lastInsertRowid));

    ctx.res.setHeader("Set-Cookie", sessionCookie(createToken(user)));
    ctx.status = 201;
    return {
      user: publicUser(user),
      client: { id: client.id, fullName: client.full_name, phone: client.phone },
    };
  });

  router.post("/api/auth/login", async (ctx) => {
    const body = ctx.body || {};
    const email = v.email(body.email);
    const password = v.string(body.password, "password", { min: 1, max: 200, trim: false });

    const db = getDb();
    const row = db.prepare("SELECT * FROM users WHERE email = ?").get(email);
    if (!row || !verifyPassword(password, row.password_hash)) {
      throw new HttpError(401, "invalid_credentials", "Неверный email или пароль");
    }
    if (row.is_active !== 1) throw forbidden("Аккаунт заблокирован");

    ctx.res.setHeader("Set-Cookie", sessionCookie(createToken(row)));
    return { user: publicUser(row) };
  });

  router.post("/api/auth/logout", async (ctx) => {
    ctx.res.setHeader("Set-Cookie", clearSessionCookie());
    return { ok: true };
  });

  router.get("/api/auth/me", async (ctx) => {
    const user = requireAuth(ctx);
    const ids = links(user);
    return { user: publicUser(user), masterId: ids.masterId, clientId: ids.clientId };
  });
}

module.exports = { register };
