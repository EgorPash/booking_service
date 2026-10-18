"use strict";

/**
 * Сессии и проверка прав.
 *
 * Токен сессии — случайная строка (crypto.randomBytes), в cookie уходит сам
 * токен, а в БД хранится только его SHA-256-хеш. Проверка — по хешу и сроку
 * действия. Роли пользователя берём ИЗ БАЗЫ (таблица user_roles), а не из
 * cookie/запроса: у одного человека их может быть несколько.
 */

const crypto = require("node:crypto");
const config = require("../config");
const { getDb } = require("../db/connection");
const { parseCookies, unauthorized, forbidden } = require("./http");

const COOKIE_NAME = "sid";
const TTL_SECONDS = config.sessionTtlHours * 60 * 60;

/** Хеш токена (в БД храним только его). */
function hashToken(token) {
  return crypto.createHash("sha256").update(String(token)).digest("base64url");
}

/** Список ролей пользователя из БД. */
function rolesOfUser(userId) {
  return getDb()
    .prepare("SELECT role FROM user_roles WHERE user_id = ? ORDER BY role")
    .all(userId)
    .map((row) => row.role);
}

/** Создаёт сессию и возвращает её токен (в открытом виде — только здесь). */
function createSession(userId) {
  const token = crypto.randomBytes(32).toString("base64url");
  const expiresAt = new Date(Date.now() + TTL_SECONDS * 1000).toISOString();
  getDb()
    .prepare("INSERT INTO sessions (user_id, token_hash, expires_at) VALUES (?, ?, ?)")
    .run(userId, hashToken(token), expiresAt);
  return token;
}

/** Удаляет сессию по токену (выход). */
function destroySession(token) {
  if (!token) return 0;
  return getDb().prepare("DELETE FROM sessions WHERE token_hash = ?").run(hashToken(token)).changes;
}

/** Удаляет сессию по её id (например, протухшую). */
function destroySessionById(id) {
  return getDb().prepare("DELETE FROM sessions WHERE id = ?").run(id).changes;
}

/** Удаляет все истёкшие сессии (вызывается периодически и на запросах). */
function purgeExpiredSessions() {
  return getDb().prepare("DELETE FROM sessions WHERE expires_at <= ?").run(new Date().toISOString())
    .changes;
}

function readToken(req) {
  return parseCookies(req.headers.cookie)[COOKIE_NAME] || null;
}

/**
 * Определяет пользователя по cookie-токену.
 * Возвращает { id, email, roles, sessionId } или null.
 */
function authenticate(req) {
  const token = readToken(req);
  if (!token) return null;

  const row = getDb()
    .prepare(
      "SELECT s.id AS session_id, s.expires_at, u.id, u.email, u.is_active " +
        "FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ?"
    )
    .get(hashToken(token));

  if (!row) return null;
  if (row.expires_at <= new Date().toISOString()) {
    destroySessionById(row.session_id);
    return null;
  }
  if (row.is_active !== 1) return null;

  return { id: row.id, email: row.email, roles: rolesOfUser(row.id), sessionId: row.session_id };
}

function requireAuth(ctx) {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

function hasRole(user, role) {
  return Boolean(user && Array.isArray(user.roles) && user.roles.includes(role));
}

/** Требует, чтобы у пользователя была ХОТЯ БЫ ОДНА из перечисленных ролей. */
function requireRole(ctx, ...roles) {
  const user = requireAuth(ctx);
  if (!roles.some((role) => hasRole(user, role))) throw forbidden();
  return user;
}

function sessionCookie(token) {
  let cookie = COOKIE_NAME + "=" + token + "; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + TTL_SECONDS;
  if (config.env === "production") cookie += "; Secure";
  return cookie;
}

function clearSessionCookie() {
  return COOKIE_NAME + "=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
}

module.exports = {
  COOKIE_NAME,
  hashToken,
  rolesOfUser,
  createSession,
  destroySession,
  purgeExpiredSessions,
  readToken,
  authenticate,
  requireAuth,
  hasRole,
  requireRole,
  sessionCookie,
  clearSessionCookie,
};
