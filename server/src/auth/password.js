"use strict";

/**
 * Хеширование и проверка паролей.
 *
 * Использует встроенный в Node.js scrypt (стойкий KDF, без нативных
 * зависимостей). Соль генерируется случайно и хранится внутри строки хеша,
 * отдельное поле под неё не нужно.
 *
 * Формат строки: scrypt$N$r$p$saltBase64$hashBase64
 */

const crypto = require("node:crypto");

const SCRYPT = { N: 16384, r: 8, p: 1, keylen: 64 };

/** Считает хеш пароля в формате scrypt$N$r$p$salt$hash. */
function hashPassword(password) {
  const salt = crypto.randomBytes(16);
  const hash = crypto.scryptSync(password, salt, SCRYPT.keylen, {
    N: SCRYPT.N,
    r: SCRYPT.r,
    p: SCRYPT.p,
  });
  return [
    "scrypt",
    SCRYPT.N,
    SCRYPT.r,
    SCRYPT.p,
    salt.toString("base64"),
    hash.toString("base64"),
  ].join("$");
}

/** Проверяет пароль против сохранённого хеша (постоянное время сравнения). */
function verifyPassword(password, stored) {
  const parts = String(stored).split("$");
  if (parts.length !== 6 || parts[0] !== "scrypt") return false;

  const [, n, r, p, saltB64, hashB64] = parts;
  const salt = Buffer.from(saltB64, "base64");
  const expected = Buffer.from(hashB64, "base64");
  const actual = crypto.scryptSync(password, salt, expected.length, {
    N: Number(n),
    r: Number(r),
    p: Number(p),
  });

  return expected.length === actual.length && crypto.timingSafeEqual(expected, actual);
}

module.exports = { hashPassword, verifyPassword };
