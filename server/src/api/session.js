"use strict";

const crypto = require("node:crypto");
const config = require("../config");
const { getDb } = require("../db/connection");
const { parseCookies, unauthorized, forbidden } = require("./http");

const COOKIE_NAME = "sid";
const TTL_SECONDS = 7 * 24 * 60 * 60;

function secret() {
  return config.sessionSecret || "dev-insecure-session-secret-change-me";
}

function sign(payload) {
  return crypto.createHmac("sha256", secret()).update(payload).digest("base64url");
}

function safeEqual(a, b) {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  if (bufA.length !== bufB.length) return false;
  return crypto.timingSafeEqual(bufA, bufB);
}

function createToken(user) {
  const payload = {
    sub: user.id,
    role: user.role,
    exp: Math.floor(Date.now() / 1000) + TTL_SECONDS,
  };
  const encoded = Buffer.from(JSON.stringify(payload)).toString("base64url");
  return encoded + "." + sign(encoded);
}

function verifyToken(token) {
  if (!token || typeof token !== "string") return null;
  const dot = token.lastIndexOf(".");
  if (dot < 1) return null;
  const encoded = token.slice(0, dot);
  const signature = token.slice(dot + 1);
  if (!safeEqual(signature, sign(encoded))) return null;

  let payload;
  try {
    payload = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
  } catch (error) {
    return null;
  }
  if (!payload || typeof payload.sub !== "number" || typeof payload.exp !== "number") return null;
  if (payload.exp < Math.floor(Date.now() / 1000)) return null;
  return payload;
}

function authenticate(req) {
  const cookies = parseCookies(req.headers.cookie);
  const payload = verifyToken(cookies[COOKIE_NAME]);
  if (!payload) return null;
  const row = getDb()
    .prepare("SELECT id, email, role, is_active FROM users WHERE id = ?")
    .get(payload.sub);
  if (!row || row.is_active !== 1) return null;
  return { id: row.id, email: row.email, role: row.role };
}

function requireAuth(ctx) {
  if (!ctx.user) throw unauthorized();
  return ctx.user;
}

function requireRole(ctx, ...roles) {
  const user = requireAuth(ctx);
  if (!roles.includes(user.role)) throw forbidden();
  return user;
}

function sessionCookie(token) {
  let cookie =
    COOKIE_NAME + "=" + token + "; HttpOnly; Path=/; SameSite=Lax; Max-Age=" + TTL_SECONDS;
  if (config.env === "production") cookie += "; Secure";
  return cookie;
}

function clearSessionCookie() {
  return COOKIE_NAME + "=; HttpOnly; Path=/; SameSite=Lax; Max-Age=0";
}

module.exports = {
  createToken,
  verifyToken,
  authenticate,
  requireAuth,
  requireRole,
  sessionCookie,
  clearSessionCookie,
};
